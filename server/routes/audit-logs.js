const router = require('express').Router();
const db = require('../db/database');
const { authenticate, adminOnly, requireTenant } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');

router.use(authenticate);
router.use(requireTenant);
router.use(adminOnly);

// ─── GET /api/audit-logs — retrieve paginated audit log for tenant ─────────────
router.get('/', async (req, res) => {
  const { action, limit = 50, offset = 0 } = req.query;

  let query = db('audit_logs as al')
    .leftJoin('users as u', 'al.user_id', 'u.id')
    .where('al.tenant_id', req.tenant_id)
    .select('al.*', 'u.name as user_name', 'u.email as user_email')
    .orderBy('al.created_at', 'desc');

  if (action) {
    query = query.where('al.action', action);
  }

  const countQuery = query.clone().clearSelect().clearOrder().count('al.id as count');
  const [{ count }] = await countQuery;

  const logs = await query.limit(parseInt(limit)).offset(parseInt(offset));

  res.json({
    total: parseInt(count),
    logs,
  });
});

module.exports = router;
