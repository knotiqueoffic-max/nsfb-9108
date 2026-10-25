const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authenticate, requireTenant, workerManagerOnly, generateToken } = require('../middleware/auth');
const { ROLES, ACCOUNT_STATUS, INVITATION_STATUS, canAssignRole } = require('../constants/roles');
const { logAuditEvent } = require('../services/audit.service');

// Helper to build user response (consistent with auth.js)
async function buildUserResponse(user) {
  const tenant = user.tenant_id ? await db('tenants').where('id', user.tenant_id).first() : null;
  const plan = tenant ? await db('plans').where('id', tenant.plan_id).first() : null;
  return {
    id:                   user.id,
    name:                 user.name,
    email:                user.email,
    role:                 user.role,
    status:               user.status || 'active',
    phone:                user.phone || null,
    wage_mode:            user.wage_mode,
    wage_rate:            user.wage_rate || 0,
    tenant_id:            user.tenant_id,
    tenant_name:          tenant?.name || null,
    tenant_slug:          tenant?.slug || null,
    tenant_type:          tenant?.tenant_type || 'business',
    plan_id:              tenant?.plan_id,
    plan_name:            plan?.name,
    subscription_status:  tenant?.subscription_status,
    trial_ends_at:        tenant?.trial_ends_at,
    onboarding_dismissed: tenant?.onboarding_dismissed,
    google_profile_photo: user.google_profile_photo,
    auth_methods:         user.auth_methods,
    token_version:        user.token_version || 1,
  };
}

// ─── POST /api/invitations — create an invitation ─────────────────────────────
router.post('/', authenticate, requireTenant, workerManagerOnly, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('role').isIn([ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.WORKER]).withMessage('Valid role is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, role } = req.body;

  // Prevent privilege escalation
  if (!canAssignRole(req.user.role, role)) {
    return res.status(403).json({
      error: 'Permission denied',
      message: `Your role '${req.user.role}' cannot invite users with role '${role}'.`,
    });
  }

  // Check if user is already an active member of this tenant
  const existingUser = await db('users')
    .where('email', email)
    .where('tenant_id', req.tenant_id)
    .first();
  if (existingUser) {
    return res.status(409).json({ error: 'User is already a member of this organization' });
  }

  // Generate secure token and its SHA-256 hash
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  // Invalidate any prior pending invitation for this email in this tenant
  await db('invitations')
    .where('tenant_id', req.tenant_id)
    .where('email', email)
    .where('status', INVITATION_STATUS.PENDING)
    .update({ status: INVITATION_STATUS.REVOKED });

  const [id] = await db('invitations').insert({
    tenant_id:  req.tenant_id,
    email,
    role,
    token_hash: tokenHash,
    invited_by: req.user.id,
    status:     INVITATION_STATUS.PENDING,
    expires_at: expiresAt,
  }).returning('id');
  const invitationId = typeof id === 'object' ? id.id : id;

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'INVITATION_CREATED',
    target_type: 'invitations',
    target_id: invitationId,
    ip_address: req.ip,
    details: { email, role, expiresAt },
  });

  res.status(201).json({
    message: 'Invitation sent successfully',
    invitation: {
      id: invitationId,
      email,
      role,
      status: INVITATION_STATUS.PENDING,
      expires_at: expiresAt,
    },
    token: rawToken, // Provided so the client/mailer can construct the invitation URL
  });
});

// ─── GET /api/invitations — list invitations for current tenant ────────────────
router.get('/', authenticate, requireTenant, workerManagerOnly, async (req, res) => {
  const invitations = await db('invitations')
    .where('tenant_id', req.tenant_id)
    .orderBy('created_at', 'desc')
    .select('id', 'email', 'role', 'status', 'expires_at', 'updated_at', 'created_at', 'invited_by');

  res.json(invitations);
});

// ─── DELETE /api/invitations/:id — revoke an invitation ───────────────────────
router.delete('/:id', authenticate, requireTenant, workerManagerOnly, async (req, res) => {
  const invitation = await db('invitations')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();

  if (!invitation) return res.status(404).json({ error: 'Invitation not found' });

  await db('invitations')
    .where('id', req.params.id)
    .update({ status: INVITATION_STATUS.REVOKED, updated_at: db.fn.now() });

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'INVITATION_REVOKED',
    target_type: 'invitations',
    target_id: req.params.id,
    ip_address: req.ip,
    details: { email: invitation.email },
  });

  res.json({ message: 'Invitation revoked successfully' });
});

// ─── POST /api/invitations/accept — public endpoint to accept an invitation ───
router.post('/accept', [
  body('token').notEmpty().withMessage('Invitation token is required'),
  body('name').trim().notEmpty().withMessage('Full name is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { token, name, password, phone } = req.body;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const invitation = await db('invitations')
    .where('token_hash', tokenHash)
    .where('status', INVITATION_STATUS.PENDING)
    .first();

  if (!invitation) {
    return res.status(400).json({ error: 'Invalid or already used invitation token' });
  }

  // Check expiration
  if (new Date(invitation.expires_at) < new Date()) {
    await db('invitations').where('id', invitation.id).update({
      status: INVITATION_STATUS.EXPIRED,
      updated_at: db.fn.now(),
    });
    return res.status(400).json({ error: 'This invitation has expired. Please request a new one.' });
  }

  // Atomically create user and mark invitation accepted
  try {
    const userId = await db.transaction(async (trx) => {
      let user = await trx('users').where('email', invitation.email).first();
      const password_hash = await bcrypt.hash(password, 10);

      if (user) {
        // Update user to tenant and role
        await trx('users').where('id', user.id).update({
          tenant_id:     invitation.tenant_id,
          role:          invitation.role,
          name:          name || user.name,
          phone:         phone || user.phone,
          password_hash,
          status:        ACCOUNT_STATUS.ACTIVE,
          is_active:     true,
          token_version: (user.token_version || 1) + 1,
        });
      } else {
        const [newId] = await trx('users').insert({
          tenant_id:     invitation.tenant_id,
          name,
          email:         invitation.email,
          phone:         phone || null,
          password_hash,
          role:          invitation.role,
          status:        ACCOUNT_STATUS.ACTIVE,
          is_active:     true,
          token_version: 1,
        }).returning('id');
        user = { id: typeof newId === 'object' ? newId.id : newId };
      }

      // Mark invitation accepted
      await trx('invitations').where('id', invitation.id).update({
        status: INVITATION_STATUS.ACCEPTED,
        updated_at: trx.fn.now(),
      });

      return user.id;
    });

    const acceptedUser = await db('users').where('id', userId).first();
    const appToken = generateToken(acceptedUser);
    const userResponse = await buildUserResponse(acceptedUser);

    await logAuditEvent({
      tenant_id: invitation.tenant_id,
      user_id: userId,
      action: 'INVITATION_ACCEPTED',
      target_type: 'invitations',
      target_id: invitation.id,
      ip_address: req.ip,
      details: { email: invitation.email, role: invitation.role },
    });

    res.status(200).json({
      message: 'Invitation accepted successfully!',
      token: appToken,
      user: userResponse,
    });
  } catch (err) {
    console.error('[Invitation Acceptance Error]:', err);
    res.status(500).json({ error: 'Failed to accept invitation. Please try again.' });
  }
});

module.exports = router;
