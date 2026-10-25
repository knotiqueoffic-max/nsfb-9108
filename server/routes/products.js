const router = require('express').Router();
const path = require('path');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly } = require('../middleware/auth');
const { calculateCOGS, suggestPrices } = require('../services/cost.service');
const { uploadPhoto } = require('../middleware/upload');

router.use(authenticate);

// GET /api/products
router.get('/', async (req, res) => {
  const { search, category, active } = req.query;
  let query = db('products').where('tenant_id', req.tenant_id).orderBy('name');
  if (search) query = query.whereILike('name', `%${search}%`);
  if (category) query = query.where('category', category);
  if (active !== undefined) query = query.where('is_active', active === 'true');
  const products = await query;
  res.json(products);
});

// GET /api/products/categories
router.get('/categories', async (req, res) => {
  const rows = await db('products')
    .where('tenant_id', req.tenant_id)
    .distinct('category')
    .whereNotNull('category')
    .orderBy('category');
  res.json(rows.map(r => r.category));
});

// GET /api/products/:id — with BOM and platform prices
router.get('/:id', async (req, res) => {
  const product = await db('products')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const [bom, platforms, stock] = await Promise.all([
    db('product_bom as pb')
      .join('raw_materials as rm', 'pb.material_id', 'rm.id')
      .where('pb.product_id', req.params.id)
      .select('pb.*', 'rm.name as material_name', 'rm.unit', 'rm.avg_cost_per_unit', 'rm.stock_quantity'),
    db('product_platforms').where('product_id', req.params.id),
    db('finished_goods_stock').where('product_id', req.params.id).first(),
  ]);

  const platform_prices = {};
  const platform_commissions = {};
  
  const settingsRow = await db('settings').where({ tenant_id: req.tenant_id, key: 'platform_commissions' }).first();
  const commissions = settingsRow ? JSON.parse(settingsRow.value) : { flipkart: 18, meesho: 12, myntra: 20, etsy: 6.5, amazon: 15 };

  for (const p of Object.keys(commissions)) {
    platform_prices[p] = 0;
    platform_commissions[p] = commissions[p] || 0;
  }

  platforms.forEach(p => {
    platform_prices[p.platform] = parseFloat(p.selling_price || 0);
    if (p.commission_pct !== undefined && p.commission_pct !== null && p.commission_pct !== 0) {
      platform_commissions[p.platform] = parseFloat(p.commission_pct);
    }
  });

  res.json({
    ...product,
    bom,
    platforms,
    platform_prices,
    platform_commissions,
    stock: stock || { quantity: 0, reorder_threshold: 0 }
  });
});

// GET /api/products/:id/cogs
router.get('/:id/cogs', async (req, res) => {
  // Verify product belongs to tenant first
  const product = await db('products')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!product) return res.status(404).json({ error: 'Product not found' });

  try {
    const cogs = await calculateCOGS(req.params.id, req.tenant_id);
    res.json(cogs);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// GET /api/products/:id/price-suggestions
router.get('/:id/price-suggestions', async (req, res) => {
  const product = await db('products')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!product) return res.status(404).json({ error: 'Product not found' });

  try {
    const { labor_cost_per_minute, margin_pct } = req.query;
    const suggestions = await suggestPrices(req.params.id, {
      laborCostPerMinute: parseFloat(labor_cost_per_minute || 1),
      desiredMarginPct:   parseFloat(margin_pct || 30),
    }, req.tenant_id);
    res.json(suggestions);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

async function linkOrdersToProduct(productId, sku, tenantId) {
  // Find all orders for this tenant with matching SKU (case-insensitive) that are currently unlinked
  const orders = await db('orders')
    .where('tenant_id', tenantId)
    .whereNull('product_id')
    .whereRaw('LOWER(TRIM(sku)) = ?', [sku.trim().toLowerCase()]);

  if (orders.length === 0) return;

  const stock = await db('finished_goods_stock').where('product_id', productId).first();
  const stockQty = stock ? stock.quantity : 0;

  for (const o of orders) {
    const stockFlagged = stockQty < o.quantity;
    await db('orders')
      .where('id', o.id)
      .update({
        product_id: productId,
        stock_flagged: o.status !== 'packed' && o.status !== 'shipped' && o.status !== 'delivered' ? stockFlagged : false
      });
  }
}

// POST /api/products — admin only
router.post('/', adminOnly, [
  body('name').trim().notEmpty(),
  body('sku').trim().notEmpty(),
  body('bunch_size').optional().isInt({ min: 1 }),
  body('standard_time_minutes').optional().isInt({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, sku, category, description, standard_time_minutes, labor_cost_per_unit, bunch_size, bom, platforms, reorder_threshold } = req.body;

  // Per-tenant SKU uniqueness check
  const existing = await db('products')
    .where('tenant_id', req.tenant_id)
    .where('sku', sku)
    .first();
  if (existing) return res.status(409).json({ error: 'SKU already exists in your catalog' });

  const [id] = await db('products').insert({
    tenant_id: req.tenant_id,
    name, sku, category, description,
    standard_time_minutes: parseInt(standard_time_minutes || 0),
    labor_cost_per_unit:   parseFloat(labor_cost_per_unit || 0),
    bunch_size:            parseInt(bunch_size || 1),
  }).returning('id');
  const productId = typeof id === 'object' ? id.id : id;

  if (bom && bom.length > 0) {
    await db('product_bom').insert(bom.map(item => ({
      product_id:       productId,
      material_id:      item.material_id,
      quantity_per_unit: parseFloat(item.quantity_per_unit),
    })));
  }

  if (platforms && platforms.length > 0) {
    await db('product_platforms').insert(platforms.map(p => ({
      product_id:      productId,
      platform:        p.platform,
      selling_price:   parseFloat(p.selling_price || 0),
      commission_pct:  parseFloat(p.commission_pct || 0),
    })));
  }

  await db('finished_goods_stock').insert({
    product_id:        productId,
    tenant_id:         req.tenant_id,
    quantity:          0,
    reorder_threshold: parseInt(reorder_threshold || 0),
  });

  await linkOrdersToProduct(productId, sku, req.tenant_id);

  const product = await db('products').where('id', productId).first();
  res.status(201).json(product);
});

// PUT /api/products/:id — admin only
router.put('/:id', adminOnly, async (req, res) => {
  // Verify ownership
  const product = await db('products')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const { name, category, description, sku, standard_time_minutes, labor_cost_per_unit, bunch_size, bom, platforms, reorder_threshold, is_active } = req.body;

  const updateData = { updated_at: db.fn.now() };
  if (name !== undefined) updateData.name = name;
  if (category !== undefined) updateData.category = category;
  if (description !== undefined) updateData.description = description;
  if (sku !== undefined) updateData.sku = sku;
  if (standard_time_minutes !== undefined) updateData.standard_time_minutes = parseInt(standard_time_minutes);
  if (labor_cost_per_unit !== undefined) updateData.labor_cost_per_unit = parseFloat(labor_cost_per_unit);
  if (bunch_size !== undefined) updateData.bunch_size = parseInt(bunch_size);
  if (is_active !== undefined) updateData.is_active = is_active;

  await db('products').where('id', req.params.id).where('tenant_id', req.tenant_id).update(updateData);

  if (sku !== undefined && sku !== product.sku) {
    await linkOrdersToProduct(req.params.id, sku, req.tenant_id);
  }

  if (bom) {
    await db('product_bom').where('product_id', req.params.id).del();
    if (bom.length > 0) {
      await db('product_bom').insert(bom.map(item => ({
        product_id:       req.params.id,
        material_id:      item.material_id,
        quantity_per_unit: parseFloat(item.quantity_per_unit),
      })));
    }
  }

  if (platforms) {
    await db('product_platforms').where('product_id', req.params.id).del();
    if (platforms.length > 0) {
      await db('product_platforms').insert(platforms.map(p => ({
        product_id:     req.params.id,
        platform:       p.platform,
        selling_price:  parseFloat(p.selling_price || 0),
        commission_pct: parseFloat(p.commission_pct || 0),
      })));
    }
  }

  if (reorder_threshold !== undefined) {
    await db('finished_goods_stock')
      .where('product_id', req.params.id)
      .update({ reorder_threshold: parseInt(reorder_threshold) });
  }

  const updated = await db('products').where('id', req.params.id).first();
  res.json(updated);
});

// POST /api/products/:id/photo — upload product photo
router.post('/:id/photo', adminOnly, uploadPhoto.single('photo'), async (req, res) => {
  const product = await db('products')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const photo_url = `/uploads/photos/${req.file.filename}`;
  await db('products').where('id', req.params.id).update({ photo_url, updated_at: db.fn.now() });
  res.json({ photo_url });
});

// DELETE /api/products/:id — admin only
router.delete('/:id', adminOnly, async (req, res) => {
  const productId = req.params.id;
  const product = await db('products')
    .where('id', productId)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!product) return res.status(404).json({ error: 'Product not found' });

  try {
    await db('product_bom').where('product_id', productId).del();
    await db('product_platforms').where('product_id', productId).del();
    await db('finished_goods_stock').where('product_id', productId).del();
    await db('products').where('id', productId).where('tenant_id', req.tenant_id).del();
    res.json({ message: 'Product deleted permanently' });
  } catch (err) {
    // FK violation: soft-delete instead
    await db('products')
      .where('id', productId)
      .where('tenant_id', req.tenant_id)
      .update({ is_active: false, updated_at: db.fn.now() });
    res.json({ message: 'Product deactivated and archived (retained for historical sales records)' });
  }
});

module.exports = router;
