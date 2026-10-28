const router = require('express').Router();
const db = require('../db/database');
const { authenticate, requireTenant } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');

router.use(authenticate);
router.use(requireTenant);

// Helper to attach request and order title
async function enrichSession(session) {
  if (!session) return null;
  let request_title = null;
  let order_number = null;

  if (session.request_id) {
    const reqRow = await db('production_requests').where('id', session.request_id).select('title').first();
    if (reqRow) request_title = reqRow.title;
  }

  if (session.order_id) {
    const ordRow = await db('orders').where('id', session.order_id).select('id', 'external_order_id', 'product_name').first();
    if (ordRow) order_number = ordRow.external_order_id || `#${ordRow.id}`;
  }

  // Calculate live current elapsed seconds if active
  let current_elapsed_seconds = session.duration_seconds || 0;
  if (session.status === 'active' && session.last_resumed_at) {
    const additional = Math.max(0, Math.floor((Date.now() - new Date(session.last_resumed_at).getTime()) / 1000));
    current_elapsed_seconds += additional;
  }

  return {
    ...session,
    request_title,
    order_number,
    current_elapsed_seconds,
  };
}

// GET /api/work-sessions/active — get user's current in-progress or paused session
router.get('/active', async (req, res) => {
  const session = await db('work_sessions')
    .where('user_id', req.user.id)
    .where('tenant_id', req.tenant_id)
    .whereIn('status', ['active', 'paused'])
    .orderBy('created_at', 'desc')
    .first();

  if (!session) return res.json({ session: null });

  const enriched = await enrichSession(session);
  res.json({ session: enriched });
});

// POST /api/work-sessions/start — start a new work session
router.post('/start', async (req, res) => {
  const { request_id, order_id, title = 'Focus Session', notes } = req.body;

  // Check if active or paused session already exists
  const existing = await db('work_sessions')
    .where('user_id', req.user.id)
    .where('tenant_id', req.tenant_id)
    .whereIn('status', ['active', 'paused'])
    .orderBy('created_at', 'desc')
    .first();

  if (existing) {
    // If client requested new without finishing, auto-finish previous
    if (req.body.force_new) {
      let finalDuration = existing.duration_seconds || 0;
      if (existing.status === 'active' && existing.last_resumed_at) {
        finalDuration += Math.max(0, Math.floor((Date.now() - new Date(existing.last_resumed_at).getTime()) / 1000));
      }
      await db('work_sessions').where('id', existing.id).update({
        duration_seconds: finalDuration,
        status: 'completed',
        end_time: new Date().toISOString(),
        last_resumed_at: null,
        updated_at: new Date().toISOString(),
      });
    } else {
      const enriched = await enrichSession(existing);
      return res.json({ session: enriched, message: 'Resumed existing active session' });
    }
  }

  const nowIso = new Date().toISOString();
  const [id] = await db('work_sessions').insert({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    request_id: request_id || null,
    order_id: order_id || null,
    title: title.trim(),
    notes: notes ? notes.trim() : null,
    start_time: nowIso,
    last_resumed_at: nowIso,
    duration_seconds: 0,
    status: 'active',
  }).returning('id');
  const resolvedId = typeof id === 'object' ? id.id : id;

  const newSession = await db('work_sessions').where('id', resolvedId).first();
  const enriched = await enrichSession(newSession);
  res.status(201).json({ session: enriched });
});

// POST /api/work-sessions/:id/pause — pause session
router.post('/:id/pause', async (req, res) => {
  const session = await db('work_sessions')
    .where('id', req.params.id)
    .where('user_id', req.user.id)
    .where('tenant_id', req.tenant_id)
    .first();

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'paused') {
    const enriched = await enrichSession(session);
    return res.json({ session: enriched });
  }
  if (session.status !== 'active') {
    return res.status(400).json({ error: `Cannot pause a session with status '${session.status}'` });
  }

  const now = Date.now();
  const lastResumed = session.last_resumed_at ? new Date(session.last_resumed_at).getTime() : now;
  const extraSeconds = Math.max(0, Math.floor((now - lastResumed) / 1000));
  const newDuration = (session.duration_seconds || 0) + extraSeconds;

  await db('work_sessions').where('id', session.id).update({
    duration_seconds: newDuration,
    status: 'paused',
    last_resumed_at: null,
    updated_at: new Date().toISOString(),
  });

  const updated = await db('work_sessions').where('id', session.id).first();
  const enriched = await enrichSession(updated);
  res.json({ session: enriched });
});

// POST /api/work-sessions/:id/resume — resume paused session
router.post('/:id/resume', async (req, res) => {
  const session = await db('work_sessions')
    .where('id', req.params.id)
    .where('user_id', req.user.id)
    .where('tenant_id', req.tenant_id)
    .first();

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'active') {
    const enriched = await enrichSession(session);
    return res.json({ session: enriched });
  }
  if (session.status !== 'paused') {
    return res.status(400).json({ error: `Cannot resume a session with status '${session.status}'` });
  }

  const nowIso = new Date().toISOString();
  await db('work_sessions').where('id', session.id).update({
    status: 'active',
    last_resumed_at: nowIso,
    updated_at: nowIso,
  });

  const updated = await db('work_sessions').where('id', session.id).first();
  const enriched = await enrichSession(updated);
  res.json({ session: enriched });
});

// POST /api/work-sessions/:id/finish — complete session and record final duration
router.post('/:id/finish', async (req, res) => {
  const session = await db('work_sessions')
    .where('id', req.params.id)
    .where('user_id', req.user.id)
    .where('tenant_id', req.tenant_id)
    .first();

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'completed') {
    const enriched = await enrichSession(session);
    return res.json({ session: enriched });
  }

  let finalDuration = session.duration_seconds || 0;
  if (session.status === 'active' && session.last_resumed_at) {
    const extra = Math.max(0, Math.floor((Date.now() - new Date(session.last_resumed_at).getTime()) / 1000));
    finalDuration += extra;
  }

  const { notes } = req.body;
  const updateData = {
    duration_seconds: finalDuration,
    status: 'completed',
    end_time: new Date().toISOString(),
    last_resumed_at: null,
    updated_at: new Date().toISOString(),
  };
  if (notes !== undefined) updateData.notes = notes ? notes.trim() : null;

  await db('work_sessions').where('id', session.id).update(updateData);

  const updated = await db('work_sessions').where('id', session.id).first();
  const enriched = await enrichSession(updated);
  res.json({ session: enriched });
});

// POST /api/work-sessions/:id/discard — cancel/discard session
router.post('/:id/discard', async (req, res) => {
  const session = await db('work_sessions')
    .where('id', req.params.id)
    .where('user_id', req.user.id)
    .where('tenant_id', req.tenant_id)
    .first();

  if (!session) return res.status(404).json({ error: 'Session not found' });

  await db('work_sessions').where('id', session.id).update({
    status: 'discarded',
    end_time: new Date().toISOString(),
    last_resumed_at: null,
    updated_at: new Date().toISOString(),
  });

  res.json({ message: 'Session discarded' });
});

// GET /api/work-sessions — list history of completed sessions
router.get('/', async (req, res) => {
  const isManager = [ROLES.OWNER, ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.SUPER_ADMIN].includes(req.user.role);
  let targetUserId = req.user.id;

  if (isManager && req.query.user_id) {
    targetUserId = parseInt(req.query.user_id);
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  const sessions = await db('work_sessions')
    .where('work_sessions.tenant_id', req.tenant_id)
    .where('work_sessions.user_id', targetUserId)
    .where('work_sessions.status', 'completed')
    .leftJoin('production_requests', 'work_sessions.request_id', 'production_requests.id')
    .leftJoin('orders', 'work_sessions.order_id', 'orders.id')
    .select(
      'work_sessions.*',
      'production_requests.title as request_title',
      'orders.external_order_id as order_number'
    )
    .orderBy('work_sessions.created_at', 'desc')
    .limit(limit);

  res.json(sessions);
});

module.exports = router;
