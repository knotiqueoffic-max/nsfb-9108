const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { ROLES, ACCOUNT_STATUS } = require('../constants/roles');

const isProduction = process.env.NODE_ENV === 'production';
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (isProduction) {
    console.error('FATAL: JWT_SECRET environment variable is missing in production!');
    throw new Error('JWT_SECRET must be configured in production.');
  } else {
    JWT_SECRET = 'knotique-dev-secret-change-in-production';
  }
}
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

/**
 * Generate a signed JWT for an authenticated user.
 * Explicitly includes user ID, role, tenant_id (or null), and token_version.
 * Never defaults tenant_id to 1.
 */
function generateToken(user) {
  return jwt.sign(
    {
      id:            user.id,
      email:         user.email,
      role:          user.role,
      tenant_id:     user.tenant_id || null,
      token_version: user.token_version || 1,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES },
  );
}

/**
 * authenticate — verifies the Bearer JWT, checks server-side account status,
 * validates session token version, and sets:
 *   req.user       = { id, email, role, tenant_id, status }
 *   req.tenant_id  = tenant_id or null (NEVER silently fall back to tenant 1)
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user status and token version against current server state
    const user = await db('users')
      .where('id', decoded.id)
      .select('id', 'name', 'email', 'role', 'tenant_id', 'is_active', 'status', 'token_version')
      .first();

    if (!user) {
      return res.status(401).json({ error: 'User account not found or session terminated' });
    }

    // Account suspension / deactivation check
    const isSuspended = user.status === ACCOUNT_STATUS.SUSPENDED ||
                        user.status === ACCOUNT_STATUS.REJECTED ||
                        user.is_active === false;
    if (isSuspended) {
      return res.status(403).json({
        error: 'Account inactive or suspended',
        message: 'Your account is currently suspended or inactive. Please contact support.',
        status: user.status,
      });
    }

    // Token version check (session revocation / password change / logout all)
    if (decoded.token_version !== undefined && user.token_version > decoded.token_version) {
      return res.status(401).json({
        error: 'Session expired or revoked',
        message: 'Your session has been invalidated. Please sign in again.',
        code: 'SESSION_REVOKED',
      });
    }

    req.user = {
      id:        user.id,
      name:      user.name,
      email:     user.email,
      role:      user.role,
      tenant_id: user.tenant_id || null,
      status:    user.status,
    };
    req.tenant_id = user.tenant_id || null;

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid or malformed token' });
  }
}

/**
 * requireTenant — ensures the request is scoped to a valid organization/tenant.
 * Super admins can bypass tenant scoping for platform-level management.
 */
function requireTenant(req, res, next) {
  if (req.user?.role === ROLES.SUPER_ADMIN) return next();
  if (!req.tenant_id) {
    return res.status(400).json({ error: 'Organization context required for this operation' });
  }
  next();
}

/**
 * adminOnly — allows owner, admin, super_admin roles.
 */
function adminOnly(req, res, next) {
  if ([ROLES.OWNER, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Admin access required' });
}

/**
 * ownerOnly — allows only organization owner and super_admin.
 */
function ownerOnly(req, res, next) {
  if ([ROLES.OWNER, ROLES.SUPER_ADMIN].includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Owner access required' });
}

/**
 * planSubscriberOnly — allows business accounts (owner, admin, vendor, subvendor, super_admin)
 * to view, subscribe, and manage unified subscription plans.
 * Strictly blocks workers/crocheters.
 */
function planSubscriberOnly(req, res, next) {
  if (req.user?.role === ROLES.WORKER || req.user?.role === 'crocheter') {
    return res.status(403).json({ error: 'Workers cannot manage or purchase subscription plans' });
  }
  if ([ROLES.OWNER, ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.SUPER_ADMIN].includes(req.user?.role)) {
    return next();
  }
  return res.status(403).json({ error: 'Subscription access required' });
}

/**
 * superAdminOnly — allows only the platform super_admin.
 */
function superAdminOnly(req, res, next) {
  if (req.user?.role === ROLES.SUPER_ADMIN) return next();
  return res.status(403).json({ error: 'Super admin access required' });
}

/**
 * workerManagerOnly — allows any role capable of managing workers:
 * owner, admin, vendor, subvendor, super_admin.
 */
function workerManagerOnly(req, res, next) {
  if ([ROLES.OWNER, ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.SUPER_ADMIN].includes(req.user?.role)) {
    return next();
  }
  return res.status(403).json({ error: 'Manager access required' });
}

/**
 * vendorOnly — allows vendor and super_admin.
 */
function vendorOnly(req, res, next) {
  if ([ROLES.VENDOR, ROLES.SUPER_ADMIN].includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Vendor access required' });
}

/**
 * selfOrAdmin — allows a user to access their own resource, or admins to access any.
 * Expects the target user ID to be in req.params.id.
 */
function selfOrAdmin(req, res, next) {
  if (
    [ROLES.OWNER, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user?.role) ||
    String(req.user?.id) === String(req.params.id)
  ) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

/**
 * checkTenantLock — blocks write operations (POST/PUT/DELETE/PATCH) when the
 * tenant's subscription is in a 'locked' state (expired trial or failed payment).
 * Read operations (GET) are always allowed so users can view their data.
 */
async function checkTenantLock(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Super admins and workers performing assigned work are never locked out by billing
  if (req.user?.role === ROLES.SUPER_ADMIN || req.user?.role === ROLES.WORKER) return next();

  if (!req.tenant_id) {
    return res.status(400).json({ error: 'Organization context required' });
  }

  try {
    const tenant = await db('tenants').where('id', req.tenant_id).first();
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Subvendor organizations operate under their parent vendor/business and are not forced to pay
    if (tenant.tenant_type === 'subvendor') return next();

    if (tenant.subscription_status === 'locked') {
      return res.status(423).json({
        error: 'Account locked',
        message: 'Your trial has expired or payment failed. Please subscribe to continue.',
        subscription_status: 'locked',
        code: 'ACCOUNT_LOCKED',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  generateToken,
  authenticate,
  requireTenant,
  adminOnly,
  ownerOnly,
  superAdminOnly,
  workerManagerOnly,
  vendorOnly,
  selfOrAdmin,
  checkTenantLock,
  planSubscriberOnly,
};
