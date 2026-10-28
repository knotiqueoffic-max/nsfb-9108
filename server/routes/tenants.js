const router = require('express').Router();
const db = require('../db/database');
const { authenticate, ownerOnly, requireTenant, workerManagerOnly } = require('../middleware/auth');
const { ROLES, TENANT_TYPES, RELATIONSHIP_TYPES } = require('../constants/roles');
const { logAuditEvent } = require('../services/audit.service');
const { deleteUserSafely } = require('../services/user.service');

router.use(authenticate);
router.use(requireTenant);

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

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'TENANT_PROFILE_UPDATED',
    target_type: 'tenants',
    target_id: req.tenant_id,
    ip_address: req.ip,
    details: updateData,
  });

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
router.get('/me/billing', workerManagerOnly, async (req, res) => {
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

// ─── POST /api/tenants/subvendors — create a subvendor under current tenant ──
router.post('/subvendors', workerManagerOnly, async (req, res) => {
  const { name, business_category } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Subvendor organization name is required' });
  }

  // Generate unique slug
  let baseSlug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'subvendor';
  let slug = baseSlug;
  let slugSuffix = 1;
  while (await db('tenants').where('slug', slug).first()) {
    slug = `${baseSlug}-${slugSuffix++}`;
  }

  const trialEndsAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const result = await db.transaction(async (trx) => {
    // 1. Create subvendor tenant record
    const [subvendorId] = await trx('tenants').insert({
      name:                name.trim(),
      slug,
      business_category:   business_category || 'Handmade Production',
      plan_id:             'free_trial',
      trial_ends_at:       trialEndsAt,
      subscription_status: 'active', // subvendors do not require standalone paid subscription
      tenant_type:         TENANT_TYPES.SUBVENDOR,
      parent_tenant_id:    req.tenant_id,
      status:              'active',
      onboarding_dismissed: true,
    }).returning('id');
    const resolvedSubvendorId = typeof subvendorId === 'object' ? subvendorId.id : subvendorId;

    // 2. Register organization relationship
    await trx('organization_relationships').insert({
      parent_tenant_id:  req.tenant_id,
      child_tenant_id:   resolvedSubvendorId,
      relationship_type: RELATIONSHIP_TYPES.VENDOR_SUBVENDOR,
      status:            'active',
    });

    return resolvedSubvendorId;
  });

  const createdSubvendor = await db('tenants').where('id', result).first();

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'SUBVENDOR_ORGANIZATION_CREATED',
    target_type: 'tenants',
    target_id: result,
    ip_address: req.ip,
    details: { name, slug },
  });

  res.status(201).json({
    message: 'Subvendor organization created successfully',
    subvendor: createdSubvendor,
  });
});

// ─── GET /api/tenants/subvendors — list subvendor organizations ───────────────
router.get('/subvendors', workerManagerOnly, async (req, res) => {
  const subvendors = await db('tenants')
    .where('parent_tenant_id', req.tenant_id)
    .where('tenant_type', TENANT_TYPES.SUBVENDOR)
    .select('id', 'name', 'slug', 'business_category', 'status', 'created_at');

  res.json(subvendors);
});

// ─── DELETE /api/tenants/subvendors/:id — delete a subvendor organization ─────
router.delete('/subvendors/:id', workerManagerOnly, async (req, res) => {
  const subvendorId = req.params.id;
  const subvendor = await db('tenants').where('id', subvendorId).first();
  if (!subvendor) {
    return res.status(404).json({ error: 'Subvendor organization not found' });
  }

  // Verify hierarchy: caller must be Admin/Owner or the parent Vendor
  const isParentVendor = subvendor.parent_tenant_id === req.tenant_id;
  const isAdminOrOwner = [ROLES.OWNER, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role);

  if (!isParentVendor && !isAdminOrOwner) {
    return res.status(403).json({ error: 'Access denied: You do not have permission to delete this subvendor' });
  }

  await db.transaction(async (trx) => {
    // 1. Delete all users belonging to this subvendor
    const subvendorUsers = await trx('users').where('tenant_id', subvendor.id).select('id');
    for (const u of subvendorUsers) {
      await deleteUserSafely(u.id, trx);
    }

    // 2. Remove organization relationships
    if (await trx.schema.hasTable('organization_relationships')) {
      await trx('organization_relationships')
        .where('child_tenant_id', subvendor.id)
        .orWhere('parent_tenant_id', subvendor.id)
        .del();
    }

    // 3. Clear or nullify any production requests issued by this subvendor
    if (await trx.schema.hasTable('production_requests')) {
      await trx('production_requests')
        .where('tenant_id', subvendor.id)
        .update({ status: 'cancelled' });
    }

    // 4. Delete settings
    if (await trx.schema.hasTable('settings')) {
      await trx('settings').where('tenant_id', subvendor.id).del();
    }

    // 5. Delete tenant record
    await trx('tenants').where('id', subvendor.id).del();
  });

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'SUBVENDOR_ORGANIZATION_DELETED',
    target_type: 'tenants',
    target_id: subvendor.id,
    ip_address: req.ip,
    details: { name: subvendor.name, slug: subvendor.slug },
  });

  res.json({ message: 'Subvendor organization and all associated users deleted successfully' });
});

// ─── GET /api/tenants/relationships — list all organization relationships ──────
router.get('/relationships', async (req, res) => {
  const relationships = await db('organization_relationships')
    .where('parent_tenant_id', req.tenant_id)
    .orWhere('child_tenant_id', req.tenant_id)
    .select('id', 'parent_tenant_id', 'child_tenant_id', 'relationship_type', 'status', 'created_at');

  // Enrich with tenant names
  const tenantIds = new Set();
  relationships.forEach(r => {
    tenantIds.add(r.parent_tenant_id);
    tenantIds.add(r.child_tenant_id);
  });

  const tenants = await db('tenants')
    .whereIn('id', Array.from(tenantIds))
    .select('id', 'name', 'tenant_type', 'status');

  const tenantMap = {};
  tenants.forEach(t => { tenantMap[t.id] = t; });

  const enriched = relationships.map(r => ({
    ...r,
    parent_tenant: tenantMap[r.parent_tenant_id] || null,
    child_tenant:  tenantMap[r.child_tenant_id] || null,
  }));

  res.json(enriched);
});

module.exports = router;

