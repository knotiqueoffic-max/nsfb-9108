const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { generateToken, authenticate, adminOnly, requireTenant } = require('../middleware/auth');
const { ROLES, ACCOUNT_STATUS, TENANT_TYPES, canAssignRole } = require('../constants/roles');
const { logAuditEvent } = require('../services/audit.service');
const { verifyGoogleToken, getGoogleClientId, GoogleAuthError } = require('../services/google.service');
const { deleteUserSafely } = require('../services/user.service');

// ─── Helper: build tenant-enriched user object ────────────────────────────────
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

// ─── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;
  const user = await db('users').where('email', email).first();

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Account status check
  const isSuspended = user.status === ACCOUNT_STATUS.SUSPENDED ||
                      user.status === ACCOUNT_STATUS.REJECTED ||
                      user.is_active === false;
  if (isSuspended) {
    return res.status(403).json({
      error: 'Account inactive or suspended',
      message: 'Your account is currently inactive or suspended. Please contact your administrator.',
      status: user.status,
    });
  }

  const token = generateToken(user);
  const userResponse = await buildUserResponse(user);

  await logAuditEvent({
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: 'USER_LOGIN',
    target_type: 'users',
    target_id: user.id,
    ip_address: req.ip,
  });

  res.json({ token, user: userResponse });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  const user = await db('users')
    .where('id', req.user.id)
    .select('id', 'name', 'email', 'role', 'wage_mode', 'wage_rate', 'phone', 'status', 'token_version', 'tenant_id', 'google_profile_photo', 'auth_methods')
    .first();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const userResponse = await buildUserResponse(user);
  res.json(userResponse);
});

// ─── POST /api/auth/signup — public; creates a new tenant + admin/vendor/subvendor account ─────
router.post('/signup', [
  body('name').trim().notEmpty().withMessage('Full name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('company_name').trim().notEmpty().withMessage('Business name is required'),
  body('plan_id').optional().isIn(['free_trial', 'starter', 'growth', 'business']),
  body('phone').optional().trim(),
  body('role').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, email, password, company_name, plan_id = 'free_trial', business_category, phone, role } = req.body;

  // Crocheters / Workers are strictly blocked from self-registration
  if (role === ROLES.WORKER || role === 'crocheter') {
    return res.status(403).json({
      error: 'Workers cannot self-register. Please contact your Admin or Vendor for an invitation.',
    });
  }

  const ALLOWED_SIGNUP_ROLES = [ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.OWNER];
  if (role && !ALLOWED_SIGNUP_ROLES.includes(role)) {
    return res.status(400).json({
      error: 'Invalid role. Self-registration is only allowed for Admin, Vendor, or Sub-Vendor.',
    });
  }

  const assignedRole = role || ROLES.ADMIN;

  // Check email not already used
  const existingUser = await db('users').where('email', email).first();
  if (existingUser) return res.status(409).json({ error: 'Email already registered' });

  // Create tenant slug (url-safe from company name)
  let baseSlug = company_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'workspace';

  // Ensure slug is unique
  let slug = baseSlug;
  let slugSuffix = 1;
  while (await db('tenants').where('slug', slug).first()) {
    slug = `${baseSlug}-${slugSuffix++}`;
  }

  // 14-day trial
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const tenantType = assignedRole === ROLES.VENDOR ? TENANT_TYPES.VENDOR : assignedRole === ROLES.SUBVENDOR ? TENANT_TYPES.SUBVENDOR : TENANT_TYPES.BUSINESS;

  // Use a transaction so user + tenant are created atomically
  try {
    const result = await db.transaction(async (trx) => {
      // Create tenant first (without owner_id — we'll update after user is created)
      const [tenantId] = await trx('tenants').insert({
        name:                company_name,
        slug,
        business_category:   business_category || null,
        plan_id,
        trial_ends_at:       trialEndsAt,
        subscription_status: 'trialing',
        tenant_type:         tenantType,
        status:              'active',
        onboarding_dismissed: false,
      }).returning('id');
      const resolvedTenantId = typeof tenantId === 'object' ? tenantId.id : tenantId;

      // Create user with explicit assigned role
      const password_hash = await bcrypt.hash(password, 10);
      const [userId] = await trx('users').insert({
        tenant_id:     resolvedTenantId,
        name,
        email,
        phone:         phone || null,
        password_hash,
        role:          assignedRole,
        status:        ACCOUNT_STATUS.ACTIVE,
        is_active:     true,
        token_version: 1,
      }).returning('id');
      const resolvedUserId = typeof userId === 'object' ? userId.id : userId;

      // Link tenant to owner/creator
      await trx('tenants').where('id', resolvedTenantId).update({ owner_id: resolvedUserId });

      // Seed default settings for new tenant
      const defaultSettings = [
        { key: 'currency', value: JSON.stringify('INR') },
        {
          key: 'platform_commissions',
          value: JSON.stringify({ flipkart: 18, meesho: 12, myntra: 20, etsy: 6.5, amazon: 15 }),
        },
        { key: 'business_name', value: JSON.stringify(company_name) },
      ];
      for (const s of defaultSettings) {
        await trx('settings').insert({ tenant_id: resolvedTenantId, key: s.key, value: s.value });
      }

      return { tenantId: resolvedTenantId, userId: resolvedUserId };
    });

    const user = await db('users').where('id', result.userId).first();
    const token = generateToken(user);
    const userResponse = await buildUserResponse(user);

    await logAuditEvent({
      tenant_id: result.tenantId,
      user_id: result.userId,
      action: 'WORKSPACE_SIGNUP',
      target_type: 'tenants',
      target_id: result.tenantId,
      ip_address: req.ip,
      details: { company_name, email, plan_id, role: assignedRole },
    });

    res.status(201).json({ token, user: userResponse });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
});

// ─── POST /api/auth/register — supports public self-signup OR manager adding subordinates ───
router.post(
  '/register',
  async (req, res, next) => {
    // If request has NO Authorization header, handle as public self-registration
    if (!req.headers.authorization) {
      const { name, email, password, company_name, role, plan_id = 'free_trial', business_category, phone } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password (min 6 characters) are required' });
      }
      if (typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }

      // Workers / crocheters strictly forbidden from public self-registration
      if (role === ROLES.WORKER || role === 'crocheter') {
        return res.status(403).json({
          error: 'Workers cannot self-register. Please contact your Admin or Vendor for an invitation.',
        });
      }

      const ALLOWED_SIGNUP_ROLES = [ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.OWNER];
      if (role && !ALLOWED_SIGNUP_ROLES.includes(role)) {
        return res.status(400).json({
          error: 'Invalid role. Self-registration is only allowed for Admin, Vendor, or Sub-Vendor.',
        });
      }

      const assignedRole = role || ROLES.ADMIN;
      const existing = await db('users').where('email', email.toLowerCase()).first();
      if (existing) return res.status(409).json({ error: 'Email already in use' });

      // Workspace / tenant setup
      const compName = company_name || `${name}'s Workspace`;
      let baseSlug = compName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
      let slug = baseSlug;
      let slugSuffix = 1;
      while (await db('tenants').where('slug', slug).first()) {
        slug = `${baseSlug}-${slugSuffix++}`;
      }

      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const tenantType = assignedRole === ROLES.VENDOR ? TENANT_TYPES.VENDOR : assignedRole === ROLES.SUBVENDOR ? TENANT_TYPES.SUBVENDOR : TENANT_TYPES.BUSINESS;

      try {
        const result = await db.transaction(async (trx) => {
          const [tId] = await trx('tenants').insert({
            name: compName,
            slug,
            business_category: business_category || null,
            plan_id,
            trial_ends_at: trialEndsAt,
            subscription_status: 'trialing',
            tenant_type: tenantType,
            status: 'active',
            onboarding_dismissed: false,
          }).returning('id');
          const resolvedTenantId = typeof tId === 'object' ? tId.id : tId;

          const password_hash = await bcrypt.hash(password, 10);
          const [uId] = await trx('users').insert({
            tenant_id: resolvedTenantId,
            name,
            email: email.toLowerCase(),
            phone: phone || null,
            password_hash,
            role: assignedRole,
            status: ACCOUNT_STATUS.ACTIVE,
            is_active: true,
            token_version: 1,
          }).returning('id');
          const resolvedUserId = typeof uId === 'object' ? uId.id : uId;

          await trx('tenants').where('id', resolvedTenantId).update({ owner_id: resolvedUserId });

          // Seed default settings
          const defaultSettings = [
            { key: 'currency', value: JSON.stringify('INR') },
            {
              key: 'platform_commissions',
              value: JSON.stringify({ flipkart: 18, meesho: 12, myntra: 20, etsy: 6.5, amazon: 15 }),
            },
            { key: 'business_name', value: JSON.stringify(compName) },
          ];
          for (const s of defaultSettings) {
            await trx('settings').insert({ tenant_id: resolvedTenantId, key: s.key, value: s.value });
          }

          return { tenantId: resolvedTenantId, userId: resolvedUserId };
        });

        const newUser = await db('users').where('id', result.userId).first();
        const token = generateToken(newUser);
        const userResponse = await buildUserResponse(newUser);

        await logAuditEvent({
          tenant_id: result.tenantId,
          user_id: result.userId,
          action: 'WORKSPACE_PUBLIC_REGISTER',
          target_type: 'tenants',
          target_id: result.tenantId,
          ip_address: req.ip,
          details: { compName, email, plan_id, role: assignedRole },
        });

        return res.status(201).json({ token, user: userResponse, ...userResponse });
      } catch (err) {
        console.error('Public register error:', err);
        return res.status(500).json({ error: 'Failed to create account. Please try again.' });
      }
    }

    // Authenticated request: proceed to manager subordinate registration middleware
    return next();
  },
  authenticate,
  requireTenant,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').isIn([ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.WORKER]).withMessage('Valid role is required'),
    body('phone').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, password, role, wage_mode, wage_rate, phone } = req.body;

    // Enforce privilege escalation guard
    if (!canAssignRole(req.user.role, role)) {
      return res.status(403).json({
        error: 'Permission denied',
        message: `Role '${req.user.role}' is not authorized to register a '${role}'.`,
      });
    }

    const existing = await db('users').where('email', email).first();
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const password_hash = await bcrypt.hash(password, 10);
    const [id] = await db('users')
      .insert({
        tenant_id: req.tenant_id,
        name,
        email,
        phone: phone || null,
        password_hash,
        role,
        status: ACCOUNT_STATUS.ACTIVE,
        is_active: true,
        token_version: 1,
        wage_mode: wage_mode || 'per_piece',
        wage_rate: wage_rate ? parseFloat(wage_rate) : 0,
      })
      .returning('id');
    const userId = typeof id === 'object' ? id.id : id;

    const newUser = await db('users').where('id', userId).first();
    const userResponse = await buildUserResponse(newUser);

    await logAuditEvent({
      tenant_id: req.tenant_id,
      user_id: req.user.id,
      action: 'USER_REGISTERED',
      target_type: 'users',
      target_id: userId,
      ip_address: req.ip,
      details: { email, role },
    });

    res.status(201).json(userResponse);
  }
);

// ─── PUT /api/auth/profile ────────────────────────────────────────────────────
router.put('/profile', authenticate, [
  body('name').optional().trim().notEmpty(),
  body('phone').optional().trim(),
  body('notes').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, phone, notes } = req.body;
  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (notes !== undefined && [ROLES.OWNER, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role)) {
    updateData.notes = notes;
  }

  // Prevent role, tenant, status, is_active tampering
  if (Object.keys(updateData).length > 0) {
    await db('users').where('id', req.user.id).update(updateData);
    await logAuditEvent({
      tenant_id: req.tenant_id,
      user_id: req.user.id,
      action: 'PROFILE_UPDATED',
      target_type: 'users',
      target_id: req.user.id,
      ip_address: req.ip,
      details: updateData,
    });
  }

  const updatedUser = await db('users').where('id', req.user.id).first();
  const userResponse = await buildUserResponse(updatedUser);
  res.json({ message: 'Profile updated successfully', user: userResponse });
});

// ─── PUT /api/auth/change-password ────────────────────────────────────────────
router.put('/change-password', authenticate, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const user = await db('users').where('id', req.user.id).first();
  if (!(await bcrypt.compare(req.body.currentPassword, user.password_hash))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const password_hash = await bcrypt.hash(req.body.newPassword, 10);
  await db('users')
    .where('id', req.user.id)
    .update({
      password_hash,
      token_version: (user.token_version || 1) + 1,
    });

  const updatedUser = await db('users').where('id', req.user.id).first();
  const newToken = generateToken(updatedUser);

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'PASSWORD_CHANGED',
    target_type: 'users',
    target_id: req.user.id,
    ip_address: req.ip,
  });

  res.json({
    message: 'Password changed successfully. All other sessions have been logged out.',
    token: newToken,
  });
});

// ─── POST /api/auth/revoke-sessions ──────────────────────────────────────────
router.post('/revoke-sessions', authenticate, async (req, res) => {
  const user = await db('users').where('id', req.user.id).first();
  const nextVersion = (user?.token_version || 1) + 1;

  await db('users')
    .where('id', req.user.id)
    .update({ token_version: nextVersion });

  const updatedUser = await db('users').where('id', req.user.id).first();
  const newToken = generateToken(updatedUser);

  await logAuditEvent({
    tenant_id: req.tenant_id,
    user_id: req.user.id,
    action: 'SESSIONS_REVOKED',
    target_type: 'users',
    target_id: req.user.id,
    ip_address: req.ip,
  });

  res.json({
    message: 'All other active sessions have been revoked.',
    token: newToken,
  });
});

// ─── GET /api/auth/config ─────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json({
    googleClientId: getGoogleClientId() || null,
  });
});

// ─── POST /api/auth/google-login ──────────────────────────────────────────────
router.post('/google-login', async (req, res) => {
  const { token, plan_id = 'free_trial', role } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Google ID token is required' });
  }

  // Workers / crocheters strictly forbidden from public self-registration
  if (role === ROLES.WORKER || role === 'crocheter') {
    return res.status(403).json({
      error: 'Workers cannot self-register. Please contact your Admin or Vendor for an invitation.',
    });
  }

  // Validate plan_id against known plans
  const ALLOWED_PLANS = ['free_trial', 'starter', 'growth', 'business'];
  const resolvedPlanId = ALLOWED_PLANS.includes(plan_id) ? plan_id : 'free_trial';

  let googleUser;
  try {
    googleUser = await verifyGoogleToken(token);
  } catch (err) {
    if (err instanceof GoogleAuthError || err.isAuthError) {
      return res.status(401).json({ error: err.message || 'Invalid or expired Google token' });
    }
    console.error('[Google OAuth Verification Error]:', err);
    return res.status(500).json({ error: 'Failed to verify Google token. Please try again.' });
  }

  const { googleId, email, name, googleProfilePhoto } = googleUser;

  try {
    // 1. Check if user already exists by googleId
    let user = await db('users').where('google_id', googleId).first();

    if (user) {
      const isSuspended = user.status === ACCOUNT_STATUS.SUSPENDED ||
                          user.status === ACCOUNT_STATUS.REJECTED ||
                          user.is_active === false;
      if (isSuspended) {
        return res.status(403).json({
          error: 'Account inactive or suspended',
          message: 'Your account is currently inactive or suspended. Please contact your administrator.',
          status: user.status,
        });
      }

      // Existing Google user: update profile photo if a new one is provided and log in
      const photoToUpdate = googleProfilePhoto || user.google_profile_photo;
      if (googleProfilePhoto && googleProfilePhoto !== user.google_profile_photo) {
        await db('users').where('id', user.id).update({
          google_profile_photo: photoToUpdate,
        });
      }
      const knotiqueToken = generateToken(user);
      const userResponse = await buildUserResponse({ ...user, google_profile_photo: photoToUpdate });

      await logAuditEvent({
        tenant_id: user.tenant_id,
        user_id: user.id,
        action: 'USER_GOOGLE_LOGIN',
        target_type: 'users',
        target_id: user.id,
        ip_address: req.ip,
      });

      return res.json({ token: knotiqueToken, user: userResponse });
    }

    // 2. Check if user exists by email (account linking)
    user = await db('users').where('email', email).first();

    if (user) {
      // Worker accounts are not allowed to use Google sign-in
      if (user.role === 'worker') {
        return res.status(403).json({ error: 'Worker accounts must log in with email and password' });
      }

      const isSuspended = user.status === ACCOUNT_STATUS.SUSPENDED ||
                          user.status === ACCOUNT_STATUS.REJECTED ||
                          user.is_active === false;
      if (isSuspended) {
        return res.status(403).json({
          error: 'Account inactive or suspended',
          message: 'Your account is currently inactive or suspended. Please contact your administrator.',
          status: user.status,
        });
      }

      // Link accounts
      const currentMethods = user.auth_methods ? user.auth_methods.split(',').map((m) => m.trim()) : ['email_password'];
      if (!currentMethods.includes('google')) {
        currentMethods.push('google');
      }

      const photoToUpdate = googleProfilePhoto || user.google_profile_photo;
      await db('users').where('id', user.id).update({
        google_id:            googleId,
        google_profile_photo: photoToUpdate,
        auth_methods:         currentMethods.join(','),
      });

      const updatedUser = await db('users').where('id', user.id).first();
      const knotiqueToken = generateToken(updatedUser);
      const userResponse = await buildUserResponse(updatedUser);

      await logAuditEvent({
        tenant_id: user.tenant_id,
        user_id: user.id,
        action: 'GOOGLE_ACCOUNT_LINKED',
        target_type: 'users',
        target_id: user.id,
        ip_address: req.ip,
      });

      return res.json({
        token:   knotiqueToken,
        user:    userResponse,
        message: 'Google account linked to your existing profile successfully!',
      });
    }

    // 3. Brand new user signup via Google: create tenant and user account atomically
    const displayName = (name && name.trim()) || email?.split('@')[0] || 'Craftisan';
    const company_name = `${displayName}'s Workspace`;
    let baseSlug = company_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'workspace';

    let slug = baseSlug;
    let slugSuffix = 1;
    while (await db('tenants').where('slug', slug).first()) {
      slug = `${baseSlug}-${slugSuffix++}`;
    }

    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const assignedRole = role && [ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.OWNER].includes(role) ? role : ROLES.OWNER;
    const tenantType = assignedRole === ROLES.VENDOR ? TENANT_TYPES.VENDOR : assignedRole === ROLES.SUBVENDOR ? TENANT_TYPES.SUBVENDOR : TENANT_TYPES.BUSINESS;

    const result = await db.transaction(async (trx) => {
      // Create new tenant
      const [tenantId] = await trx('tenants').insert({
        name:                company_name,
        slug,
        business_category:   'Crochet & Knitting',
        plan_id:             resolvedPlanId,
        trial_ends_at:       trialEndsAt,
        subscription_status: 'trialing',
        tenant_type:         tenantType,
        status:              'active',
        onboarding_dismissed: false,
      }).returning('id');
      const resolvedTenantId = typeof tenantId === 'object' ? tenantId.id : tenantId;

      // Create user linked with Google — using displayName fallback for name and assigned role
      const [userId] = await trx('users').insert({
        tenant_id:            resolvedTenantId,
        name:                 displayName,
        email:                email.toLowerCase(),
        password_hash:        null, // google-only user has no password initially
        role:                 assignedRole,
        status:               ACCOUNT_STATUS.ACTIVE,
        is_active:            true,
        token_version:        1,
        google_id:            googleId,
        google_profile_photo: googleProfilePhoto || null,
        auth_methods:         'google',
      }).returning('id');
      const resolvedUserId = typeof userId === 'object' ? userId.id : userId;

      // Link tenant to owner
      await trx('tenants').where('id', resolvedTenantId).update({ owner_id: resolvedUserId });

      // Seed default settings for new tenant
      const defaultSettings = [
        { key: 'currency', value: JSON.stringify('INR') },
        {
          key: 'platform_commissions',
          value: JSON.stringify({ flipkart: 18, meesho: 12, myntra: 20, etsy: 6.5, amazon: 15 }),
        },
        { key: 'business_name', value: JSON.stringify(company_name) },
      ];
      for (const s of defaultSettings) {
        await trx('settings').insert({ tenant_id: resolvedTenantId, key: s.key, value: s.value });
      }

      return { tenantId: resolvedTenantId, userId: resolvedUserId };
    });

    const newUser = await db('users').where('id', result.userId).first();
    const knotiqueToken = generateToken(newUser);
    const userResponse = await buildUserResponse(newUser);

    await logAuditEvent({
      tenant_id: result.tenantId,
      user_id: result.userId,
      action: 'WORKSPACE_GOOGLE_SIGNUP',
      target_type: 'tenants',
      target_id: result.tenantId,
      ip_address: req.ip,
      details: { company_name, email, plan_id: resolvedPlanId },
    });

    return res.status(201).json({ token: knotiqueToken, user: userResponse });

  } catch (err) {
    console.error('[Google Sign-in Server Error]:', err);
    res.status(500).json({ error: 'Failed to authenticate with Google. Please try again.' });
  }
});

// ─── DELETE /api/auth/account (and alias /me) — Self-deletion ──────────────────
const handleAccountDeletion = async (req, res) => {
  const { confirmText, password } = req.body || {};
  const user = await db('users').where('id', req.user.id).first();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Confirmation can be provided via "DELETE", the user's email, or valid password (for password accounts)
  const isConfirmedByText =
    confirmText &&
    (String(confirmText).trim().toUpperCase() === 'DELETE' ||
      String(confirmText).trim().toLowerCase() === user.email.toLowerCase());

  if (!isConfirmedByText) {
    if (user.password_hash) {
      if (!password) {
        return res.status(400).json({
          error: 'Confirmation required. Please type "DELETE" or enter your account password to confirm deletion.',
        });
      }
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
    } else {
      // Google OAuth user without password
      return res.status(400).json({
        error: 'Confirmation required. Please type "DELETE" or your email address to confirm account deletion.',
      });
    }
  }

  await logAuditEvent({
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: 'USER_ACCOUNT_SELF_DELETED',
    target_type: 'users',
    target_id: user.id,
    ip_address: req.ip,
    details: { email: user.email, role: user.role },
  });

  await deleteUserSafely(user.id);

  res.json({ message: 'Your account and data have been deleted successfully.' });
};

router.delete('/account', authenticate, handleAccountDeletion);
router.delete('/me', authenticate, handleAccountDeletion);

module.exports = router;
