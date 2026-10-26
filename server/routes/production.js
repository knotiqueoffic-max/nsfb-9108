const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly, workerManagerOnly, requireTenant, checkTenantLock } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const { deductMaterialsForProduction, calcLaborCost } = require('../services/cost.service');
const { logAuditEvent } = require('../services/audit.service');

router.use(authenticate);
router.use(requireTenant);

// GET /api/production — filterable by worker, product, date range, status/is_paid
router.get('/', async (req, res) => {
  const { worker_id, product_id, start, end, status, is_paid, limit = 100, offset = 0 } = req.query;

  let query = db('production_entries as pe')
    .join('users as u', 'pe.worker_id', 'u.id')
    .join('products as p', 'pe.product_id', 'p.id')
    .where('pe.tenant_id', req.tenant_id) // Tenant scope
    .select('pe.*', 'u.name as worker_name', 'p.name as product_name', 'p.sku')
    .orderBy('pe.production_date', 'desc')
    .orderBy('pe.created_at', 'desc');

  // Workers can only see their own entries
  if (req.user.role === 'worker') {
    query = query.where('pe.worker_id', req.user.id);
  } else if (worker_id) {
    query = query.where('pe.worker_id', worker_id);
  }

  if (product_id) query = query.where('pe.product_id', product_id);
  if (start) query = query.where('pe.production_date', '>=', start);
  if (end) query = query.where('pe.production_date', '<=', end);
  if (status) {
    query = query.where('pe.status', status);
  } else if (is_paid !== undefined) {
    if (is_paid === 'true') {
      query = query.where('pe.status', 'paid');
    } else {
      query = query.whereIn('pe.status', ['ordered', 'received']);
    }
  }

  const totalQuery = query.clone().clearSelect().clearOrder().count('pe.id as count');
  const [{ count }] = await totalQuery;

  const entries = await query.limit(parseInt(limit)).offset(parseInt(offset));
  res.json({ entries, total: parseInt(count) });
});

// GET /api/production/:id/materials — BOM breakdown for a single production entry
router.get('/:id/materials', async (req, res) => {
  const entry = await db('production_entries')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const bom = await db('product_bom as pb')
    .join('raw_materials as rm', 'pb.material_id', 'rm.id')
    .where('pb.product_id', entry.product_id)
    .where('rm.tenant_id', req.tenant_id)
    .select(
      'rm.id as material_id',
      'rm.name as material_name',
      'rm.unit',
      'pb.quantity_per_unit',
      'rm.avg_cost_per_unit',
      'rm.cost_per_unit'
    );

  const materials = bom.map(item => {
    const qty_used    = parseFloat((item.quantity_per_unit * entry.quantity).toFixed(4));
    const avg_cost    = parseFloat(item.avg_cost_per_unit || item.cost_per_unit || 0);
    const line_total  = parseFloat((qty_used * avg_cost).toFixed(2));
    return {
      material_id:       item.material_id,
      material_name:     item.material_name,
      unit:              item.unit,
      quantity_per_unit: parseFloat(item.quantity_per_unit),
      qty_used,
      avg_cost_per_unit: avg_cost,
      line_total,
    };
  });

  const total_material_cost = parseFloat(materials.reduce((s, m) => s + m.line_total, 0).toFixed(2));
  res.json({ entry_id: entry.id, quantity: entry.quantity, materials, total_material_cost });
});

// GET /api/production/summary — daily/weekly/monthly totals
router.get('/summary', async (req, res) => {
  const { period = 'daily', worker_id, product_id } = req.query;

  let groupBy;
  switch (period) {
    case 'weekly':  groupBy = "strftime('%Y-W%W', production_date)"; break;
    case 'monthly': groupBy = "strftime('%Y-%m', production_date)"; break;
    default:        groupBy = 'production_date';
  }

  let query = db('production_entries as pe')
    .join('products as p', 'pe.product_id', 'p.id')
    .join('users as u', 'pe.worker_id', 'u.id')
    .where('pe.tenant_id', req.tenant_id) // Tenant scope
    .select(
      db.raw(`${groupBy} as period`),
      db.raw('SUM(pe.quantity) as total_quantity'),
      db.raw('SUM(pe.labor_cost) as total_labor_cost'),
      db.raw('COUNT(pe.id) as entry_count')
    )
    .groupByRaw(groupBy)
    .orderByRaw(groupBy + ' DESC');

  if (req.user.role === 'worker') query = query.where('pe.worker_id', req.user.id);
  else if (worker_id) query = query.where('pe.worker_id', worker_id);
  if (product_id) query = query.where('pe.product_id', product_id);

  const summary = await query;
  res.json(summary);
});

// POST /api/production — log a production entry (managers only; crocheters submit via assigned workflow)
router.post('/', workerManagerOnly, [
  body('product_id').isInt({ min: 1 }),
  body('quantity').isInt({ min: 1 }),
  body('production_date').isDate(),
  body('defect_count').optional().isInt({ min: 0 }),
  body('hours_worked').optional().isFloat({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { product_id, quantity, defect_count, production_date, notes, hours_worked, status } = req.body;

  // Determine worker_id: managers can specify, worker uses self
  let worker_id = req.user.id;
  if ([ROLES.OWNER, ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.SUPER_ADMIN].includes(req.user.role) && req.body.worker_id) {
    worker_id = parseInt(req.body.worker_id);
  }

  // Validate product exists AND belongs to this tenant
  const product = await db('products')
    .where('id', product_id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!product) return res.status(404).json({ error: 'Product not found' });

  // Validate worker exists AND belongs to this tenant
  const worker = await db('users')
    .where('id', worker_id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!worker) return res.status(404).json({ error: 'Worker not found' });

  const labor_cost = await calcLaborCost(worker_id, quantity, parseFloat(hours_worked || 0), product_id);
  const deductions = await deductMaterialsForProduction(product_id, quantity, req.tenant_id);

  const finalStatus = status || 'ordered';

  const [id] = await db('production_entries').insert({
    tenant_id: req.tenant_id,
    worker_id, product_id,
    quantity:     parseInt(quantity),
    defect_count: parseInt(defect_count || 0),
    production_date,
    notes:        notes || null,
    labor_cost,
    hours_worked: hours_worked ? parseFloat(hours_worked) : null,
    status:       finalStatus,
    is_paid:      finalStatus === 'paid',
    paid_at:      finalStatus === 'paid' ? db.fn.now() : null,
  }).returning('id');
  const entryId = typeof id === 'object' ? id.id : id;

  // Update finished goods stock
  const existing = await db('finished_goods_stock').where('product_id', product_id).first();
  if (existing) {
    await db('finished_goods_stock').where('product_id', product_id).update({
      quantity:   existing.quantity + parseInt(quantity),
      updated_at: db.fn.now(),
    });
  } else {
    await db('finished_goods_stock').insert({ product_id, tenant_id: req.tenant_id, quantity: parseInt(quantity) });
  }

  const entry = await db('production_entries as pe')
    .join('users as u', 'pe.worker_id', 'u.id')
    .join('products as p', 'pe.product_id', 'p.id')
    .where('pe.id', entryId)
    .select('pe.*', 'u.name as worker_name', 'p.name as product_name', 'p.sku')
    .first();

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'PRODUCTION_LOGGED',
    target_type: 'production_entries',
    target_id: entryId,
    ip_address: req.ip,
    details: { worker_id, product_id, quantity },
  });

  res.status(201).json({ entry, deductions });
});

// PUT /api/production/:id — update entry / add notes
router.put('/:id', async (req, res) => {
  // Verify ownership: manager can edit any entry in tenant; worker can edit their own entry
  let query = db('production_entries')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id);

  const isManager = [ROLES.OWNER, ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.SUPER_ADMIN].includes(req.user.role);
  if (!isManager) {
    query = query.where('worker_id', req.user.id);
  }
  const existingEntry = await query.first();
  if (!existingEntry) return res.status(404).json({ error: 'Entry not found or access denied' });

  const { quantity, defect_count, production_date, notes, hours_worked, status, is_paid } = req.body;
  const updateData = {};
  if (quantity !== undefined) updateData.quantity = parseInt(quantity);
  if (defect_count !== undefined) updateData.defect_count = parseInt(defect_count);
  if (production_date !== undefined) updateData.production_date = production_date;
  if (notes !== undefined) updateData.notes = notes;
  if (hours_worked !== undefined) updateData.hours_worked = parseFloat(hours_worked);
  if (status !== undefined) {
    updateData.status  = status;
    updateData.is_paid = status === 'paid';
    updateData.paid_at = status === 'paid' ? db.fn.now() : null;
  } else if (is_paid !== undefined) {
    updateData.is_paid = Boolean(is_paid);
    updateData.status  = is_paid ? 'paid' : 'ordered';
    updateData.paid_at = is_paid ? db.fn.now() : null;
  }

  await db('production_entries')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .update(updateData);

  const entry = await db('production_entries as pe')
    .join('users as u', 'pe.worker_id', 'u.id')
    .join('products as p', 'pe.product_id', 'p.id')
    .where('pe.id', req.params.id)
    .select('pe.*', 'u.name as worker_name', 'p.name as product_name', 'p.sku')
    .first();

  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  res.json(entry);
});

// PUT /api/production/:id/toggle-paid — manager toggle paid status
router.put('/:id/toggle-paid', workerManagerOnly, async (req, res) => {
  const entry = await db('production_entries')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const newIsPaid = req.body.is_paid !== undefined ? Boolean(req.body.is_paid) : (entry.status !== 'paid');
  await db('production_entries')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .update({
      status:  newIsPaid ? 'paid' : 'ordered',
      is_paid: newIsPaid,
      paid_at: newIsPaid ? db.fn.now() : null,
    });

  const updated = await db('production_entries as pe')
    .join('users as u', 'pe.worker_id', 'u.id')
    .join('products as p', 'pe.product_id', 'p.id')
    .where('pe.id', req.params.id)
    .select('pe.*', 'u.name as worker_name', 'p.name as product_name', 'p.sku')
    .first();

  res.json(updated);
});

// DELETE /api/production/:id — manager only (reverses stock changes)
router.delete('/:id', workerManagerOnly, async (req, res) => {
  const entry = await db('production_entries')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  // Revert finished goods stock
  const stock = await db('finished_goods_stock').where('product_id', entry.product_id).first();
  if (stock) {
    const newQty = Math.max(0, stock.quantity - entry.quantity);
    await db('finished_goods_stock').where('product_id', entry.product_id).update({
      quantity: newQty, updated_at: db.fn.now(),
    });
  }

  // Restore BOM raw materials
  const bom = await db('product_bom').where('product_id', entry.product_id);
  for (const item of bom) {
    const restoreQty = item.quantity_per_unit * entry.quantity;
    const mat = await db('raw_materials')
      .where('id', item.material_id)
      .where('tenant_id', req.tenant_id)
      .first();
    if (mat) {
      await db('raw_materials').where('id', item.material_id).update({
        stock_quantity: mat.stock_quantity + restoreQty, updated_at: db.fn.now(),
      });
    }
  }

  await db('production_entries')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .del();

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'PRODUCTION_DELETED',
    target_type: 'production_entries',
    target_id: req.params.id,
    ip_address: req.ip,
  });

  res.json({ message: 'Production entry deleted and stock restored' });
});

// POST /api/production/bulk-toggle-paid — manager bulk mark paid/unpaid or update status
router.post('/bulk-toggle-paid', workerManagerOnly, async (req, res) => {
  const { ids, is_paid, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No entry IDs provided' });
  }

  if (status !== undefined) {
    if (!['ordered', 'received', 'paid'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await db('production_entries')
      .whereIn('id', ids)
      .where('tenant_id', req.tenant_id)
      .update({ status, is_paid: status === 'paid', paid_at: status === 'paid' ? db.fn.now() : null });
    return res.json({ message: `Updated ${ids.length} entries to status: ${status}` });
  }

  const newIsPaid = Boolean(is_paid);
  await db('production_entries')
    .whereIn('id', ids)
    .where('tenant_id', req.tenant_id)
    .update({ status: newIsPaid ? 'paid' : 'ordered', is_paid: newIsPaid, paid_at: newIsPaid ? db.fn.now() : null });

  res.json({ message: `Updated ${ids.length} entries to ${newIsPaid ? 'Paid' : 'Unpaid'}` });
});

// POST /api/production/bulk-delete — manager bulk delete entries (reverses stock)
router.post('/bulk-delete', workerManagerOnly, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No entry IDs provided' });
  }

  for (const id of ids) {
    const entry = await db('production_entries')
      .where('id', id)
      .where('tenant_id', req.tenant_id)
      .first();
    if (!entry) continue;

    const stock = await db('finished_goods_stock').where('product_id', entry.product_id).first();
    if (stock) {
      const newQty = Math.max(0, stock.quantity - entry.quantity);
      await db('finished_goods_stock').where('product_id', entry.product_id).update({
        quantity: newQty, updated_at: db.fn.now(),
      });
    }

    const bom = await db('product_bom').where('product_id', entry.product_id);
    for (const item of bom) {
      const restoreQty = item.quantity_per_unit * entry.quantity;
      const mat = await db('raw_materials')
        .where('id', item.material_id)
        .where('tenant_id', req.tenant_id)
        .first();
      if (mat) {
        await db('raw_materials').where('id', item.material_id).update({
          stock_quantity: mat.stock_quantity + restoreQty, updated_at: db.fn.now(),
        });
      }
    }
  }

  await db('production_entries')
    .whereIn('id', ids)
    .where('tenant_id', req.tenant_id)
    .del();

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'PRODUCTION_BULK_DELETED',
    target_type: 'production_entries',
    ip_address: req.ip,
    details: { count: ids.length },
  });

  res.json({ message: `Deleted ${ids.length} production entries and restored stock` });
});

module.exports = router;
