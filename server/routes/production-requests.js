const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, requireTenant } = require('../middleware/auth');
const {
  ROLES,
  PRODUCTION_REQUEST_STATUS,
  PRODUCTION_BID_STATUS,
  PRODUCTION_PROGRESS_STATUS,
  canCreateProductionRequest,
} = require('../constants/roles');
const { logAuditEvent } = require('../services/audit.service');

router.use(authenticate);
router.use(requireTenant);

// ─── Helper: Determine if caller is an eligible recipient for a request ────────
async function isEligibleRecipient(req, request) {
  const user = req.user;
  const tenantId = req.tenant_id;

  // Crocheter targeting
  if (request.target_role === ROLES.WORKER) {
    if (user.role !== ROLES.WORKER) return false;

    if (request.scope_type === 'specific') {
      const match = await db('production_request_recipients')
        .where('request_id', request.id)
        .where('recipient_type', 'user')
        .where('recipient_id', user.id)
        .first();
      return !!match;
    }

    // 'all_eligible': crocheters in the issuer's tenant
    return tenantId === request.tenant_id;
  }

  // Vendor targeting
  if (request.target_role === ROLES.VENDOR) {
    // Caller's tenant must be a vendor
    const callerTenant = await db('tenants').where('id', tenantId).first();
    if (!callerTenant || callerTenant.tenant_type !== 'vendor') {
      // Also allow if user is a vendor role
      if (user.role !== ROLES.VENDOR) return false;
    }

    if (request.scope_type === 'specific') {
      const match = await db('production_request_recipients')
        .where('request_id', request.id)
        .where('recipient_type', 'tenant')
        .where('recipient_id', tenantId)
        .first();
      return !!match;
    }

    // 'all_eligible': active supplier relationship with issuer
    const supplierRel = await db('supplier_relationships')
      .where('admin_tenant_id', request.tenant_id)
      .where('vendor_tenant_id', tenantId)
      .where('status', 'active')
      .first();
    return !!supplierRel;
  }

  // Subvendor targeting
  if (request.target_role === ROLES.SUBVENDOR) {
    // Caller's tenant must be a subvendor
    const callerTenant = await db('tenants').where('id', tenantId).first();
    if (!callerTenant || callerTenant.tenant_type !== 'subvendor') {
      if (user.role !== ROLES.SUBVENDOR) return false;
    }

    if (request.scope_type === 'specific') {
      const match = await db('production_request_recipients')
        .where('request_id', request.id)
        .where('recipient_type', 'tenant')
        .where('recipient_id', tenantId)
        .first();
      return !!match;
    }

    // 'all_eligible': active vendor_subvendor organization relationship
    const orgRel = await db('organization_relationships')
      .where('parent_tenant_id', request.tenant_id)
      .where('child_tenant_id', tenantId)
      .where('relationship_type', 'vendor_subvendor')
      .where('status', 'active')
      .first();
    return !!orgRel;
  }

  return false;
}

// ─── 1. POST /api/production-requests — Create request ─────────────────────────
router.post('/', [
  body('title').trim().notEmpty().withMessage('Request title is required'),
  body('target_role').isIn([ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.WORKER]).withMessage('Valid target role required (vendor, subvendor, worker)'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('submission_deadline').notEmpty().withMessage('Submission deadline is required'),
  body('completion_deadline').notEmpty().withMessage('Completion deadline is required'),
  body('scope_type').optional().isIn(['specific', 'all_eligible']),
  body('recipient_ids').optional().isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  // Crocheters cannot create production requests
  if (!canCreateProductionRequest(req.user.role)) {
    return res.status(403).json({ error: 'Permission denied: Crocheters cannot create production requests' });
  }

  const {
    title,
    target_role,
    quantity,
    unit = 'pieces',
    target_price,
    submission_deadline,
    completion_deadline,
    scope_type = 'all_eligible',
    recipient_ids = [],
    product_id,
    description,
    specifications,
    reference_image_url,
    required_materials,
    notes,
  } = req.body;

  // Authorization checks based on issuer hierarchy
  if (req.user.role === ROLES.VENDOR && target_role === ROLES.VENDOR) {
    return res.status(403).json({ error: 'Vendors cannot issue requests to other vendors' });
  }
  if (req.user.role === ROLES.SUBVENDOR && (target_role === ROLES.VENDOR || target_role === ROLES.SUBVENDOR)) {
    return res.status(403).json({ error: 'Subvendors can only issue requests to crocheters' });
  }

  // Validate linked product if provided
  if (product_id) {
    const prod = await db('products').where('id', product_id).where('tenant_id', req.tenant_id).first();
    if (!prod) return res.status(400).json({ error: 'Specified product not found in your organization' });
  }

  // Validate specific recipients if scope is specific
  if (scope_type === 'specific') {
    if (!recipient_ids.length) {
      return res.status(400).json({ error: 'Recipient IDs must be provided when scope is specific' });
    }

    if (target_role === ROLES.VENDOR) {
      const validLinks = await db('supplier_relationships')
        .where('admin_tenant_id', req.tenant_id)
        .whereIn('vendor_tenant_id', recipient_ids)
        .where('status', 'active');
      if (validLinks.length !== recipient_ids.length) {
        return res.status(400).json({ error: 'One or more vendor organizations are not linked approved suppliers' });
      }
    } else if (target_role === ROLES.SUBVENDOR) {
      const validSubvendors = await db('organization_relationships')
        .where('parent_tenant_id', req.tenant_id)
        .whereIn('child_tenant_id', recipient_ids)
        .where('status', 'active');
      if (validSubvendors.length !== recipient_ids.length) {
        return res.status(400).json({ error: 'One or more subvendors are not in your authorized organization network' });
      }
    } else if (target_role === ROLES.WORKER) {
      const validWorkers = await db('users')
        .where('tenant_id', req.tenant_id)
        .where('role', ROLES.WORKER)
        .whereIn('id', recipient_ids)
        .where('status', 'active');
      if (validWorkers.length !== recipient_ids.length) {
        return res.status(400).json({ error: 'One or more crocheters are not active members of your organization' });
      }
    }
  }

  const requestCode = `PR-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

  const createdRequestId = await db.transaction(async (trx) => {
    const [inserted] = await trx('production_requests').insert({
      tenant_id:           req.tenant_id,
      request_code:        requestCode,
      created_by:          req.user.id,
      target_role,
      scope_type,
      product_id:          product_id || null,
      title,
      description:         description || null,
      specifications:      specifications || null,
      reference_image_url: reference_image_url || null,
      quantity:            parseInt(quantity),
      unit:                unit || 'pieces',
      required_materials:  required_materials || null,
      target_price:        target_price ? parseFloat(target_price) : null,
      submission_deadline: new Date(submission_deadline).toISOString(),
      completion_deadline: new Date(completion_deadline).toISOString(),
      status:              PRODUCTION_REQUEST_STATUS.OPEN,
      notes:               notes || null,
    }).returning('id');
    const reqId = typeof inserted === 'object' ? inserted.id : inserted;

    if (scope_type === 'specific' && recipient_ids.length) {
      const recipientType = target_role === ROLES.WORKER ? 'user' : 'tenant';
      const recipientRows = recipient_ids.map(rid => ({
        request_id:     reqId,
        recipient_type: recipientType,
        recipient_id:   rid,
      }));
      await trx('production_request_recipients').insert(recipientRows);
    }

    return reqId;
  });

  const request = await db('production_requests').where('id', createdRequestId).first();

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'PRODUCTION_REQUEST_CREATED',
    target_type: 'production_requests',
    target_id: createdRequestId,
    ip_address: req.ip,
    details: { requestCode, target_role, quantity, scope_type },
  });

  res.status(201).json({
    message: 'Production request published successfully',
    request,
  });
});

// ─── 2. GET /api/production-requests — List requests ──────────────────────────
router.get('/', async (req, res) => {
  const { view = 'all', status } = req.query;
  const isManager = canCreateProductionRequest(req.user.role);

  // If viewing issued requests (for managers)
  if (view === 'issued' || (isManager && view !== 'received')) {
    let query = db('production_requests as pr')
      .leftJoin('products as p', 'pr.product_id', 'p.id')
      .where('pr.tenant_id', req.tenant_id)
      .select('pr.*', 'p.name as product_name', 'p.sku')
      .orderBy('pr.created_at', 'desc');

    if (status) query = query.where('pr.status', status);

    const requests = await query;

    // Attach bid counts for issuer view
    const requestIds = requests.map(r => r.id);
    const bidCounts = await db('production_bids')
      .whereIn('request_id', requestIds)
      .groupBy('request_id')
      .select('request_id', db.raw('COUNT(id) as bid_count'));
    const countMap = {};
    bidCounts.forEach(bc => { countMap[bc.request_id] = parseInt(bc.bid_count); });

    const enriched = requests.map(r => ({
      ...r,
      bid_count: countMap[r.id] || 0,
      is_issuer: true,
    }));

    return res.json({ requests: enriched });
  }

  // Viewing received / available requests (for bidders)
  // Fetch candidate requests based on role
  let candidateRequests = [];

  if (req.user.role === ROLES.WORKER) {
    // Requests targeted at worker
    candidateRequests = await db('production_requests as pr')
      .leftJoin('products as p', 'pr.product_id', 'p.id')
      .where('pr.target_role', ROLES.WORKER)
      .whereNotIn('pr.status', ['draft'])
      .select('pr.*', 'p.name as product_name', 'p.sku')
      .orderBy('pr.created_at', 'desc');
  } else if (req.user.role === ROLES.VENDOR) {
    candidateRequests = await db('production_requests as pr')
      .leftJoin('products as p', 'pr.product_id', 'p.id')
      .where('pr.target_role', ROLES.VENDOR)
      .whereNotIn('pr.status', ['draft'])
      .select('pr.*', 'p.name as product_name', 'p.sku')
      .orderBy('pr.created_at', 'desc');
  } else if (req.user.role === ROLES.SUBVENDOR) {
    candidateRequests = await db('production_requests as pr')
      .leftJoin('products as p', 'pr.product_id', 'p.id')
      .where('pr.target_role', ROLES.SUBVENDOR)
      .whereNotIn('pr.status', ['draft'])
      .select('pr.*', 'p.name as product_name', 'p.sku')
      .orderBy('pr.created_at', 'desc');
  }

  // Filter candidate requests to only those caller is authorized to see
  const authorized = [];
  for (const cr of candidateRequests) {
    const eligible = await isEligibleRecipient(req, cr);
    if (eligible) {
      authorized.push(cr);
    }
  }

  // Attach ONLY the caller's own bid (strict privacy guard: never return competitor bids!)
  const authorizedIds = authorized.map(r => r.id);
  const myBids = await db('production_bids')
    .whereIn('request_id', authorizedIds)
    .where(function () {
      if (req.user.role === ROLES.WORKER) {
        this.where('bidder_type', 'user').andWhere('bidder_id', req.user.id);
      } else {
        this.where('bidder_type', 'tenant').andWhere('bidder_id', req.tenant_id);
      }
    });

  const myBidMap = {};
  myBids.forEach(b => { myBidMap[b.request_id] = b; });

  const result = authorized.map(r => ({
    ...r,
    my_bid: myBidMap[r.id] || null,
    is_issuer: false,
  }));

  res.json({ requests: result });
});

// ─── 3. GET /api/production-requests/:id — Single request details ──────────────
router.get('/:id', async (req, res) => {
  const request = await db('production_requests as pr')
    .leftJoin('products as p', 'pr.product_id', 'p.id')
    .leftJoin('tenants as t', 'pr.tenant_id', 't.id')
    .where('pr.id', req.params.id)
    .select('pr.*', 'p.name as product_name', 'p.sku', 't.name as issuer_tenant_name')
    .first();

  if (!request) return res.status(404).json({ error: 'Production request not found' });

  const isIssuer = request.tenant_id === req.tenant_id;
  const isEligible = isIssuer ? true : await isEligibleRecipient(req, request);

  if (!isIssuer && !isEligible) {
    return res.status(404).json({ error: 'Production request not found or access denied' });
  }

  // If issuer: can see all bids and full recipient list
  if (isIssuer) {
    const bids = await db('production_bids as pb')
      .leftJoin('users as u', 'pb.bidder_user_id', 'u.id')
      .where('pb.request_id', request.id)
      .select('pb.*', 'u.name as bidder_user_name', 'u.email as bidder_user_email')
      .orderBy('pb.proposed_price', 'asc');

    const progressLogs = await db('production_progress_logs')
      .where('request_id', request.id)
      .orderBy('created_at', 'desc');

    return res.json({
      request,
      is_issuer: true,
      bids,
      progress_logs: progressLogs,
    });
  }

  // If recipient: PRIVACY ENFORCED.
  // Strips all competitor bids and recipients.
  const myBid = await db('production_bids')
    .where('request_id', request.id)
    .where(function () {
      if (req.user.role === ROLES.WORKER) {
        this.where('bidder_type', 'user').andWhere('bidder_id', req.user.id);
      } else {
        this.where('bidder_type', 'tenant').andWhere('bidder_id', req.tenant_id);
      }
    })
    .first();

  // Progress logs only if awarded to this caller
  let progressLogs = [];
  const isAwardee =
    (request.awarded_to_type === 'user' && request.awarded_to_id === req.user.id) ||
    (request.awarded_to_type === 'tenant' && request.awarded_to_id === req.tenant_id);

  if (isAwardee) {
    progressLogs = await db('production_progress_logs')
      .where('request_id', request.id)
      .orderBy('created_at', 'desc');
  }

  res.json({
    request,
    is_issuer: false,
    my_bid: myBid || null,
    is_awardee: isAwardee,
    progress_logs: progressLogs,
  });
});

// ─── 4. POST /api/production-requests/:id/bids — Submit private bid ────────────
router.post('/:id/bids', [
  body('proposed_price').isFloat({ min: 0.01 }).withMessage('Proposed price must be greater than 0'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('estimated_completion_date').isDate().withMessage('Valid estimated completion date required'),
  body('notes').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const request = await db('production_requests').where('id', req.params.id).first();
  if (!request) return res.status(404).json({ error: 'Production request not found' });

  // Caller cannot bid if they created the request
  if (request.created_by === req.user.id) {
    return res.status(400).json({ error: 'Cannot bid on requests you created' });
  }
  // An organization manager cannot bid on requests issued by their own organization
  if (req.user.role !== ROLES.WORKER && request.tenant_id === req.tenant_id) {
    return res.status(400).json({ error: 'Cannot bid on requests issued by your own organization' });
  }

  // Must be an eligible recipient
  const isEligible = await isEligibleRecipient(req, request);
  if (!isEligible) {
    return res.status(403).json({ error: 'Access denied: You are not an authorized recipient for this request' });
  }

  // Request must be open for bidding
  if (request.status !== PRODUCTION_REQUEST_STATUS.OPEN) {
    return res.status(400).json({ error: `Cannot submit bid: request is currently '${request.status}'` });
  }

  // Check deadline
  if (new Date() > new Date(request.submission_deadline)) {
    return res.status(400).json({ error: 'Submission deadline has passed for this request' });
  }

  const { proposed_price, quantity, estimated_completion_date, notes } = req.body;
  const bidderType = req.user.role === ROLES.WORKER ? 'user' : 'tenant';
  const bidderId   = req.user.role === ROLES.WORKER ? req.user.id : req.tenant_id;

  // Check if active bid already exists from this bidder
  const existingBid = await db('production_bids')
    .where('request_id', request.id)
    .where('bidder_type', bidderType)
    .where('bidder_id', bidderId)
    .whereNotIn('status', [PRODUCTION_BID_STATUS.WITHDRAWN])
    .first();

  if (existingBid) {
    // Revise existing bid
    await db('production_bids').where('id', existingBid.id).update({
      proposed_price:            parseFloat(proposed_price),
      quantity:                  parseInt(quantity),
      estimated_completion_date,
      notes:                     notes || null,
      status:                    PRODUCTION_BID_STATUS.REVISED,
      updated_at:                db.fn.now(),
    });

    const updatedBid = await db('production_bids').where('id', existingBid.id).first();

    await logAuditEvent({
      tenant_id: req.tenant_id,
      user_id: req.user.id,
      action: 'PRODUCTION_BID_REVISED',
      target_type: 'production_bids',
      target_id: existingBid.id,
      ip_address: req.ip,
      details: { requestId: request.id, proposed_price, quantity },
    });

    return res.json({ message: 'Bid revised successfully', bid: updatedBid });
  }

  const [id] = await db('production_bids').insert({
    request_id:                request.id,
    bidder_type:               bidderType,
    bidder_id:                 bidderId,
    bidder_user_id:            req.user.id,
    proposed_price:            parseFloat(proposed_price),
    quantity:                  parseInt(quantity),
    estimated_completion_date,
    notes:                     notes || null,
    status:                    PRODUCTION_BID_STATUS.SUBMITTED,
  }).returning('id');
  const bidId = typeof id === 'object' ? id.id : id;

  const createdBid = await db('production_bids').where('id', bidId).first();

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'PRODUCTION_BID_SUBMITTED',
    target_type: 'production_bids',
    target_id: bidId,
    ip_address: req.ip,
    details: { requestId: request.id, proposed_price, quantity },
  });

  res.status(201).json({
    message: 'Bid submitted successfully',
    bid: createdBid,
  });
});

// ─── 5. PUT /api/production-requests/:id/bids/:bidId/withdraw — Withdraw bid ───
router.put('/:id/bids/:bidId/withdraw', async (req, res) => {
  const bid = await db('production_bids')
    .where('id', req.params.bidId)
    .where('request_id', req.params.id)
    .first();

  if (!bid) return res.status(404).json({ error: 'Bid not found' });

  // Ownership verification
  const isOwner = bid.bidder_user_id === req.user.id || (bid.bidder_type === 'tenant' && bid.bidder_id === req.tenant_id);
  if (!isOwner) return res.status(403).json({ error: 'Access denied: You can only withdraw your own bid' });

  if (bid.status === PRODUCTION_BID_STATUS.AWARDED || bid.status === PRODUCTION_BID_STATUS.ACCEPTED) {
    return res.status(400).json({ error: 'Cannot withdraw an awarded or accepted bid' });
  }

  await db('production_bids').where('id', bid.id).update({
    status:     PRODUCTION_BID_STATUS.WITHDRAWN,
    updated_at: db.fn.now(),
  });

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'PRODUCTION_BID_WITHDRAWN',
    target_type: 'production_bids',
    target_id: bid.id,
    ip_address: req.ip,
  });

  res.json({ message: 'Bid withdrawn successfully' });
});

// ─── 6. POST /api/production-requests/:id/award — Award request to a bid ───────
router.post('/:id/award', [
  body('bid_id').isInt({ min: 1 }).withMessage('Valid bid ID is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { bid_id } = req.body;

  // Use database transaction with concurrency lock check
  const awardedResult = await db.transaction(async (trx) => {
    const request = await trx('production_requests')
      .where('id', req.params.id)
      .where('tenant_id', req.tenant_id)
      .first();

    if (!request) {
      throw new Error('NOT_FOUND: Request not found or not owned by your organization');
    }

    if (!['open', 'declined'].includes(request.status)) {
      throw new Error(`CONFLICT: Request is currently in '${request.status}' state and cannot be awarded`);
    }

    const bid = await trx('production_bids')
      .where('id', bid_id)
      .where('request_id', request.id)
      .first();

    if (!bid) {
      throw new Error('NOT_FOUND: Selected bid not found for this request');
    }

    if (!['submitted', 'revised'].includes(bid.status)) {
      throw new Error(`CONFLICT: Bid is in '${bid.status}' state and cannot be awarded`);
    }

    // Atomic award update
    const updatedCount = await trx('production_requests')
      .where('id', request.id)
      .whereIn('status', ['open', 'declined'])
      .update({
        status:          PRODUCTION_REQUEST_STATUS.AWARDED,
        awarded_bid_id:  bid.id,
        awarded_to_type: bid.bidder_type,
        awarded_to_id:   bid.bidder_id,
        awarded_at:      db.fn.now(),
        updated_at:      db.fn.now(),
      });

    if (!updatedCount) {
      throw new Error('CONFLICT: Concurrent update detected; request could not be awarded');
    }

    // Update selected bid
    await trx('production_bids').where('id', bid.id).update({
      status:     PRODUCTION_BID_STATUS.AWARDED,
      updated_at: db.fn.now(),
    });

    // Mark other bids as not_selected
    await trx('production_bids')
      .where('request_id', request.id)
      .whereNot('id', bid.id)
      .whereIn('status', [PRODUCTION_BID_STATUS.SUBMITTED, PRODUCTION_BID_STATUS.REVISED])
      .update({
        status:     PRODUCTION_BID_STATUS.NOT_SELECTED,
        updated_at: db.fn.now(),
      });

    return { request, bid };
  }).catch((err) => {
    if (err.message.startsWith('NOT_FOUND:')) {
      return { status: 404, error: err.message.replace('NOT_FOUND: ', '') };
    }
    if (err.message.startsWith('CONFLICT:')) {
      return { status: 409, error: err.message.replace('CONFLICT: ', '') };
    }
    throw err;
  });

  if (awardedResult.error) {
    return res.status(awardedResult.status).json({ error: awardedResult.error });
  }

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'PRODUCTION_REQUEST_AWARDED',
    target_type: 'production_requests',
    target_id: req.params.id,
    ip_address: req.ip,
    details: { bid_id, awarded_to_id: awardedResult.bid.bidder_id },
  });

  res.json({
    message: 'Production request awarded successfully. Awaiting recipient acceptance.',
    request: await db('production_requests').where('id', req.params.id).first(),
  });
});

// ─── 7. POST /api/production-requests/:id/respond-award — Accept or decline ────
router.post('/:id/respond-award', [
  body('action').isIn(['accept', 'decline']).withMessage("Action must be 'accept' or 'decline'"),
  body('reason').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { action, reason } = req.body;

  const request = await db('production_requests').where('id', req.params.id).first();
  if (!request) return res.status(404).json({ error: 'Production request not found' });

  if (request.status !== PRODUCTION_REQUEST_STATUS.AWARDED) {
    return res.status(400).json({ error: `Cannot respond to award: request is in '${request.status}' state` });
  }

  // Verify caller is the awardee
  const isAwardee =
    (request.awarded_to_type === 'user' && request.awarded_to_id === req.user.id) ||
    (request.awarded_to_type === 'tenant' && request.awarded_to_id === req.tenant_id);

  if (!isAwardee) {
    return res.status(403).json({ error: 'Access denied: Only the selected recipient can accept or decline this award' });
  }

  if (action === 'accept') {
    await db('production_requests').where('id', request.id).update({
      status:      PRODUCTION_REQUEST_STATUS.ACCEPTED,
      accepted_at: db.fn.now(),
      updated_at:  db.fn.now(),
    });

    await db('production_bids').where('id', request.awarded_bid_id).update({
      status:     PRODUCTION_BID_STATUS.ACCEPTED,
      updated_at: db.fn.now(),
    });

    await logAuditEvent({
      tenant_id: req.tenant_id,
      user_id: req.user.id,
      action: 'PRODUCTION_AWARD_ACCEPTED',
      target_type: 'production_requests',
      target_id: request.id,
      ip_address: req.ip,
    });

    return res.json({ message: 'Award accepted! You can now start production and report progress.' });
  }

  // action === 'decline'
  await db('production_requests').where('id', request.id).update({
    status:      PRODUCTION_REQUEST_STATUS.DECLINED,
    notes:       reason ? `Declined: ${reason}` : request.notes,
    updated_at:  db.fn.now(),
  });

  await db('production_bids').where('id', request.awarded_bid_id).update({
    status:     PRODUCTION_BID_STATUS.DECLINED,
    updated_at: db.fn.now(),
  });

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'PRODUCTION_AWARD_DECLINED',
    target_type: 'production_requests',
    target_id: request.id,
    ip_address: req.ip,
    details: { reason },
  });

  res.json({ message: 'Award declined. The issuer may now reopen bidding or select another bidder.' });
});

// ─── 8. POST /api/production-requests/:id/progress — Report progress ───────────
router.post('/:id/progress', [
  body('quantity_completed').isInt({ min: 0 }).withMessage('Valid quantity completed required'),
  body('notes').optional().trim(),
  body('submit_for_review').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const request = await db('production_requests').where('id', req.params.id).first();
  if (!request) return res.status(404).json({ error: 'Production request not found' });

  // Caller must be the assigned recipient
  const isAwardee =
    (request.awarded_to_type === 'user' && request.awarded_to_id === req.user.id) ||
    (request.awarded_to_type === 'tenant' && request.awarded_to_id === req.tenant_id);

  if (!isAwardee) {
    return res.status(403).json({ error: 'Access denied: Only the assigned recipient can log progress' });
  }

  const validStatuses = [
    PRODUCTION_REQUEST_STATUS.ACCEPTED,
    PRODUCTION_REQUEST_STATUS.IN_PROGRESS,
    PRODUCTION_REQUEST_STATUS.SUBMITTED_FOR_REVIEW,
  ];
  if (!validStatuses.includes(request.status)) {
    return res.status(400).json({ error: `Cannot log progress on request in '${request.status}' state` });
  }

  const { quantity_completed, notes, submit_for_review } = req.body;
  const progressStatus = submit_for_review
    ? PRODUCTION_PROGRESS_STATUS.SUBMITTED_FOR_REVIEW
    : PRODUCTION_PROGRESS_STATUS.PROGRESS;

  await db('production_progress_logs').insert({
    request_id:         request.id,
    logged_by:          req.user.id,
    quantity_completed: parseInt(quantity_completed),
    notes:              notes || null,
    status:             progressStatus,
  });

  const nextRequestStatus = submit_for_review
    ? PRODUCTION_REQUEST_STATUS.SUBMITTED_FOR_REVIEW
    : PRODUCTION_REQUEST_STATUS.IN_PROGRESS;

  await db('production_requests').where('id', request.id).update({
    status:     nextRequestStatus,
    updated_at: db.fn.now(),
  });

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: submit_for_review ? 'PRODUCTION_SUBMITTED_FOR_REVIEW' : 'PRODUCTION_PROGRESS_LOGGED',
    target_type: 'production_requests',
    target_id: request.id,
    ip_address: req.ip,
    details: { quantity_completed, submit_for_review },
  });

  res.status(201).json({
    message: submit_for_review ? 'Work submitted for supervisor review!' : 'Progress logged successfully',
    status: nextRequestStatus,
  });
});

// ─── 9. POST /api/production-requests/:id/review — Issuer reviews work ─────────
router.post('/:id/review', [
  body('decision').isIn(['approve', 'request_correction']).withMessage("Decision must be 'approve' or 'request_correction'"),
  body('feedback').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const request = await db('production_requests')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();

  if (!request) return res.status(404).json({ error: 'Request not found or not owned by your organization' });

  const { decision, feedback } = req.body;

  if (decision === 'approve') {
    await db('production_requests').where('id', request.id).update({
      status:       PRODUCTION_REQUEST_STATUS.COMPLETED,
      completed_at: db.fn.now(),
      updated_at:   db.fn.now(),
    });

    await db('production_progress_logs').insert({
      request_id:         request.id,
      logged_by:          req.user.id,
      quantity_completed: request.quantity,
      status:             PRODUCTION_PROGRESS_STATUS.APPROVED,
      feedback:           feedback || 'Approved by supervisor',
    });

    // If request has a linked product, increment finished goods stock for issuer's tenant cleanly
    if (request.product_id) {
      const stock = await db('finished_goods_stock')
        .where('product_id', request.product_id)
        .where('tenant_id', req.tenant_id)
        .first();

      if (stock) {
        await db('finished_goods_stock')
          .where('id', stock.id)
          .update({
            quantity:   stock.quantity + request.quantity,
            updated_at: db.fn.now(),
          });
      } else {
        await db('finished_goods_stock').insert({
          tenant_id:  req.tenant_id,
          product_id: request.product_id,
          quantity:   request.quantity,
        });
      }
    }

    await logAuditEvent({
      tenant_id: req.tenant_id,
      user_id: req.user.id,
      action: 'PRODUCTION_WORK_APPROVED',
      target_type: 'production_requests',
      target_id: request.id,
      ip_address: req.ip,
      details: { feedback },
    });

    return res.json({ message: 'Production work approved and marked completed!' });
  }

  // decision === 'request_correction'
  await db('production_requests').where('id', request.id).update({
    status:     PRODUCTION_REQUEST_STATUS.IN_PROGRESS,
    updated_at: db.fn.now(),
  });

  await db('production_progress_logs').insert({
    request_id:         request.id,
    logged_by:          req.user.id,
    quantity_completed: 0,
    status:             PRODUCTION_PROGRESS_STATUS.CORRECTION_REQUESTED,
    feedback:           feedback || 'Correction requested',
  });

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'PRODUCTION_CORRECTION_REQUESTED',
    target_type: 'production_requests',
    target_id: request.id,
    ip_address: req.ip,
    details: { feedback },
  });

  res.json({ message: 'Correction requested and notification sent to recipient' });
});

// ─── 10. POST /api/production-requests/:id/cancel — Issuer cancels request ─────
router.post('/:id/cancel', async (req, res) => {
  const request = await db('production_requests')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();

  if (!request) return res.status(404).json({ error: 'Request not found or access denied' });

  if (request.status === PRODUCTION_REQUEST_STATUS.COMPLETED) {
    return res.status(400).json({ error: 'Cannot cancel an already completed request' });
  }

  await db('production_requests').where('id', request.id).update({
    status:     PRODUCTION_REQUEST_STATUS.CANCELLED,
    updated_at: db.fn.now(),
  });

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'PRODUCTION_REQUEST_CANCELLED',
    target_type: 'production_requests',
    target_id: request.id,
    ip_address: req.ip,
  });

  res.json({ message: 'Production request cancelled' });
});

module.exports = router;
