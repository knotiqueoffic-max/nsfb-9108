/**
 * /api/payments — Consolidated financial tracking for Knotique owners/admins.
 *
 * Four resource groups:
 *   /settlements      — Platform money coming IN (orders payment status)
 *   /payouts          — Worker money going OUT (proxies existing payouts table)
 *   /material-expenses — Purchase log payment status
 *   /other-expenses   — General expenses (expenses table)
 *   /overview         — Aggregated financial snapshot for a date range
 *
 * ALL endpoints require adminOnly (owner / admin / super_admin).
 * Workers get 403 on everything here.
 */
const router = require('express').Router();
const db = require('../db/database');
const { authenticate, adminOnly } = require('../middleware/auth');

router.use(authenticate, adminOnly);

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PLATFORMS = ['flipkart', 'meesho', 'myntra', 'etsy', 'amazon'];

function parseDate(str) {
  return str ? str : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTLEMENTS  (money coming IN from platforms — lump-sum model)
//
// Flipkart / Meesho / etc. do NOT pay per order. They send one bank transfer
// covering many orders (weekly / fortnightly). We track those transfers here.
//
// Total Expected = sum of (unit_price × qty) for all orders (from orders table)
// Total Received = sum of all entries in platform_settlement_payments table
// Net Pending    = Expected − Received
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/payments/settlements/summary
 * Returns totals broken down by platform.
 * Expected comes from orders; Received comes from platform_settlement_payments.
 */
router.get('/settlements/summary', async (req, res, next) => {
  try {
    const { start, end } = req.query;

    // ── Expected (from orders) ────────────────────────────────────────────────
    let oq = db('orders').where('tenant_id', req.tenant_id);
    if (start) oq = oq.where('order_date', '>=', start);
    if (end)   oq = oq.where('order_date', '<=', end);
    const orders = await oq.select('platform', 'unit_price', 'quantity');

    // ── Received (from settlement payment log) ────────────────────────────────
    let sq = db('platform_settlement_payments').where('tenant_id', req.tenant_id);
    if (start) sq = sq.where('settlement_date', '>=', start);
    if (end)   sq = sq.where('settlement_date', '<=', end);
    const settlements = await sq.select('platform', 'amount');

    const summary = { total_expected: 0, total_received: 0, by_platform: {} };
    [...PLATFORMS, 'manual'].forEach(p => {
      summary.by_platform[p] = { expected: 0, received: 0, pending: 0 };
    });

    orders.forEach(o => {
      const exp = parseFloat(o.unit_price || 0) * (o.quantity || 1);
      summary.total_expected += exp;
      const pkey = o.platform || 'manual';
      if (!summary.by_platform[pkey]) summary.by_platform[pkey] = { expected: 0, received: 0, pending: 0 };
      summary.by_platform[pkey].expected += exp;
    });

    settlements.forEach(s => {
      const amt = parseFloat(s.amount || 0);
      summary.total_received += amt;
      const pkey = s.platform || 'manual';
      if (!summary.by_platform[pkey]) summary.by_platform[pkey] = { expected: 0, received: 0, pending: 0 };
      summary.by_platform[pkey].received += amt;
    });

    Object.keys(summary.by_platform).forEach(p => {
      summary.by_platform[p].pending =
        summary.by_platform[p].expected - summary.by_platform[p].received;
    });
    summary.total_pending = summary.total_expected - summary.total_received;

    res.json(summary);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments/settlement-payments
 * List all logged settlement payments (lump sums received from platforms).
 */
router.get('/settlement-payments', async (req, res, next) => {
  try {
    const { platform, start, end, limit = 100, offset = 0 } = req.query;

    let q = db('platform_settlement_payments as sp')
      .leftJoin('users as u', 'sp.created_by', 'u.id')
      .where('sp.tenant_id', req.tenant_id)
      .select('sp.*', 'u.name as created_by_name')
      .orderBy('sp.settlement_date', 'desc')
      .orderBy('sp.created_at', 'desc');

    if (platform) q = q.where('sp.platform', platform);
    if (start)    q = q.where('sp.settlement_date', '>=', start);
    if (end)      q = q.where('sp.settlement_date', '<=', end);

    const totalQ = q.clone().clearSelect().clearOrder().count('sp.id as count');
    const [{ count }] = await totalQ;
    const rows = await q.limit(parseInt(limit)).offset(parseInt(offset));

    res.json({ payments: rows, total: parseInt(count) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payments/settlement-payments
 * Log a new lump-sum settlement received from a platform.
 * Body: { platform, amount, settlement_date, reference_no?, notes? }
 */
router.post('/settlement-payments', async (req, res, next) => {
  try {
    const { platform, amount, settlement_date, reference_no, notes } = req.body;

    if (!platform) return res.status(400).json({ error: 'platform is required' });
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (!settlement_date) return res.status(400).json({ error: 'settlement_date is required' });

    const [id] = await db('platform_settlement_payments').insert({
      tenant_id:       req.tenant_id,
      platform,
      amount:          parseFloat(amount),
      settlement_date,
      reference_no:    reference_no || null,
      notes:           notes || null,
      created_by:      req.user.id,
      created_at:      new Date(),
      updated_at:      new Date(),
    }).returning('id');

    const createdId = typeof id === 'object' ? id.id : id;
    const created = await db('platform_settlement_payments').where('id', createdId).first();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/payments/settlement-payments/:id
 * Edit a settlement payment entry.
 */
router.put('/settlement-payments/:id', async (req, res, next) => {
  try {
    const entry = await db('platform_settlement_payments')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .first();
    if (!entry) return res.status(404).json({ error: 'Settlement payment not found' });

    const { platform, amount, settlement_date, reference_no, notes } = req.body;
    const updates = { updated_at: new Date() };
    if (platform)        updates.platform = platform;
    if (amount != null)  updates.amount = parseFloat(amount);
    if (settlement_date) updates.settlement_date = settlement_date;
    if (reference_no !== undefined) updates.reference_no = reference_no || null;
    if (notes !== undefined)        updates.notes = notes || null;

    await db('platform_settlement_payments')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .update(updates);

    const updated = await db('platform_settlement_payments').where('id', req.params.id).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/payments/settlement-payments/:id
 * Delete a settlement payment entry.
 */
router.delete('/settlement-payments/:id', async (req, res, next) => {
  try {
    const deleted = await db('platform_settlement_payments')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .delete();
    if (!deleted) return res.status(404).json({ error: 'Settlement payment not found' });
    res.json({ message: 'Settlement payment deleted' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments/settlements
 * Reference view: list of orders with their selling prices (for context/reference only).
 * This shows what orders are outstanding — not their individual payment status.
 */
router.get('/settlements', async (req, res, next) => {
  try {
    const { platform, start, end, search, limit = 50, offset = 0 } = req.query;

    let q = db('orders as o')
      .leftJoin('products as p', 'o.product_id', 'p.id')
      .where('o.tenant_id', req.tenant_id)
      .select(
        'o.id', 'o.external_order_id', 'o.platform', 'o.sku',
        'o.product_name', 'o.quantity', 'o.unit_price',
        'o.order_date', 'o.status',
        'p.name as product_name_resolved',
        db.raw('o.unit_price * o.quantity as expected_amount'),
      )
      .orderBy('o.order_date', 'desc');

    if (platform) q = q.where('o.platform', platform);
    if (start)    q = q.where('o.order_date', '>=', start);
    if (end)      q = q.where('o.order_date', '<=', end);
    if (search) {
      q = q.where(function () {
        this.whereILike('o.external_order_id', `%${search}%`)
            .orWhereILike('o.product_name', `%${search}%`)
            .orWhereILike('o.sku', `%${search}%`);
      });
    }

    const totalQ = q.clone().clearSelect().clearOrder().count('o.id as count');
    const [{ count }] = await totalQ;
    const rows = await q.limit(parseInt(limit)).offset(parseInt(offset));

    res.json({ settlements: rows, total: parseInt(count) });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WORKER PAYOUTS  (money going OUT)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/payments/payouts/summary
 * Aggregate totals: earned, paid, pending for a date range.
 */
router.get('/payouts/summary', async (req, res, next) => {
  try {
    const { start, end } = req.query;

    let q = db('payouts').where('tenant_id', req.tenant_id);
    if (start) q = q.where('period_start', '>=', start);
    if (end)   q = q.where('period_end', '<=', end);

    const payouts = await q.select('status', 'total_amount');

    let total_earned = 0;
    let total_paid = 0;
    let total_pending = 0;

    payouts.forEach(p => {
      const amt = parseFloat(p.total_amount || 0);
      total_earned += amt;
      if (p.status === 'paid') total_paid += amt;
      else total_pending += amt;
    });

    res.json({ total_earned, total_paid, total_pending });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments/payouts
 * List payouts with worker info. Mirrors /api/payouts but scoped here.
 */
router.get('/payouts', async (req, res, next) => {
  try {
    const { worker_id, status, start, end, limit = 50, offset = 0 } = req.query;

    let q = db('payouts as py')
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
        'u.wage_rate',
      )
      .orderBy('py.created_at', 'desc');

    if (worker_id) q = q.where('py.worker_id', worker_id);
    if (status)    q = q.where('py.status', status);
    if (start)     q = q.where('py.period_start', '>=', start);
    if (end)       q = q.where('py.period_end', '<=', end);

    const totalQuery = q.clone().clearSelect().clearOrder().count('py.id as count');
    const [{ count }] = await totalQuery;
    const rows = await q.limit(parseInt(limit)).offset(parseInt(offset));

    res.json({ payouts: rows, total: parseInt(count) });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MATERIAL EXPENSES  (purchase_log — money going OUT to suppliers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/payments/material-expenses/summary
 * Totals: paid to suppliers, pending, broken down.
 */
router.get('/material-expenses/summary', async (req, res, next) => {
  try {
    const { start, end } = req.query;

    let q = db('purchase_log').where('tenant_id', req.tenant_id);
    if (start) q = q.where('purchase_date', '>=', start);
    if (end)   q = q.where('purchase_date', '<=', end);

    const rows = await q.select('payment_status', 'total_cost');

    let total_paid = 0;
    let total_pending = 0;

    rows.forEach(r => {
      const amt = parseFloat(r.total_cost || 0);
      if ((r.payment_status || 'paid') === 'paid') total_paid += amt;
      else total_pending += amt;
    });

    res.json({ total_paid, total_pending, total_spent: total_paid + total_pending });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments/material-expenses
 * List purchase_log entries with payment info.
 */
router.get('/material-expenses', async (req, res, next) => {
  try {
    const { payment_status, start, end, material_id, limit = 50, offset = 0 } = req.query;

    let q = db('purchase_log as pl')
      .join('raw_materials as rm', 'pl.material_id', 'rm.id')
      .leftJoin('users as u', 'pl.created_by', 'u.id')
      .where('pl.tenant_id', req.tenant_id)
      .select(
        'pl.*',
        'rm.name as material_name',
        'rm.unit',
        'u.name as created_by_name',
      )
      .orderBy('pl.purchase_date', 'desc');

    if (payment_status) q = q.where('pl.payment_status', payment_status);
    if (start)          q = q.where('pl.purchase_date', '>=', start);
    if (end)            q = q.where('pl.purchase_date', '<=', end);
    if (material_id)    q = q.where('pl.material_id', material_id);

    const totalQuery = q.clone().clearSelect().clearOrder().count('pl.id as count');
    const [{ count }] = await totalQuery;
    const rows = await q.limit(parseInt(limit)).offset(parseInt(offset));

    res.json({ purchases: rows, total: parseInt(count) });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/payments/material-expenses/:id/mark-paid
 * Mark a purchase as paid.
 * Body: { payment_date? }
 */
router.put('/material-expenses/:id/mark-paid', async (req, res, next) => {
  try {
    const purchase = await db('purchase_log')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .first();
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    await db('purchase_log').where('id', req.params.id).update({
      payment_status: 'paid',
      payment_date: req.body.payment_date || new Date().toISOString().split('T')[0],
    });

    const updated = await db('purchase_log').where('id', req.params.id).first();
    res.json({ purchase: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/payments/material-expenses/:id/mark-pending
 * Revert a purchase payment status to pending.
 */
router.put('/material-expenses/:id/mark-pending', async (req, res, next) => {
  try {
    const purchase = await db('purchase_log')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .first();
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    await db('purchase_log').where('id', req.params.id).update({
      payment_status: 'pending',
      payment_date: null,
    });

    const updated = await db('purchase_log').where('id', req.params.id).first();
    res.json({ purchase: updated });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// OTHER EXPENSES  (expenses table — general business costs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/payments/other-expenses/summary
 */
router.get('/other-expenses/summary', async (req, res, next) => {
  try {
    const { start, end } = req.query;

    let q = db('expenses').where('tenant_id', req.tenant_id);
    if (start) q = q.where('expense_date', '>=', start);
    if (end)   q = q.where('expense_date', '<=', end);

    const rows = await q.select('payment_status', 'amount');

    let total_paid = 0;
    let total_pending = 0;

    rows.forEach(r => {
      const amt = parseFloat(r.amount || 0);
      if ((r.payment_status || 'paid') === 'paid') total_paid += amt;
      else total_pending += amt;
    });

    res.json({ total_paid, total_pending, total_spent: total_paid + total_pending });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments/other-expenses
 * List expenses, filterable.
 */
router.get('/other-expenses', async (req, res, next) => {
  try {
    const { category, payment_status, start, end, search, limit = 50, offset = 0 } = req.query;

    let q = db('expenses')
      .leftJoin('users', 'expenses.user_id', 'users.id')
      .select('expenses.*', 'users.name as paid_by_name')
      .where('expenses.tenant_id', req.tenant_id)
      .orderBy('expenses.expense_date', 'desc');

    if (category && category !== 'all') q = q.where('expenses.category', category);
    if (payment_status)                  q = q.where('expenses.payment_status', payment_status);
    if (start)                           q = q.where('expenses.expense_date', '>=', start);
    if (end)                             q = q.where('expenses.expense_date', '<=', end);
    if (search) {
      const s = `%${search.toLowerCase()}%`;
      q = q.where(builder => {
        builder
          .whereRaw('LOWER(expenses.vendor) LIKE ?', [s])
          .orWhereRaw('LOWER(expenses.notes) LIKE ?', [s]);
      });
    }

    const totalQuery = q.clone().clearSelect().clearOrder().count('expenses.id as count');
    const [{ count }] = await totalQuery;
    const rows = await q.limit(parseInt(limit)).offset(parseInt(offset));

    res.json({ expenses: rows, total: parseInt(count) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payments/other-expenses
 * Create a new expense entry.
 */
const EXPENSE_CATEGORIES = ['office', 'shipping', 'equipment', 'travel', 'salaries', 'marketing', 'other'];
const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'card', 'cheque'];

router.post('/other-expenses', async (req, res, next) => {
  try {
    const {
      amount, category, expense_date, payment_method,
      vendor, receipt_ref, notes, payment_status,
    } = req.body;

    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: 'amount is required and must be a number' });
    }
    if (!expense_date) {
      return res.status(400).json({ error: 'expense_date is required' });
    }
    if (category && !EXPENSE_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    if (payment_method && !PAYMENT_METHODS.includes(payment_method)) {
      return res.status(400).json({ error: 'Invalid payment_method' });
    }

    const [id] = await db('expenses').insert({
      tenant_id:      req.tenant_id,
      user_id:        req.user.id,
      amount:         parseFloat(amount),
      category:       category || 'other',
      expense_date,
      payment_method: payment_method || 'cash',
      payment_status: payment_status || 'paid',
      vendor:         vendor || null,
      receipt_ref:    receipt_ref || null,
      notes:          notes || null,
      created_at:     new Date(),
      updated_at:     new Date(),
    }).returning('id');

    const createdId = typeof id === 'object' ? id.id : id;
    const created = await db('expenses').where('id', createdId).first();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/payments/other-expenses/:id
 * Update an expense (including payment_status).
 */
router.patch('/other-expenses/:id', async (req, res, next) => {
  try {
    const expense = await db('expenses')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .first();
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const allowed = [
      'amount', 'category', 'expense_date', 'payment_method',
      'vendor', 'receipt_ref', 'notes', 'payment_status',
    ];
    const updates = { updated_at: new Date() };
    allowed.forEach(f => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    if (updates.amount !== undefined) updates.amount = parseFloat(updates.amount);

    await db('expenses')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .update(updates);

    const updated = await db('expenses').where('id', req.params.id).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/payments/other-expenses/:id
 */
router.delete('/other-expenses/:id', async (req, res, next) => {
  try {
    const deleted = await db('expenses')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .delete();
    if (!deleted) return res.status(404).json({ error: 'Expense not found' });
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW  (combined financial snapshot)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/payments/overview
 * Returns a full financial snapshot for a given date range, plus chart data.
 * Query params: start, end, group_by ('week' | 'month', default 'month')
 */
router.get('/overview', async (req, res, next) => {
  try {
    const { start, end, group_by = 'month' } = req.query;

    // ── Settlements ──────────────────────────────────────────────────────────
    let ordQ = db('orders').where('tenant_id', req.tenant_id);
    if (start) ordQ = ordQ.where('order_date', '>=', start);
    if (end)   ordQ = ordQ.where('order_date', '<=', end);
    const orders = await ordQ.select('order_date', 'quantity', 'unit_price');

    // Received comes from platform settlement payments (lump sums)
    let sttlQ = db('platform_settlement_payments').where('tenant_id', req.tenant_id);
    if (start) sttlQ = sttlQ.where('settlement_date', '>=', start);
    if (end)   sttlQ = sttlQ.where('settlement_date', '<=', end);
    const settlementPayments = await sttlQ.select('settlement_date', 'amount', 'platform');

    let total_expected = 0;
    let total_received = 0;
    orders.forEach(o => {
      total_expected += parseFloat(o.unit_price || 0) * (o.quantity || 1);
    });
    settlementPayments.forEach(s => {
      total_received += parseFloat(s.amount || 0);
    });
    const total_pending_receivable = total_expected - total_received;

    // ── Worker Payouts ────────────────────────────────────────────────────────
    let payQ = db('payouts').where('tenant_id', req.tenant_id);
    if (start) payQ = payQ.where('period_start', '>=', start);
    if (end)   payQ = payQ.where('period_end', '<=', end);
    const payouts = await payQ.select('status', 'total_amount', 'paid_at', 'period_start');

    let total_paid_workers = 0;
    let total_pending_workers = 0;
    payouts.forEach(p => {
      const amt = parseFloat(p.total_amount || 0);
      if (p.status === 'paid') total_paid_workers += amt;
      else total_pending_workers += amt;
    });

    // ── Material Expenses ────────────────────────────────────────────────────
    let matQ = db('purchase_log').where('tenant_id', req.tenant_id);
    if (start) matQ = matQ.where('purchase_date', '>=', start);
    if (end)   matQ = matQ.where('purchase_date', '<=', end);
    const purchases = await matQ.select('payment_status', 'total_cost', 'purchase_date');

    let total_materials_paid = 0;
    let total_materials_pending = 0;
    purchases.forEach(p => {
      const amt = parseFloat(p.total_cost || 0);
      if ((p.payment_status || 'paid') === 'paid') total_materials_paid += amt;
      else total_materials_pending += amt;
    });

    // ── Other Expenses ───────────────────────────────────────────────────────
    let expQ = db('expenses').where('tenant_id', req.tenant_id);
    if (start) expQ = expQ.where('expense_date', '>=', start);
    if (end)   expQ = expQ.where('expense_date', '<=', end);
    const expenses = await expQ.select('payment_status', 'amount', 'expense_date');

    let total_other_paid = 0;
    let total_other_pending = 0;
    expenses.forEach(e => {
      const amt = parseFloat(e.amount || 0);
      if ((e.payment_status || 'paid') === 'paid') total_other_paid += amt;
      else total_other_pending += amt;
    });

    // ── Net Cash Position ─────────────────────────────────────────────────────
    // Net = Total Received − Total Paid Workers − Total Materials Spent − Total Other Expenses Paid
    const net_cash_position =
      total_received
      - total_paid_workers
      - total_materials_paid
      - total_other_paid;

    // ── Chart Data ────────────────────────────────────────────────────────────
    // Bucket events into weekly or monthly bins
    const buckets = {};

    function getBucket(dateStr) {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      if (isNaN(d)) return null;
      if (group_by === 'week') {
        // ISO week: YYYY-Www
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay() + 1); // Monday
        return startOfWeek.toISOString().split('T')[0];
      } else {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
    }

    function ensureBucket(key) {
      if (key && !buckets[key]) {
        buckets[key] = { period: key, money_in: 0, money_out: 0 };
      }
    }

    // Money in: settlement payments received from platforms (lump sums)
    settlementPayments.forEach(s => {
      const key = getBucket(s.settlement_date);
      ensureBucket(key);
      if (key) buckets[key].money_in += parseFloat(s.amount || 0);
    });

    // Money out: paid worker payouts
    payouts.forEach(p => {
      if (p.status === 'paid') {
        const key = getBucket(p.paid_at || p.period_start);
        ensureBucket(key);
        if (key) buckets[key].money_out += parseFloat(p.total_amount || 0);
      }
    });

    // Money out: paid material purchases
    purchases.forEach(p => {
      if ((p.payment_status || 'paid') === 'paid') {
        const key = getBucket(p.purchase_date);
        ensureBucket(key);
        if (key) buckets[key].money_out += parseFloat(p.total_cost || 0);
      }
    });

    // Money out: paid other expenses
    expenses.forEach(e => {
      if ((e.payment_status || 'paid') === 'paid') {
        const key = getBucket(e.expense_date);
        ensureBucket(key);
        if (key) buckets[key].money_out += parseFloat(e.amount || 0);
      }
    });

    const chart_data = Object.values(buckets).sort((a, b) =>
      a.period.localeCompare(b.period)
    );

    res.json({
      // Receivables
      total_expected,
      total_received,
      total_pending_receivable,
      // Workers
      total_paid_workers,
      total_pending_workers,
      // Materials
      total_materials_paid,
      total_materials_pending,
      // Other
      total_other_paid,
      total_other_pending,
      // Combined
      total_spent: total_paid_workers + total_materials_paid + total_other_paid,
      total_pending_outgoing: total_pending_workers + total_materials_pending + total_other_pending,
      // Net
      net_cash_position,
      net_cash_formula: 'Total Received − Total Paid to Workers − Total Materials Paid − Total Other Expenses Paid',
      // Chart
      chart_data,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
