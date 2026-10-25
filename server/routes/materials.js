const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly } = require('../middleware/auth');
const { recalcAvgCost } = require('../services/cost.service');

// All routes require auth; req.tenant_id is set by authenticate
router.use(authenticate);

// GET /api/materials — list all materials for this tenant
router.get('/', async (req, res) => {
  const { search, category, low_stock } = req.query;
  let query = db('raw_materials').where('tenant_id', req.tenant_id).orderBy('name');

  if (search) query = query.whereILike('name', `%${search}%`);
  if (category) query = query.where('category', category);
  if (low_stock === 'true') query = query.whereRaw('stock_quantity <= reorder_threshold');

  const materials = await query;
  res.json(materials);
});

// GET /api/materials/low-stock
router.get('/low-stock', async (req, res) => {
  const materials = await db('raw_materials')
    .where('tenant_id', req.tenant_id)
    .whereRaw('stock_quantity <= reorder_threshold')
    .orderBy('name');
  res.json(materials);
});

// GET /api/materials/categories
router.get('/categories', async (req, res) => {
  const rows = await db('raw_materials')
    .where('tenant_id', req.tenant_id)
    .distinct('category')
    .whereNotNull('category')
    .orderBy('category');
  res.json(rows.map(r => r.category));
});

// GET /api/materials/:id
router.get('/:id', async (req, res) => {
  const mat = await db('raw_materials')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!mat) return res.status(404).json({ error: 'Material not found' });
  res.json(mat);
});

// POST /api/materials — admin only
router.post('/', adminOnly, [
  body('name').trim().notEmpty().withMessage('Material name is required'),
  body('unit').trim().notEmpty().withMessage('Unit is required'),
  body('stock_quantity').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).withMessage('Stock quantity must be a non-negative number'),
  body('cost_per_unit').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).withMessage('Cost per unit must be a non-negative number'),
  body('reorder_threshold').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).withMessage('Reorder threshold must be a non-negative number'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorString = errors.array().map(e => e.msg).join(', ');
    return res.status(400).json({ error: errorString, errors: errors.array() });
  }

  const { name, category, unit, stock_quantity, cost_per_unit, supplier, reorder_threshold } = req.body;
  const [id] = await db('raw_materials').insert({
    tenant_id: req.tenant_id,
    name,
    category: category || null,
    unit,
    stock_quantity: parseFloat(stock_quantity || 0),
    cost_per_unit: parseFloat(cost_per_unit || 0),
    avg_cost_per_unit: parseFloat(cost_per_unit || 0),
    supplier: supplier || null,
    reorder_threshold: parseFloat(reorder_threshold || 0),
  }).returning('id');
  const matId = typeof id === 'object' ? id.id : id;
  const mat = await db('raw_materials').where('id', matId).first();
  res.status(201).json(mat);
});

// PUT /api/materials/:id — admin only
router.put('/:id', adminOnly, async (req, res) => {
  const { name, category, unit, cost_per_unit, supplier, reorder_threshold, update_avg_cost } = req.body;

  // Verify ownership before update
  const mat = await db('raw_materials')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!mat) return res.status(404).json({ error: 'Material not found' });

  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (category !== undefined) updateData.category = category;
  if (unit !== undefined) updateData.unit = unit;
  if (cost_per_unit !== undefined) {
    updateData.cost_per_unit = parseFloat(cost_per_unit);
    if (update_avg_cost === true) {
      updateData.avg_cost_per_unit = parseFloat(cost_per_unit);
    }
  }
  if (supplier !== undefined) updateData.supplier = supplier;
  if (reorder_threshold !== undefined) updateData.reorder_threshold = parseFloat(reorder_threshold);
  updateData.updated_at = db.fn.now();

  await db('raw_materials')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .update(updateData);

  const updated = await db('raw_materials').where('id', req.params.id).first();
  res.json(updated);
});

// DELETE /api/materials/:id — admin only
router.delete('/:id', adminOnly, async (req, res) => {
  const matId = req.params.id;
  const mat = await db('raw_materials')
    .where('id', matId)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!mat) return res.status(404).json({ error: 'Material not found' });

  try {
    await db('product_bom').where('material_id', matId).del();
    await db('purchase_log').where('material_id', matId).where('tenant_id', req.tenant_id).del();
    await db('raw_materials').where('id', matId).where('tenant_id', req.tenant_id).del();
    res.json({ message: 'Material deleted successfully' });
  } catch (err) {
    res.status(400).json({ error: 'Cannot delete material referenced in historical records' });
  }
});

// POST /api/materials/:id/adjust — manual stock correction
router.post('/:id/adjust', adminOnly, [
  body('quantity_delta').isFloat(),
  body('reason').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const mat = await db('raw_materials')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!mat) return res.status(404).json({ error: 'Material not found' });

  const delta = parseFloat(req.body.quantity_delta);
  const newQty = Math.max(0, mat.stock_quantity + delta);

  await db('raw_materials')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .update({ stock_quantity: newQty, updated_at: db.fn.now() });

  await db('stock_adjustments').insert({
    tenant_id:      req.tenant_id,
    type:           'raw_material',
    reference_id:   req.params.id,
    quantity_delta: delta,
    reason:         req.body.reason || 'Manual adjustment',
    adjusted_by:    req.user.id,
  });

  const updated = await db('raw_materials').where('id', req.params.id).first();
  res.json(updated);
});

module.exports = router;
