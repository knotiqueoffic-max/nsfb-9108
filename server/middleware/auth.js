const jwt = require('jsonwebtoken');
const db = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'knotique-dev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

/**
 * Generate a signed JWT for a user.
 * Payload includes tenant_id and plan_id for downstream middleware.
 */
function generateToken(user) {
  return jwt.sign(
    {
      id:        user.id,
      email:     user.email,
      role:      user.role,
      tenant_id: user.tenant_id || 1,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES },
  );
}

/**
 * authenticate — verifies the Bearer JWT and populates:
 *   req.user       = { id, email, role, tenant_id }
 *   req.tenant_id  = tenant_id (shorthand used by all routes)
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.tenant_id = decoded.tenant_id || 1; // always available after authenticate
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * adminOnly — allows owner, admin, super_admin roles.
 * Workers get 403.
 */
function adminOnly(req, res, next) {
  if (['owner', 'admin', 'super_admin'].includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Admin access required' });
}

/**
 * ownerOnly — allows only owner and super_admin (not regular admin workers).
 * Used for sensitive tenant-level operations (billing, deleting company data, etc.).
 */
function ownerOnly(req, res, next) {
  if (['owner', 'super_admin'].includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Owner access required' });
}

/**
 * superAdminOnly — allows only the platform super_admin.
 */
function superAdminOnly(req, res, next) {
  if (req.user?.role === 'super_admin') return next();
  return res.status(403).json({ error: 'Super admin access required' });
}

/**
 * selfOrAdmin — allows a user to access their own resource, or admins to access any.
 * Expects the target user ID to be in req.params.id.
 */
function selfOrAdmin(req, res, next) {
  if (
    ['owner', 'admin', 'super_admin'].includes(req.user?.role) ||
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
  // Only block mutating requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Super admins bypass the lock
  if (req.user?.role === 'super_admin') return next();

  try {
    const tenant = await db('tenants').where('id', req.tenant_id).first();
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

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
  adminOnly,
  ownerOnly,
  superAdminOnly,
  selfOrAdmin,
  checkTenantLock,
};
