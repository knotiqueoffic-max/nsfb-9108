const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly, checkTenantLock } = require('../middleware/auth');

// All expense endpoints require auth + admin
router.use(authenticate);
router.use(adminOnly);
router.use(checkTenantLock);

const CATEGORIES = ['office', 'shipping', 'equipment', 'travel', 'salaries', 'marketing', 'other'];
const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'card', 'cheque'];

/**
 * GET /api/expenses/stats — Summary totals by category for a date range
 */
router.get('/stats', async (req, res, next) => {
  try {
    const { start_date, end_date } = req.query;

    let query = db('expenses').where('tenant_id', req.tenant_id);
    if (start_date) query = query.where('expense_date', '>=', start_date);
    if (end_date)   query = query.where('expense_date', '<=', end_date);

    const rows = await query;

    const total = rows.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);

    // Group by category
    const byCategory = {};
    CATEGORIES.forEach(cat => { byCategory[cat] = 0; });
    rows.forEach(r => {
      byCategory[r.category] = (byCategory[r.category] || 0) + parseFloat(r.amount || 0);
    });

    // Group by payment method
    const byPaymentMethod = {};
    PAYMENT_METHODS.forEach(m => { byPaymentMethod[m] = 0; });
    rows.forEach(r => {
      byPaymentMethod[r.payment_method] = (byPaymentMethod[r.payment_method] || 0) + parseFloat(r.amount || 0);
    });

    // This month totals
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const thisMonthRows = await db('expenses')
      .where('tenant_id', req.tenant_id)
      .where('expense_date', '>=', monthStart);
    const thisMonth = thisMonthRows.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);

    res.json({ total, this_month: thisMonth, by_category: byCategory, by_payment_method: byPaymentMethod, count: rows.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/expenses — List all expenses with optional filters
 */
router.get('/', async (req, res, next) => {
  try {
    const { category, payment_method, start_date, end_date, search } = req.query;

    let query = db('expenses')
      .leftJoin('users', 'expenses.user_id', 'users.id')
      .select('expenses.*', 'users.name as paid_by_name')
      .where('expenses.tenant_id', req.tenant_id)
      .orderBy('expenses.expense_date', 'desc')
      .orderBy('expenses.created_at', 'desc');

    if (category && category !== 'all') query = query.where('expenses.category', category);
    if (payment_method && payment_method !== 'all') query = query.where('expenses.payment_method', payment_method);
    if (start_date) query = query.where('expenses.expense_date', '>=', start_date);
    if (end_date)   query = query.where('expenses.expense_date', '<=', end_date);

    if (search) {
      const q = `%${search.toLowerCase()}%`;
      query = query.where((builder) => {
        builder
          .whereRaw('LOWER(expenses.vendor) LIKE ?', [q])
          .orWhereRaw('LOWER(expenses.notes) LIKE ?', [q])
          .orWhereRaw('LOWER(expenses.receipt_ref) LIKE ?', [q]);
      });
    }

    const expenses = await query;
    res.json(expenses);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/expenses/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const expense = await db('expenses')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .first();
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json(expense);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/expenses — Create expense
 */
router.post(
  '/',
  [
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be a positive number'),
    body('expense_date').isDate().withMessage('A valid expense date is required'),
    body('category').isIn(CATEGORIES).withMessage('Invalid category'),
    body('payment_method').isIn(PAYMENT_METHODS).withMessage('Invalid payment method'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { amount, category, expense_date, payment_method, vendor, receipt_ref, notes } = req.body;

      const [id] = await db('expenses').insert({
        tenant_id:      req.tenant_id,
        user_id:        req.user.id,
        amount:         parseFloat(amount),
        category:       category || 'other',
        expense_date,
        payment_method: payment_method || 'cash',
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
  }
);

/**
 * PATCH /api/expenses/:id — Update expense
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const expense = await db('expenses')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .first();
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const allowed = ['amount', 'category', 'expense_date', 'payment_method', 'vendor', 'receipt_ref', 'notes', 'payment_status'];
    const updates = { updated_at: new Date() };
    allowed.forEach((f) => {
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
 * DELETE /api/expenses/:id — Delete expense
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await db('expenses')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .delete();
    if (!deleted) return res.status(404).json({ error: 'Expense not found' });
    res.json({ message: 'Expense deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
