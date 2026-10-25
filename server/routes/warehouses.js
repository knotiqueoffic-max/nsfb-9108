const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly, requireTenant } = require('../middleware/auth');
const { logAuditEvent } = require('../services/audit.service');

router.use(authenticate);
router.use(requireTenant);

function formatWarehouse(wh) {
  if (!wh) return null;
  return {
    ...wh,
    address: wh.address_line1 || null,
    pincode: wh.postal_code || null,
  };
}

// ─── GET /api/warehouses — list all warehouses for current tenant ───────────────
router.get('/', async (req, res) => {
  const warehouses = await db('warehouses')
    .where('tenant_id', req.tenant_id)
    .where('is_active', true)
    .orderBy('name', 'asc');

  res.json(warehouses.map(formatWarehouse));
});

// ─── GET /api/warehouses/:id — single warehouse ───────────────────────────────
router.get('/:id', async (req, res) => {
  const warehouse = await db('warehouses')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .where('is_active', true)
    .first();

  if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
  res.json(formatWarehouse(warehouse));
});

// ─── POST /api/warehouses — create a warehouse ────────────────────────────────
router.post('/', adminOnly, [
  body('name').trim().notEmpty().withMessage('Warehouse name is required'),
  body('code').optional().trim(),
  body('address').optional().trim(),
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('pincode').optional().trim(),
  body('latitude').optional({ nullable: true }).isFloat(),
  body('longitude').optional({ nullable: true }).isFloat(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, code, address, city, state, pincode, latitude, longitude } = req.body;

  try {
    const [id] = await db('warehouses').insert({
      tenant_id:     req.tenant_id,
      name,
      code:          code || null,
      address_line1: address || null,
      city:          city || null,
      state:         state || null,
      postal_code:   pincode || null,
      latitude:      latitude !== undefined && latitude !== null ? parseFloat(latitude) : null,
      longitude:     longitude !== undefined && longitude !== null ? parseFloat(longitude) : null,
      is_active:     true,
    }).returning('id');
    const warehouseId = typeof id === 'object' ? id.id : id;

    const newWarehouse = await db('warehouses').where('id', warehouseId).first();

    await logAuditEvent({
      tenant_id: req.tenant_id,
      user_id: req.user.id,
      action: 'WAREHOUSE_CREATED',
      target_type: 'warehouses',
      target_id: warehouseId,
      ip_address: req.ip,
      details: { name, city },
    });

    res.status(201).json(formatWarehouse(newWarehouse));
  } catch (err) {
    console.error('[Warehouse Creation Error]:', err);
    res.status(500).json({ error: 'Failed to create warehouse' });
  }
});

// ─── PUT /api/warehouses/:id — update warehouse ───────────────────────────────
router.put('/:id', adminOnly, [
  body('name').optional().trim().notEmpty(),
  body('latitude').optional({ nullable: true }).isFloat(),
  body('longitude').optional({ nullable: true }).isFloat(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const warehouse = await db('warehouses')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });

  const { name, code, address, city, state, pincode, latitude, longitude, is_active } = req.body;
  const updateData = { updated_at: db.fn.now() };

  if (name !== undefined) updateData.name = name;
  if (code !== undefined) updateData.code = code;
  if (address !== undefined) updateData.address_line1 = address;
  if (city !== undefined) updateData.city = city;
  if (state !== undefined) updateData.state = state;
  if (pincode !== undefined) updateData.postal_code = pincode;
  if (latitude !== undefined) updateData.latitude = latitude !== null ? parseFloat(latitude) : null;
  if (longitude !== undefined) updateData.longitude = longitude !== null ? parseFloat(longitude) : null;
  if (is_active !== undefined) updateData.is_active = Boolean(is_active);

  try {
    await db('warehouses')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .update(updateData);

    const updatedWarehouse = await db('warehouses').where('id', req.params.id).first();

    await logAuditEvent({
      tenant_id: req.tenant_id,
      user_id: req.user.id,
      action: 'WAREHOUSE_UPDATED',
      target_type: 'warehouses',
      target_id: req.params.id,
      ip_address: req.ip,
      details: updateData,
    });

    res.json(formatWarehouse(updatedWarehouse));
  } catch (err) {
    console.error('[Warehouse Update Error]:', err);
    res.status(500).json({ error: 'Failed to update warehouse' });
  }
});

// ─── DELETE /api/warehouses/:id — deactivate warehouse ────────────────────────
router.delete('/:id', adminOnly, async (req, res) => {
  const warehouse = await db('warehouses')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });

  // Soft delete so historical stock/orders remain intact
  await db('warehouses')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .update({ is_active: false, updated_at: db.fn.now() });

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'WAREHOUSE_DELETED',
    target_type: 'warehouses',
    target_id: req.params.id,
    ip_address: req.ip,
  });

  res.json({ message: 'Warehouse deactivated successfully' });
});

module.exports = router;
