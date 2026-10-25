const router = require('express').Router();
const db = require('../db/database');
const { authenticate, ownerOnly } = require('../middleware/auth');

router.use(authenticate);

// ─── GET /api/tenants/me — current tenant profile ─────────────────────────────
router.get('/me', async (req, res) => {
  const tenant = await db('tenants').where('id', req.tenant_id).first();
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const plan = await db('plans').where('id', tenant.plan_id).first();
  res.json({ ...tenant, plan });
});

// ─── PUT /api/tenants/me — update business profile ────────────────────────────
router.put('/me', ownerOnly, async (req, res) => {
  const { name, business_category, logo_url, onboarding_dismissed } = req.body;
  const updateData = { updated_at: db.fn.now() };
  if (name !== undefined) updateData.name = name;
  if (business_category !== undefined) updateData.business_category = business_category;
  if (logo_url !== undefined) updateData.logo_url = logo_url;
  if (onboarding_dismissed !== undefined) updateData.onboarding_dismissed = onboarding_dismissed;

  await db('tenants').where('id', req.tenant_id).update(updateData);
  const tenant = await db('tenants').where('id', req.tenant_id).first();
  const plan = await db('plans').where('id', tenant.plan_id).first();
  res.json({ ...tenant, plan });
});

// ─── GET /api/tenants/me/usage — current usage vs plan limits ─────────────────
router.get('/me/usage', async (req, res) => {
  const tenant = await db('tenants').where('id', req.tenant_id).first();
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const plan = await db('plans').where('id', tenant.plan_id).first();
  if (!plan) return res.status(500).json({ error: 'Plan not found' });

  const [workerCount, productCount] = await Promise.all([
    db('users')
      .where('tenant_id', req.tenant_id)
      .where('role', 'worker')
      .where('is_active', true)
      .count('id as count')
      .first(),
    db('products')
      .where('tenant_id', req.tenant_id)
      .where('is_active', true)
      .count('id as count')
      .first(),
  ]);

  // Count distinct platforms used in orders (as a proxy for platform connections)
  const platforms = await db('orders')
    .where('tenant_id', req.tenant_id)
    .distinct('platform')
    .select('platform');

  const planFeatures = plan.features ? JSON.parse(plan.features) : [];

  res.json({
    plan: {
      id:            plan.id,
      name:          plan.name,
      price_monthly: plan.price_monthly,
      price_yearly:  plan.price_yearly,
      features:      planFeatures,
    },
    usage: {
      workers: {
        used:      parseInt(workerCount?.count || 0),
        limit:     plan.max_workers,
        unlimited: plan.max_workers === -1,
      },
      products: {
        used:      parseInt(productCount?.count || 0),
        limit:     plan.max_products,
        unlimited: plan.max_products === -1,
      },
      platforms: {
        used:      platforms.length,
        limit:     plan.max_platforms,
        unlimited: plan.max_platforms === -1,
      },
    },
    subscription: {
      status:        tenant.subscription_status,
      trial_ends_at: tenant.trial_ends_at,
    },
  });
});

// ─── GET /api/tenants/me/billing — current plan + billing info ────────────────
router.get('/me/billing', ownerOnly, async (req, res) => {
  const tenant = await db('tenants').where('id', req.tenant_id).first();
  const plan = tenant ? await db('plans').where('id', tenant.plan_id).first() : null;
  res.json({
    tenant: {
      id:                   tenant.id,
      name:                 tenant.name,
      plan_id:              tenant.plan_id,
      subscription_status:  tenant.subscription_status,
      trial_ends_at:        tenant.trial_ends_at,
      razorpay_subscription_id: tenant.razorpay_subscription_id,
    },
    plan,
  });
});

module.exports = router;
