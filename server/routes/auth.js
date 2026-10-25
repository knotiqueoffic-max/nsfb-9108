const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { generateToken, authenticate, adminOnly } = require('../middleware/auth');
const { verifyGoogleToken } = require('../services/google.service');

// ─── Helper: build tenant-enriched user object ────────────────────────────────
async function buildUserResponse(user) {
  const tenant = await db('tenants').where('id', user.tenant_id).first();
  const plan = tenant ? await db('plans').where('id', tenant.plan_id).first() : null;
  return {
    id:                  user.id,
    name:                user.name,
    email:               user.email,
    role:                user.role,
    wage_mode:           user.wage_mode,
    tenant_id:           user.tenant_id,
    tenant_name:         tenant?.name,
    tenant_slug:         tenant?.slug,
    plan_id:             tenant?.plan_id,
    plan_name:           plan?.name,
    subscription_status: tenant?.subscription_status,
    trial_ends_at:       tenant?.trial_ends_at,
    onboarding_dismissed: tenant?.onboarding_dismissed,
    google_profile_photo: user.google_profile_photo,
    auth_methods:        user.auth_methods,
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
  const user = await db('users').where('email', email).where('is_active', true).first();

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = generateToken(user);
  const userResponse = await buildUserResponse(user);
  res.json({ token, user: userResponse });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  const user = await db('users')
    .where('id', req.user.id)
    .select('id', 'name', 'email', 'role', 'wage_mode', 'wage_rate', 'tenant_id')
    .first();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const userResponse = await buildUserResponse(user);
  res.json(userResponse);
});

// ─── POST /api/auth/signup — public; creates a new tenant + owner account ─────
router.post('/signup', [
  body('name').trim().notEmpty().withMessage('Full name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('company_name').trim().notEmpty().withMessage('Business name is required'),
  body('plan_id').optional().isIn(['starter', 'growth', 'business']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, email, password, company_name, plan_id = 'starter', business_category } = req.body;

  // Check email not already used
  const existingUser = await db('users').where('email', email).first();
  if (existingUser) return res.status(409).json({ error: 'Email already registered' });

  // Create tenant slug (url-safe from company name)
  let baseSlug = company_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // Ensure slug is unique
  let slug = baseSlug;
  let slugSuffix = 1;
  while (await db('tenants').where('slug', slug).first()) {
    slug = `${baseSlug}-${slugSuffix++}`;
  }

  // 14-day trial
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

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
        onboarding_dismissed: false,
      }).returning('id');
      const resolvedTenantId = typeof tenantId === 'object' ? tenantId.id : tenantId;

      // Create owner user
      const password_hash = await bcrypt.hash(password, 10);
      const [userId] = await trx('users').insert({
        tenant_id:     resolvedTenantId,
        name,
        email,
        password_hash,
        role:          'owner',
        is_active:     true,
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

    const user = await db('users').where('id', result.userId).first();
    const token = generateToken(user);
    const userResponse = await buildUserResponse(user);
    res.status(201).json({ token, user: userResponse });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
});

// ─── POST /api/auth/register — admin-only; add a worker to the tenant ─────────
router.post('/register', authenticate, adminOnly, [
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('role').isIn(['admin', 'worker']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, email, password, role, wage_mode, wage_rate } = req.body;

  const existing = await db('users').where('email', email).first();
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const password_hash = await bcrypt.hash(password, 10);
  const [id] = await db('users')
    .insert({
      tenant_id: req.tenant_id,   // scoped to current tenant
      name,
      email,
      password_hash,
      role,
      wage_mode,
      wage_rate: wage_rate || 0,
    })
    .returning('id');
  const userId = typeof id === 'object' ? id.id : id;

  const user = await db('users')
    .where('id', userId)
    .select('id', 'name', 'email', 'role', 'wage_mode', 'wage_rate', 'tenant_id')
    .first();
  res.status(201).json(user);
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
  await db('users').where('id', req.user.id).update({ password_hash });
  res.json({ message: 'Password changed successfully' });
});

// ─── GET /api/auth/config ─────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  });
});

// ─── POST /api/auth/google-login ──────────────────────────────────────────────
router.post('/google-login', async (req, res) => {
  const { token, plan_id = 'starter' } = req.body;
  if (!token) return res.status(400).json({ error: 'Google ID token is required' });

  try {
    const { googleId, email, name, googleProfilePhoto } = await verifyGoogleToken(token);

    // 1. Check if user already exists by googleId
    let user = await db('users').where('google_id', googleId).where('is_active', true).first();

    if (user) {
      // Existing Google user: update profile photo just in case and log in
      await db('users').where('id', user.id).update({
        google_profile_photo: googleProfilePhoto || user.google_profile_photo,
      });
      const knotiqueToken = generateToken(user);
      const userResponse = await buildUserResponse({ ...user, google_profile_photo: googleProfilePhoto });
      return res.json({ token: knotiqueToken, user: userResponse });
    }

    // 2. Check if user exists by email (account linking)
    user = await db('users').where('email', email).where('is_active', true).first();

    if (user) {
      // Existing email/password user: link Google login
      if (user.role === 'worker') {
        return res.status(403).json({ error: 'Worker accounts must log in with email and password' });
      }

      // Link accounts
      const currentMethods = user.auth_methods ? user.auth_methods.split(',') : ['email_password'];
      if (!currentMethods.includes('google')) {
        currentMethods.push('google');
      }

      await db('users').where('id', user.id).update({
        google_id:            googleId,
        google_profile_photo: googleProfilePhoto,
        auth_methods:         currentMethods.join(','),
      });

      const updatedUser = await db('users').where('id', user.id).first();
      const knotiqueToken = generateToken(updatedUser);
      const userResponse = await buildUserResponse(updatedUser);
      return res.json({
        token:   knotiqueToken,
        user:    userResponse,
        message: 'Google account linked to your existing profile successfully!',
      });
    }

    // 3. Brand new user signup via Google: create tenant and user account
    // Generate company name based on name
    const company_name = `${name}'s Workspace`;
    let baseSlug = company_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    let slug = baseSlug;
    let slugSuffix = 1;
    while (await db('tenants').where('slug', slug).first()) {
      slug = `${baseSlug}-${slugSuffix++}`;
    }

    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const result = await db.transaction(async (trx) => {
      // Create new tenant
      const [tenantId] = await trx('tenants').insert({
        name:                company_name,
        slug,
        business_category:   'Crochet & Knitting',
        plan_id:             plan_id,
        trial_ends_at:       trialEndsAt,
        subscription_status: 'trialing',
        onboarding_dismissed: false,
      }).returning('id');
      const resolvedTenantId = typeof tenantId === 'object' ? tenantId.id : tenantId;

      // Create owner user linked with Google
      const [userId] = await trx('users').insert({
        tenant_id:            resolvedTenantId,
        name,
        email,
        password_hash:        null, // google-only user has no password initially
        role:                 'owner',
        is_active:            true,
        google_id:            googleId,
        google_profile_photo: googleProfilePhoto,
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
    return res.status(201).json({ token: knotiqueToken, user: userResponse });

  } catch (err) {
    console.error('Google Sign-in error:', err);
    res.status(500).json({ error: err.message || 'Failed to authenticate with Google.' });
  }
});

module.exports = router;
