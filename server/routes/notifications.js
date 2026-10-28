const router = require('express').Router();
const db = require('../db/database');
const { authenticate, requireTenant } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');

router.use(authenticate);
router.use(requireTenant);

// ─── GET /api/notifications — aggregated business alerts ──────────────────────
router.get('/', async (req, res) => {
  const alerts = [];
  const tid = req.tenant_id;
  const isManager = [ROLES.OWNER, ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.SUPER_ADMIN].includes(req.user.role);

  try {
    // 1. Low stock raw materials (for managers)
    if (isManager) {
      const lowMaterials = await db('raw_materials')
        .where('tenant_id', tid)
        .whereRaw('stock_quantity <= reorder_threshold')
        .select('id', 'name', 'stock_quantity', 'reorder_threshold', 'unit')
        .limit(5);

      lowMaterials.forEach(m => {
        alerts.push({
          id: `low-mat-${m.id}`,
          type: 'stock_alert',
          severity: m.stock_quantity === 0 ? 'critical' : 'warning',
          title: `Low Material Stock: ${m.name}`,
          message: `Stock is ${m.stock_quantity} ${m.unit} (reorder threshold is ${m.reorder_threshold} ${m.unit}).`,
          link: '/inventory',
          timestamp: new Date().toISOString(),
        });
      });

      // 2. Low finished goods stock (for managers)
      const lowGoods = await db('finished_goods_stock as fgs')
        .join('products as p', 'fgs.product_id', 'p.id')
        .where('fgs.tenant_id', tid)
        .whereRaw('fgs.quantity <= fgs.reorder_threshold')
        .select('p.id', 'p.name', 'p.sku', 'fgs.quantity', 'fgs.reorder_threshold')
        .limit(5);

      lowGoods.forEach(g => {
        alerts.push({
          id: `low-goods-${g.id}`,
          type: 'stock_alert',
          severity: g.quantity === 0 ? 'critical' : 'warning',
          title: `Low Finished Goods: ${g.name}`,
          message: `Only ${g.quantity} units available in inventory (reorder threshold is ${g.reorder_threshold}).`,
          link: '/products',
          timestamp: new Date().toISOString(),
        });
      });

      // 3. Pending invitations
      const pendingInvites = await db('invitations')
        .where('tenant_id', tid)
        .where('status', 'pending')
        .count('id as count')
        .first();

      if (pendingInvites && parseInt(pendingInvites.count) > 0) {
        alerts.push({
          id: 'pending-invitations',
          type: 'invitation',
          severity: 'info',
          title: 'Pending Invitations',
          message: `You have ${pendingInvites.count} pending member invitation(s) awaiting acceptance.`,
          link: '/settings',
          timestamp: new Date().toISOString(),
        });
      }

      // 4. Pending payouts / unapproved production entries
      const pendingPayouts = await db('production_entries')
        .where('tenant_id', tid)
        .whereIn('status', ['ordered', 'received'])
        .count('id as count')
        .sum('labor_cost as total_pending')
        .first();

      if (pendingPayouts && parseInt(pendingPayouts.count) > 0) {
        alerts.push({
          id: 'pending-payouts',
          type: 'production',
          severity: 'info',
          title: 'Unpaid Production Entries',
          message: `${pendingPayouts.count} piecework entries (₹${parseFloat(pendingPayouts.total_pending || 0).toFixed(2)}) ready for payout review.`,
          link: '/payouts',
          timestamp: new Date().toISOString(),
        });
      }

      // 5. Pending production work approval requests
      const hasSubmissionsTable = await db.schema.hasTable('production_submissions');
      if (hasSubmissionsTable) {
        const pendingSubmissions = await db('production_submissions')
          .where('tenant_id', tid)
          .where('status', 'pending_approval')
          .count('id as count')
          .first();

        if (pendingSubmissions && parseInt(pendingSubmissions.count) > 0) {
          alerts.push({
            id: 'pending-work-approvals',
            type: 'production_approval',
            severity: 'info',
            title: 'Production Approval Requests',
            message: `${pendingSubmissions.count} worker work submission(s) awaiting your review and approval.`,
            link: '/production-requests',
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // 5. Worker assigned tasks (for workers)
    if (req.user.role === ROLES.WORKER) {
      const pendingWork = await db('production_entries')
        .where('tenant_id', tid)
        .where('worker_id', req.user.id)
        .where('status', 'ordered')
        .count('id as count')
        .first();

      if (pendingWork && parseInt(pendingWork.count) > 0) {
        alerts.push({
          id: 'worker-pending-tasks',
          type: 'task',
          severity: 'info',
          title: 'Assigned Work in Progress',
          message: `You have ${pendingWork.count} active production task(s) in progress.`,
          link: '/production',
          timestamp: new Date().toISOString(),
        });
      }
    }

    res.json({
      unread_count: alerts.length,
      alerts,
    });
  } catch (err) {
    console.error('[Notifications Error]:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

module.exports = router;
