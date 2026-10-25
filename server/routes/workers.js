const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly } = require('../middleware/auth');

router.use(authenticate);

// GET /api/workers — admin only; tenant-scoped
router.get('/', adminOnly, async (req, res) => {
  const { active } = req.query;
  let query = db('users')
    .where('tenant_id', req.tenant_id)
    .where('role', 'worker')
    .orderBy('name')
    .select('id', 'name', 'email', 'role', 'wage_mode', 'wage_rate', 'is_active', 'created_at', 'tenant_id');
  if (active !== undefined) query = query.where('is_active', active === 'true');
  const workers = await query;
  res.json(workers);
});

// GET /api/workers/:id — admin or self; tenant-scoped
router.get('/:id', async (req, res) => {
  const isAdmin = ['owner', 'admin', 'super_admin'].includes(req.user.role);
  if (!isAdmin && req.user.id !== parseInt(req.params.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const worker = await db('users')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .select('id', 'name', 'email', 'role', 'wage_mode', 'wage_rate', 'is_active', 'created_at')
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

// POST /api/workers — admin only; inserts into same tenant
router.post('/', adminOnly, [
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('wage_mode').isIn(['per_piece', 'per_hour', 'per_day']),
  body('wage_rate').isFloat({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, email, password, wage_mode, wage_rate } = req.body;

  // Check plan limits for max_workers
  const tenant = await db('tenants').where('id', req.tenant_id).first();
  if (tenant) {
    const plan = await db('plans').where('id', tenant.plan_id).first();
    if (plan && plan.max_workers !== -1) {
      const currentWorkerCount = await db('users')
        .where('tenant_id', req.tenant_id)
        .where('role', 'worker')
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
    name, email, password_hash, role: 'worker', wage_mode, wage_rate: parseFloat(wage_rate),
  }).returning('id');
  const workerId = typeof id === 'object' ? id.id : id;

  const worker = await db('users').where('id', workerId)
    .select('id', 'name', 'email', 'role', 'wage_mode', 'wage_rate', 'is_active', 'tenant_id').first();
  res.status(201).json(worker);
});

// PUT /api/workers/:id — admin only; verify tenant
router.put('/:id', adminOnly, async (req, res) => {
  const existing = await db('users')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!existing) return res.status(404).json({ error: 'Worker not found' });

  const { name, wage_mode, wage_rate, is_active, status, password } = req.body;
  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (wage_mode !== undefined) updateData.wage_mode = wage_mode;
  if (wage_rate !== undefined) updateData.wage_rate = parseFloat(wage_rate);
  if (is_active !== undefined) updateData.is_active = Boolean(is_active);
  else if (status !== undefined) updateData.is_active = status === 'active';
  if (password) updateData.password_hash = await bcrypt.hash(password, 10);

  await db('users').where('id', req.params.id).where('tenant_id', req.tenant_id).update(updateData);
  const worker = await db('users').where('id', req.params.id)
    .select('id', 'name', 'email', 'role', 'wage_mode', 'wage_rate', 'is_active').first();
  res.json(worker);
});

// DELETE /api/workers/:id — admin only; verify tenant
router.delete('/:id', adminOnly, async (req, res) => {
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
    res.json({ message: 'User deleted permanently' });
  } catch (err) {
    await db('users').where('id', workerId).where('tenant_id', req.tenant_id).update({ is_active: false });
    res.json({ message: 'Worker deactivated (historical logs preserved)' });
  }
});

module.exports = router;
