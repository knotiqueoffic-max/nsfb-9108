const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly } = require('../middleware/auth');
const { recalcAvgCost } = require('../services/cost.service');

router.use(authenticate);

// GET /api/purchases
router.get('/', async (req, res) => {
  const { material_id, start, end } = req.query;
  let query = db('purchase_log as pl')
    .join('raw_materials as rm', 'pl.material_id', 'rm.id')
    .leftJoin('users as u', 'pl.created_by', 'u.id')
    .where('pl.tenant_id', req.tenant_id)
    .select('pl.*', 'rm.name as material_name', 'rm.unit', 'u.name as created_by_name')
    .orderBy('pl.purchase_date', 'desc');

  if (material_id) query = query.where('pl.material_id', material_id);
  if (start) query = query.where('pl.purchase_date', '>=', start);
  if (end) query = query.where('pl.purchase_date', '<=', end);

  const rows = await query;
  res.json(rows);
});

// POST /api/purchases — log a new purchase (updates stock + avg cost)
router.post('/', adminOnly, [
  body('material_id').isInt({ min: 1 }),
  body('quantity').isFloat({ min: 0.001 }),
  body('cost_per_unit').isFloat({ min: 0 }),
  body('purchase_date').isDate(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { material_id, quantity, cost_per_unit, supplier, purchase_date, notes } = req.body;

  // Verify material belongs to this tenant
  const mat = await db('raw_materials')
    .where('id', material_id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!mat) return res.status(404).json({ error: 'Material not found' });

  const qty = parseFloat(quantity);
  const cpu = parseFloat(cost_per_unit);
  const total_cost = parseFloat((qty * cpu).toFixed(2));

  const { new_stock, new_avg_cost } = await recalcAvgCost(material_id, qty, cpu, req.tenant_id);

  const [id] = await db('purchase_log').insert({
    tenant_id: req.tenant_id,
    material_id, quantity: qty, cost_per_unit: cpu, total_cost,
    supplier: supplier || null,
    purchase_date,
    notes: notes || null,
    created_by: req.user.id,
  }).returning('id');
  const purchaseId = typeof id === 'object' ? id.id : id;

  const purchase = await db('purchase_log as pl')
    .join('raw_materials as rm', 'pl.material_id', 'rm.id')
    .where('pl.id', purchaseId)
    .select('pl.*', 'rm.name as material_name', 'rm.unit')
    .first();

  res.status(201).json({ purchase, new_stock, new_avg_cost });
});

// DELETE /api/purchases/:id — admin only (reverses material stock addition)
router.delete('/:id', adminOnly, async (req, res) => {
  const purchase = await db('purchase_log')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!purchase) return res.status(404).json({ error: 'Purchase record not found' });

  const mat = await db('raw_materials')
    .where('id', purchase.material_id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (mat) {
    const newStock = Math.max(0, mat.stock_quantity - purchase.quantity);
    await db('raw_materials').where('id', purchase.material_id).update({
      stock_quantity: newStock, updated_at: db.fn.now(),
    });
  }

  await db('purchase_log')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .del();
  res.json({ message: 'Purchase entry deleted and material stock reverted' });
});

module.exports = router;
