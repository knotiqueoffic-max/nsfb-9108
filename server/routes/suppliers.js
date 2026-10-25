const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly, requireTenant } = require('../middleware/auth');
const { logAuditEvent } = require('../services/audit.service');

router.use(authenticate);
router.use(requireTenant);

// ─── GET /api/suppliers — list linked and historical suppliers ─────────────────
router.get('/', async (req, res) => {
  // 1. Linked vendor tenants
  const linked = await db('supplier_relationships as sr')
    .join('tenants as t', 'sr.vendor_tenant_id', 't.id')
    .where('sr.admin_tenant_id', req.tenant_id)
    .select(
      'sr.id as relationship_id',
      'sr.category',
      'sr.status',
      't.id as vendor_tenant_id',
      't.name as name',
      't.slug',
      't.business_category'
    );

  // 2. Historical manual suppliers from purchase_log (for backward compatibility)
  const historical = await db('purchase_log')
    .where('tenant_id', req.tenant_id)
    .whereNotNull('supplier')
    .distinct('supplier')
    .select('supplier');

  res.json({
    linked_suppliers: linked,
    historical_names: historical.map(h => h.supplier).filter(Boolean),
  });
});

// ─── POST /api/suppliers/link — link a vendor tenant as approved supplier ──────
router.post('/link', adminOnly, [
  body('vendor_tenant_id').isInt({ min: 1 }).withMessage('Valid vendor organization ID required'),
  body('category').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { vendor_tenant_id, category = 'Raw Materials' } = req.body;

  // Verify target tenant exists
  const vendorTenant = await db('tenants').where('id', vendor_tenant_id).first();
  if (!vendorTenant) return res.status(404).json({ error: 'Vendor organization not found' });

  // Prevent duplicate links
  const existing = await db('supplier_relationships')
    .where('admin_tenant_id', req.tenant_id)
    .where('vendor_tenant_id', vendor_tenant_id)
    .first();

  if (existing) {
    if (existing.status !== 'active') {
      await db('supplier_relationships').where('id', existing.id).update({ status: 'active', category });
      return res.json({ message: 'Supplier relationship reactivated', id: existing.id });
    }
    return res.status(409).json({ error: 'Supplier is already linked to your organization' });
  }

  const [id] = await db('supplier_relationships').insert({
    admin_tenant_id: req.tenant_id,
    vendor_tenant_id,
    category,
    status: 'active',
  }).returning('id');
  const relationshipId = typeof id === 'object' ? id.id : id;

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'SUPPLIER_LINKED',
    target_type: 'supplier_relationships',
    target_id: relationshipId,
    ip_address: req.ip,
    details: { vendor_tenant_id, category },
  });

  res.status(201).json({
    message: 'Supplier linked successfully',
    supplier_relationship: {
      id: relationshipId,
      admin_tenant_id: req.tenant_id,
      vendor_tenant_id,
      category,
      status: 'active',
    },
  });
});

// ─── DELETE /api/suppliers/link/:id — remove supplier link ────────────────────
router.delete('/link/:id', adminOnly, async (req, res) => {
  const rel = await db('supplier_relationships')
    .where('id', req.params.id)
    .where('admin_tenant_id', req.tenant_id)
    .first();

  if (!rel) return res.status(404).json({ error: 'Supplier relationship not found' });

  await db('supplier_relationships')
    .where('id', req.params.id)
    .update({ status: 'inactive' });

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'SUPPLIER_UNLINKED',
    target_type: 'supplier_relationships',
    target_id: req.params.id,
    ip_address: req.ip,
  });

  res.json({ message: 'Supplier unlinked successfully' });
});

module.exports = router;
