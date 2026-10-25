const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly, requireTenant, checkTenantLock } = require('../middleware/auth');
const { recalcAvgCost } = require('../services/cost.service');
const { logAuditEvent } = require('../services/audit.service');

router.use(authenticate);
router.use(requireTenant);

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

// POST /api/purchases — log a new purchase (updates stock + avg cost atomically)
router.post('/', adminOnly, checkTenantLock, [
  body('material_id').isInt({ min: 1 }),
  body('quantity').isFloat({ min: 0.001 }),
  body('cost_per_unit').isFloat({ min: 0 }),
  body('purchase_date').isDate(),
  body('warehouse_id').optional({ nullable: true }).isInt({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { material_id, quantity, cost_per_unit, supplier, purchase_date, notes, warehouse_id } = req.body;

  // Verify material belongs to this tenant
  const mat = await db('raw_materials')
    .where('id', material_id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!mat) return res.status(404).json({ error: 'Material not found' });

  // Optional warehouse verification
  if (warehouse_id) {
    const wh = await db('warehouses')
      .where('id', warehouse_id)
      .where('tenant_id', req.tenant_id)
      .first();
    if (!wh) return res.status(404).json({ error: 'Warehouse not found' });
  }

  const qty = parseFloat(quantity);
  const cpu = parseFloat(cost_per_unit);
  const total_cost = parseFloat((qty * cpu).toFixed(2));

  try {
    const result = await db.transaction(async (trx) => {
      // 1. Recalculate moving average cost and increment stock atomically
      const { new_stock, new_avg_cost } = await recalcAvgCost(material_id, qty, cpu, req.tenant_id, trx);

      // 2. Insert purchase log entry
      const [id] = await trx('purchase_log').insert({
        tenant_id:     req.tenant_id,
        material_id,
        quantity:      qty,
        cost_per_unit: cpu,
        total_cost,
        supplier:      supplier || null,
        purchase_date,
        notes:         notes || null,
        created_by:    req.user.id,
      }).returning('id');
      const purchaseId = typeof id === 'object' ? id.id : id;

      return { purchaseId, new_stock, new_avg_cost };
    });

    const purchase = await db('purchase_log as pl')
      .join('raw_materials as rm', 'pl.material_id', 'rm.id')
      .where('pl.id', result.purchaseId)
      .select('pl.*', 'rm.name as material_name', 'rm.unit')
      .first();

    await logAuditEvent({
      tenant_id: req.tenant_id,
      user_id: req.user.id,
      action: 'PURCHASE_LOGGED',
      target_type: 'purchase_log',
      target_id: result.purchaseId,
      ip_address: req.ip,
      details: { material_id, quantity: qty, cost_per_unit: cpu, total_cost, supplier },
    });

    res.status(201).json({ purchase, new_stock: result.new_stock, new_avg_cost: result.new_avg_cost });
  } catch (err) {
    console.error('[Purchase Logging Error]:', err);
    res.status(500).json({ error: 'Failed to record purchase entry. Please try again.' });
  }
});

// DELETE /api/purchases/:id — admin only (reverses material stock addition atomically)
router.delete('/:id', adminOnly, checkTenantLock, async (req, res) => {
  const purchase = await db('purchase_log')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!purchase) return res.status(404).json({ error: 'Purchase record not found' });

  try {
    await db.transaction(async (trx) => {
      const mat = await trx('raw_materials')
        .where('id', purchase.material_id)
        .where('tenant_id', req.tenant_id)
        .first();

      if (mat) {
        const newStock = Math.max(0, mat.stock_quantity - purchase.quantity);
        await trx('raw_materials').where('id', purchase.material_id).update({
          stock_quantity: newStock,
          updated_at: trx.fn.now(),
        });
      }

      await trx('purchase_log')
        .where('id', req.params.id)
        .where('tenant_id', req.tenant_id)
        .del();
    });

    await logAuditEvent({
      tenant_id: req.tenant_id,
      user_id: req.user.id,
      action: 'PURCHASE_DELETED',
      target_type: 'purchase_log',
      target_id: req.params.id,
      ip_address: req.ip,
      details: { material_id: purchase.material_id, quantity: purchase.quantity },
    });

    res.json({ message: 'Purchase entry deleted and material stock reverted' });
  } catch (err) {
    console.error('[Purchase Deletion Error]:', err);
    res.status(500).json({ error: 'Failed to revert purchase. Please try again.' });
  }
});

module.exports = router;

