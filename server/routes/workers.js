const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, workerManagerOnly, requireTenant } = require('../middleware/auth');
const { ROLES, ACCOUNT_STATUS } = require('../constants/roles');
const { logAuditEvent } = require('../services/audit.service');

router.use(authenticate);
router.use(requireTenant);

// GET /api/workers — managers only; tenant-scoped
router.get('/', workerManagerOnly, async (req, res) => {
  const { active } = req.query;
  let query = db('users')
    .where('tenant_id', req.tenant_id)
    .whereIn('role', [ROLES.WORKER, 'crocheter'])
    .orderBy('name')
    .select('id', 'name', 'email', 'phone', 'role', 'wage_mode', 'wage_rate', 'is_active', 'status', 'created_at', 'tenant_id');
  if (active !== undefined) query = query.where('is_active', active === 'true');
  const workers = await query;
  res.json(workers);
});

// GET /api/workers/:id — manager or self; tenant-scoped
router.get('/:id', async (req, res) => {
  const isManager = [ROLES.OWNER, ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.SUPER_ADMIN].includes(req.user.role);
  if (!isManager && req.user.id !== parseInt(req.params.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const worker = await db('users')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .select('id', 'name', 'email', 'phone', 'role', 'wage_mode', 'wage_rate', 'is_active', 'status', 'created_at')
    .first();
  if (!worker) return res.status(404).json({ error: 'Worker not found' });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const stats = await db('production_entries')
    .where('worker_id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .where('production_date', '>=', thirtyDaysAgo)
    .select(
      db.raw('SUM(quantity) as total_pieces'),
      db.raw('SUM(labor_cost) as total_earnings'),
      db.raw('COUNT(id) as entry_count')
    ).first();

  res.json({ ...worker, stats });
});

// POST /api/workers — manager only; inserts into same tenant
router.post('/', workerManagerOnly, [
  body('name').trim().notEmpty().withMessage('Worker name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('wage_mode').isIn(['per_piece', 'per_hour', 'per_day']),
  body('wage_rate').isFloat({ min: 0 }),
  body('phone').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, email, password, wage_mode, wage_rate, phone } = req.body;

  // Check plan limits for max_workers
  const tenant = await db('tenants').where('id', req.tenant_id).first();
  if (tenant) {
    const plan = await db('plans').where('id', tenant.plan_id).first();
    if (plan && plan.max_workers !== -1) {
      const currentWorkerCount = await db('users')
        .where('tenant_id', req.tenant_id)
        .whereIn('role', [ROLES.WORKER, 'crocheter'])
        .where('is_active', true)
        .count('id as count')
        .first();
      if (parseInt(currentWorkerCount.count) >= plan.max_workers) {
        return res.status(402).json({
          error: 'Worker limit reached',
          message: `Your ${plan.name} plan allows up to ${plan.max_workers} workers. Upgrade to add more.`,
          code: 'PLAN_LIMIT_REACHED',
          limit_key: 'max_workers',
          limit: plan.max_workers,
          used: parseInt(currentWorkerCount.count),
        });
      }
    }
  }

  const existing = await db('users').where('email', email).first();
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const password_hash = await bcrypt.hash(password, 10);
  const [id] = await db('users').insert({
    tenant_id: req.tenant_id,
    name,
    email,
    phone: phone || null,
    password_hash,
    role: ROLES.WORKER,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
    wage_mode,
    wage_rate: parseFloat(wage_rate),
  }).returning('id');
  const workerId = typeof id === 'object' ? id.id : id;

  const worker = await db('users').where('id', workerId)
    .select('id', 'name', 'email', 'phone', 'role', 'wage_mode', 'wage_rate', 'is_active', 'status', 'tenant_id').first();

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'WORKER_CREATED',
    target_type: 'users',
    target_id: workerId,
    ip_address: req.ip,
    details: { name, email, wage_mode, wage_rate },
  });

  res.status(201).json(worker);
});

// PUT /api/workers/:id — manager only; verify tenant
router.put('/:id', workerManagerOnly, async (req, res) => {
  const existing = await db('users')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!existing) return res.status(404).json({ error: 'Worker not found' });

  const { name, phone, wage_mode, wage_rate, is_active, status, password } = req.body;
  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (wage_mode !== undefined) updateData.wage_mode = wage_mode;
  if (wage_rate !== undefined) updateData.wage_rate = parseFloat(wage_rate);

  let shouldInvalidateSessions = false;

  if (is_active !== undefined) {
    updateData.is_active = Boolean(is_active);
    updateData.status = Boolean(is_active) ? ACCOUNT_STATUS.ACTIVE : ACCOUNT_STATUS.SUSPENDED;
    if (!Boolean(is_active)) shouldInvalidateSessions = true;
  } else if (status !== undefined) {
    updateData.status = status;
    updateData.is_active = status === ACCOUNT_STATUS.ACTIVE;
    if (status !== ACCOUNT_STATUS.ACTIVE) shouldInvalidateSessions = true;
  }

  if (password) {
    updateData.password_hash = await bcrypt.hash(password, 10);
    shouldInvalidateSessions = true;
  }

  if (shouldInvalidateSessions) {
    updateData.token_version = (existing.token_version || 1) + 1;
  }

  await db('users').where('id', req.params.id).where('tenant_id', req.tenant_id).update(updateData);
  const worker = await db('users').where('id', req.params.id)
    .select('id', 'name', 'email', 'phone', 'role', 'wage_mode', 'wage_rate', 'is_active', 'status').first();

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'WORKER_UPDATED',
    target_type: 'users',
    target_id: req.params.id,
    ip_address: req.ip,
    details: { updateData },
  });

  res.json(worker);
});

// DELETE /api/workers/:id — manager only; verify tenant
router.delete('/:id', workerManagerOnly, async (req, res) => {
  const workerId = req.params.id;
  const worker = await db('users')
    .where('id', workerId)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!worker) return res.status(404).json({ error: 'Worker not found' });

  if (req.user.id === parseInt(workerId)) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    await db('users').where('id', workerId).where('tenant_id', req.tenant_id).del();
    await logAuditEvent({
      tenant_id: req.tenant_id,
      user_id: req.user.id,
      action: 'WORKER_PERMANENTLY_DELETED',
      target_type: 'users',
      target_id: workerId,
      ip_address: req.ip,
    });
    res.json({ message: 'User deleted permanently' });
  } catch (err) {
    // If foreign key constraints exist on production entries/orders, deactivate and revoke sessions
    await db('users').where('id', workerId).where('tenant_id', req.tenant_id).update({
      is_active: false,
      status: ACCOUNT_STATUS.SUSPENDED,
      token_version: (worker.token_version || 1) + 1,
    });
    await logAuditEvent({
      tenant_id: req.tenant_id,
      user_id: req.user.id,
      action: 'WORKER_DEACTIVATED',
      target_type: 'users',
      target_id: workerId,
      ip_address: req.ip,
    });
    res.json({ message: 'Worker deactivated (historical logs preserved)' });
  }
});

module.exports = router;

