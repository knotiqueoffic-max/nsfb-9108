const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly } = require('../middleware/auth');
const { calcWorkerPayout, calcAllWorkerPayouts } = require('../services/payout.service');

router.use(authenticate);

// GET /api/payouts/mine - list payouts for the logged-in worker
router.get('/mine', async (req, res) => {
  const payouts = await db('payouts as py')
    .join('users as u', 'py.worker_id', 'u.id')
    .where('py.tenant_id', req.tenant_id)
    .where('py.worker_id', req.user.id)
    .select(
      'py.*',
      'py.total_amount as amount',
      'py.total_pieces as pieces',
      'py.total_hours as hours',
      'py.total_days as days',
      'u.name as worker_name',
      'u.wage_mode',
      'u.wage_rate'
    )
    .orderBy('py.created_at', 'desc');

  res.json(payouts);
});

// GET /api/payouts — list all payouts for this tenant
router.get('/', adminOnly, async (req, res) => {
  const { worker_id, status } = req.query;
  let query = db('payouts as py')
    .join('users as u', 'py.worker_id', 'u.id')
    .where('py.tenant_id', req.tenant_id)
    .select(
      'py.*',
      'py.total_amount as amount',
      'py.total_pieces as pieces',
      'py.total_hours as hours',
      'py.total_days as days',
      'u.name as worker_name',
      'u.wage_mode',
      'u.wage_rate'
    )
    .orderBy('py.created_at', 'desc');

  if (worker_id) query = query.where('py.worker_id', worker_id);
  if (status) query = query.where('py.status', status);

  const payouts = await query;
  res.json(payouts);
});

// GET /api/payouts/preview — preview payout without saving
router.get('/preview', adminOnly, async (req, res) => {
  const { worker_id, period_start, period_end } = req.query;
  if (!period_start || !period_end) return res.status(400).json({ error: 'period_start and period_end required' });

  if (worker_id) {
    const preview = await calcWorkerPayout(parseInt(worker_id), period_start, period_end, req.tenant_id);
    return res.json(preview);
  }
  const previews = await calcAllWorkerPayouts(period_start, period_end, req.tenant_id);
  res.json(previews);
});

// POST /api/payouts — generate and save a payout
router.post('/', adminOnly, [
  body('worker_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('period_start').isDate(),
  body('period_end').isDate(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { worker_id, period_start, period_end, notes } = req.body;

  if (worker_id) {
    // Verify worker belongs to this tenant
    const worker = await db('users')
      .where('id', worker_id)
      .where('tenant_id', req.tenant_id)
      .first();
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const summary = await calcWorkerPayout(parseInt(worker_id), period_start, period_end, req.tenant_id);

    const [id] = await db('payouts').insert({
      tenant_id:    req.tenant_id,
      worker_id:    parseInt(worker_id),
      period_start,
      period_end,
      total_pieces: summary.total_pieces,
      total_hours:  summary.total_hours,
      total_days:   summary.total_days,
      total_amount: summary.total_amount,
      status:       'ordered',
      notes:        notes || null,
    }).returning('id');
    const payoutId = typeof id === 'object' ? id.id : id;

    const payout = await db('payouts as py')
      .join('users as u', 'py.worker_id', 'u.id')
      .where('py.id', payoutId)
      .select(
        'py.*',
        'py.total_amount as amount',
        'py.total_pieces as pieces',
        'py.total_hours as hours',
        'py.total_days as days',
        'u.name as worker_name'
      )
      .first();

    res.status(201).json(payout);
  } else {
    // Bulk generate payouts for all active workers who have unpaid production entries in this period
    const previews = await calcAllWorkerPayouts(period_start, period_end, req.tenant_id);
    const createdPayouts = [];

    // Filter to workers who actually have something to be paid
    const workersToPay = previews.filter(p => p.total_amount > 0 || p.entry_count > 0);

    for (const summary of workersToPay) {
      // Check if payout already exists for this worker & exact period to prevent double-generating
      const existingPayout = await db('payouts')
        .where({
          tenant_id: req.tenant_id,
          worker_id: summary.worker_id,
          period_start,
          period_end,
        })
        .first();

      if (existingPayout) continue;

      const [id] = await db('payouts').insert({
        tenant_id:    req.tenant_id,
        worker_id:    summary.worker_id,
        period_start,
        period_end,
        total_pieces: summary.total_pieces,
        total_hours:  summary.total_hours,
        total_days:   summary.total_days,
        total_amount: summary.total_amount,
        status:       'ordered',
        notes:        notes || null,
      }).returning('id');
      const payoutId = typeof id === 'object' ? id.id : id;

      const payout = await db('payouts as py')
        .join('users as u', 'py.worker_id', 'u.id')
        .where('py.id', payoutId)
        .select(
          'py.*',
          'py.total_amount as amount',
          'py.total_pieces as pieces',
          'py.total_hours as hours',
          'py.total_days as days',
          'u.name as worker_name'
        )
        .first();

      createdPayouts.push(payout);
    }

    res.status(201).json(createdPayouts);
  }
});

// PUT /api/payouts/:id/mark-paid
router.put('/:id/mark-paid', adminOnly, async (req, res) => {
  const { status = 'paid', notes } = req.body;
  const payout = await db('payouts')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!payout) return res.status(404).json({ error: 'Payout not found' });

  if (!['ordered', 'received', 'paid'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  await db('payouts').where('id', req.params.id).where('tenant_id', req.tenant_id).update({
    status, paid_at: status === 'paid' ? db.fn.now() : null, notes: notes || payout.notes,
  });

  await db('production_entries')
    .where('tenant_id', req.tenant_id)
    .where('worker_id', payout.worker_id)
    .where('production_date', '>=', payout.period_start)
    .where('production_date', '<=', payout.period_end)
    .update({ status, is_paid: status === 'paid', paid_at: status === 'paid' ? db.fn.now() : null });

  const updated = await db('payouts as py')
    .join('users as u', 'py.worker_id', 'u.id')
    .where('py.id', req.params.id)
    .select(
      'py.*',
      'py.total_amount as amount',
      'py.total_pieces as pieces',
      'py.total_hours as hours',
      'py.total_days as days',
      'u.name as worker_name'
    )
    .first();
  res.json(updated);
});

// POST /api/payouts/bulk-update-status
router.post('/bulk-update-status', adminOnly, async (req, res) => {
  const { ids, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No payout IDs provided' });
  if (!['ordered', 'received', 'paid'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  await db('payouts').whereIn('id', ids).where('tenant_id', req.tenant_id).update({
    status, paid_at: status === 'paid' ? db.fn.now() : null,
  });

  for (const id of ids) {
    const payout = await db('payouts').where('id', id).where('tenant_id', req.tenant_id).first();
    if (payout) {
      await db('production_entries')
        .where('tenant_id', req.tenant_id)
        .where('worker_id', payout.worker_id)
        .where('production_date', '>=', payout.period_start)
        .where('production_date', '<=', payout.period_end)
        .update({ status, is_paid: status === 'paid', paid_at: status === 'paid' ? db.fn.now() : null });
    }
  }

  res.json({ message: `Updated ${ids.length} payouts and their production entries to status: ${status}` });
});

// DELETE /api/payouts/:id
router.delete('/:id', adminOnly, async (req, res) => {
  const rows = await db('payouts').where('id', req.params.id).where('tenant_id', req.tenant_id).del();
  if (!rows) return res.status(404).json({ error: 'Payout not found' });
  res.json({ message: 'Payout deleted' });
});

module.exports = router;
