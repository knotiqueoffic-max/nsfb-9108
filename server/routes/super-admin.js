const router = require('express').Router();
const db = require('../db/database');
const { authenticate, superAdminOnly } = require('../middleware/auth');

router.use(authenticate, superAdminOnly);

// ─── GET /api/super-admin/tenants — list all tenants ─────────────────────────
router.get('/tenants', async (req, res) => {
  try {
    const tenants = await db('tenants as t')
      .leftJoin('users as u', 't.owner_id', 'u.id')
      .leftJoin('plans as p', 't.plan_id', 'p.id')
      .select(
        't.*',
        'u.name as owner_name',
        'u.email as owner_email',
        'p.name as plan_name'
      )
      .orderBy('t.created_at', 'desc');

    // Get count of workers and products for each tenant to show active usage
    const enrichedTenants = [];
    for (const tenant of tenants) {
      const [workers, products] = await Promise.all([
        db('users')
          .where('tenant_id', tenant.id)
          .where('role', 'worker')
          .count('id as count')
          .first(),
        db('products')
          .where('tenant_id', tenant.id)
          .count('id as count')
          .first(),
      ]);

      enrichedTenants.push({
        ...tenant,
        workers_count:  parseInt(workers?.count || 0),
        products_count: parseInt(products?.count || 0),
      });
    }

    res.json(enrichedTenants);
  } catch (err) {
    console.error('Super-admin tenants list error:', err);
    res.status(500).json({ error: 'Failed to retrieve tenants' });
  }
});

// ─── PUT /api/super-admin/tenants/:id — override details ──────────────────────
router.put('/tenants/:id', async (req, res) => {
  const { plan_id, subscription_status, trial_ends_at } = req.body;
  const tenantId = req.params.id;

  try {
    const tenant = await db('tenants').where('id', tenantId).first();
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const updateData = { updated_at: db.fn.now() };
    if (plan_id !== undefined) updateData.plan_id = plan_id;
    if (subscription_status !== undefined) updateData.subscription_status = subscription_status;
    if (trial_ends_at !== undefined) updateData.trial_ends_at = trial_ends_at;

    await db('tenants').where('id', tenantId).update(updateData);

    const updatedTenant = await db('tenants as t')
      .leftJoin('users as u', 't.owner_id', 'u.id')
      .leftJoin('plans as p', 't.plan_id', 'p.id')
      .where('t.id', tenantId)
      .select('t.*', 'u.name as owner_name', 'u.email as owner_email', 'p.name as plan_name')
      .first();

    res.json({
      message: 'Tenant subscription overridden successfully.',
      tenant:  updatedTenant,
    });
  } catch (err) {
    console.error('Super-admin override error:', err);
    res.status(500).json({ error: 'Failed to update tenant subscription' });
  }
});

module.exports = router;
