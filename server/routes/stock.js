const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly } = require('../middleware/auth');

router.use(authenticate);

// GET /api/stock/finished-goods — tenant-scoped
router.get('/finished-goods', async (req, res) => {
  const { low_stock } = req.query;
  let query = db('finished_goods_stock as fgs')
    .join('products as p', 'fgs.product_id', 'p.id')
    .where('fgs.tenant_id', req.tenant_id)
    .select('fgs.*', 'p.name as product_name', 'p.sku', 'p.category', 'p.photo_url')
    .orderBy('p.name');

  if (low_stock === 'true') query = query.whereRaw('fgs.quantity <= fgs.reorder_threshold');
  const stock = await query;
  res.json(stock);
});

// POST /api/stock/adjust — manual stock correction for finished goods
router.post('/adjust', adminOnly, [
  body('product_id').isInt({ min: 1 }),
  body('quantity_delta').isFloat(),
  body('reason').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { product_id, quantity_delta, reason } = req.body;
  const delta = parseFloat(quantity_delta);

  // Verify product belongs to this tenant
  const product = await db('products')
    .where('id', product_id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const stock = await db('finished_goods_stock').where('product_id', product_id).first();
  if (!stock) return res.status(404).json({ error: 'Product stock record not found' });

  const newQty = Math.max(0, stock.quantity + delta);
  await db('finished_goods_stock').where('product_id', product_id).update({
    quantity: newQty, updated_at: db.fn.now(),
  });

  await db('stock_adjustments').insert({
    tenant_id:      req.tenant_id,
    type:           'finished_good',
    reference_id:   product_id,
    quantity_delta: delta,
    reason:         reason || 'Manual adjustment',
    adjusted_by:    req.user.id,
  });

  const updated = await db('finished_goods_stock as fgs')
    .join('products as p', 'fgs.product_id', 'p.id')
    .where('fgs.product_id', product_id)
    .select('fgs.*', 'p.name as product_name', 'p.sku')
    .first();
  res.json(updated);
});

// GET /api/stock/adjustments — history for this tenant
router.get('/adjustments', adminOnly, async (req, res) => {
  const adjustments = await db('stock_adjustments as sa')
    .leftJoin('users as u', 'sa.adjusted_by', 'u.id')
    .where('sa.tenant_id', req.tenant_id)
    .select('sa.*', 'u.name as adjusted_by_name')
    .orderBy('sa.adjusted_at', 'desc')
    .limit(100);
  res.json(adjustments);
});

module.exports = router;
