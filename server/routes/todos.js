const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, adminOnly, checkTenantLock } = require('../middleware/auth');

// All todo endpoints require authentication & admin access
router.use(authenticate);
router.use(adminOnly);
router.use(checkTenantLock);

/**
 * GET /api/todos/stats — Return count summary for dashboard/header
 */
router.get('/stats', async (req, res, next) => {
  try {
    const todos = await db('todos').where('tenant_id', req.tenant_id);

    const stats = {
      total: todos.length,
      pending: todos.filter(t => t.status === 'pending').length,
      in_progress: todos.filter(t => t.status === 'in_progress').length,
      completed: todos.filter(t => t.status === 'completed').length,
      high_priority: todos.filter(t => t.priority === 'high' && t.status !== 'completed').length,
    };

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/todos — List all todos for tenant
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, priority, search } = req.query;
    let query = db('todos')
      .leftJoin('users', 'todos.user_id', 'users.id')
      .select(
        'todos.*',
        'users.name as creator_name'
      )
      .where('todos.tenant_id', req.tenant_id)
      .orderBy('todos.created_at', 'desc');

    if (status && status !== 'all') {
      query = query.where('todos.status', status);
    }

    if (priority && priority !== 'all') {
      query = query.where('todos.priority', priority);
    }

    if (search) {
      const searchLower = `%${search.toLowerCase()}%`;
      query = query.where((q) => {
        q.whereRaw('LOWER(todos.title) LIKE ?', [searchLower])
         .orWhereRaw('LOWER(todos.description) LIKE ?', [searchLower]);
      });
    }

    const todos = await query;
    res.json(todos);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/todos/:id — Single todo detail
 */
router.get('/:id', async (req, res, next) => {
  try {
    const todo = await db('todos')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .first();

    if (!todo) return res.status(404).json({ error: 'To-Do item not found' });
    res.json(todo);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/todos — Create a new todo
 */
router.post(
  '/',
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('status').optional().isIn(['pending', 'in_progress', 'completed']).withMessage('Invalid status'),
    body('priority').optional().isIn(['low', 'medium', 'high']).withMessage('Invalid priority'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { title, description, status, priority, due_date } = req.body;

      const [id] = await db('todos').insert({
        tenant_id: req.tenant_id,
        user_id: req.user.id,
        title,
        description: description || null,
        status: status || 'pending',
        priority: priority || 'medium',
        due_date: due_date || null,
        created_at: new Date(),
        updated_at: new Date(),
      }).returning('id');

      const createdId = typeof id === 'object' ? id.id : id;
      const created = await db('todos').where('id', createdId).first();
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/todos/:id — Update a todo item
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const todo = await db('todos')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .first();

    if (!todo) return res.status(404).json({ error: 'To-Do item not found' });

    const updates = {};
    const allowed = ['title', 'description', 'status', 'priority', 'due_date'];

    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    updates.updated_at = new Date();

    await db('todos')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .update(updates);

    const updated = await db('todos').where('id', req.params.id).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/todos/completed/clear — Clear all completed todos for tenant
 */
router.delete('/completed/clear', async (req, res, next) => {
  try {
    const deletedCount = await db('todos')
      .where('tenant_id', req.tenant_id)
      .where('status', 'completed')
      .delete();

    res.json({ message: `${deletedCount} completed items cleared`, count: deletedCount });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/todos/:id — Delete a todo item
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await db('todos')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .delete();

    if (!deleted) return res.status(404).json({ error: 'To-Do item not found' });
    res.json({ message: 'To-Do item deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
