/**
 * Central Roles, Statuses, and Permissions Definition
 * Knotique Business Manager
 */

const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin', // Platform-level administrator
  OWNER:       'owner',       // Organization owner / primary admin
  ADMIN:       'admin',       // Organization administrator
  VENDOR:      'vendor',      // Supplier / vendor organization
  SUBVENDOR:   'subvendor',   // Subcontractor under a vendor
  WORKER:      'worker',      // Production worker / artisan (crocheter)
  CROCHETER:   'worker',      // Business-facing terminology alias for worker
});

const ACCOUNT_STATUS = Object.freeze({
  ACTIVE:    'active',
  PENDING:   'pending',
  SUSPENDED: 'suspended',
  REJECTED:  'rejected',
});

const TENANT_TYPES = Object.freeze({
  BUSINESS:  'business',
  VENDOR:    'vendor',
  SUBVENDOR: 'subvendor',
});

const RELATIONSHIP_TYPES = Object.freeze({
  VENDOR_SUBVENDOR: 'vendor_subvendor',
  SUPPLIER:         'supplier',
});

const INVITATION_STATUS = Object.freeze({
  PENDING:  'pending',
  ACCEPTED: 'accepted',
  EXPIRED:  'expired',
  REVOKED:  'revoked',
});

const PRODUCTION_REQUEST_STATUS = Object.freeze({
  DRAFT:                'draft',
  OPEN:                 'open',
  AWARDED:              'awarded',
  ACCEPTED:             'accepted',
  IN_PROGRESS:          'in_progress',
  SUBMITTED_FOR_REVIEW: 'submitted_for_review',
  APPROVED:             'approved',
  COMPLETED:            'completed',
  DECLINED:             'declined',
  CANCELLED:            'cancelled',
  EXPIRED:              'expired',
});

const PRODUCTION_BID_STATUS = Object.freeze({
  SUBMITTED:    'submitted',
  REVISED:      'revised',
  WITHDRAWN:    'withdrawn',
  AWARDED:      'awarded',
  ACCEPTED:     'accepted',
  DECLINED:     'declined',
  NOT_SELECTED: 'not_selected',
});

const PRODUCTION_PROGRESS_STATUS = Object.freeze({
  PROGRESS:             'progress',
  SUBMITTED_FOR_REVIEW: 'submitted_for_review',
  CORRECTION_REQUESTED: 'correction_requested',
  APPROVED:             'approved',
});

// Helper checks
function isPlatformAdmin(role) {
  return role === ROLES.SUPER_ADMIN;
}

function isOwner(role) {
  return [ROLES.OWNER, ROLES.SUPER_ADMIN].includes(role);
}

function isAdmin(role) {
  return [ROLES.OWNER, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role);
}

function isVendor(role) {
  return role === ROLES.VENDOR;
}

function isSubvendor(role) {
  return role === ROLES.SUBVENDOR;
}

function isWorker(role) {
  return role === ROLES.WORKER || role === 'crocheter';
}

function isCrocheter(role) {
  return role === ROLES.WORKER || role === 'crocheter';
}

function canManageWorkers(role) {
  return [ROLES.OWNER, ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.SUPER_ADMIN].includes(role);
}

function canManageBilling(role) {
  return [ROLES.OWNER, ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.SUPER_ADMIN].includes(role);
}

function canManagePurchasing(role) {
  return [ROLES.OWNER, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role);
}

function canCreateProductionRequest(role) {
  return [ROLES.OWNER, ROLES.ADMIN, ROLES.VENDOR, ROLES.SUBVENDOR, ROLES.SUPER_ADMIN].includes(role);
}

/**
 * Checks whether an actor can assign or invite a target role.
 * Prevents privilege escalation.
 */
function canAssignRole(actorRole, targetRole) {
  if (actorRole === ROLES.SUPER_ADMIN) return true;
  if (targetRole === ROLES.SUPER_ADMIN) return false; // Non-super admins can never create super admins

  if (actorRole === ROLES.OWNER) {
    return [ROLES.ADMIN, ROLES.WORKER, ROLES.VENDOR].includes(targetRole);
  }
  if (actorRole === ROLES.ADMIN) {
    return [ROLES.WORKER].includes(targetRole);
  }
  if (actorRole === ROLES.VENDOR) {
    return [ROLES.SUBVENDOR, ROLES.WORKER].includes(targetRole);
  }
  if (actorRole === ROLES.SUBVENDOR) {
    return [ROLES.WORKER].includes(targetRole);
  }
  return false;
}

module.exports = {
  ROLES,
  ACCOUNT_STATUS,
  TENANT_TYPES,
  RELATIONSHIP_TYPES,
  INVITATION_STATUS,
  PRODUCTION_REQUEST_STATUS,
  PRODUCTION_BID_STATUS,
  PRODUCTION_PROGRESS_STATUS,
  isPlatformAdmin,
  isOwner,
  isAdmin,
  isVendor,
  isSubvendor,
  isWorker,
  isCrocheter,
  canManageWorkers,
  canManageBilling,
  canManagePurchasing,
  canCreateProductionRequest,
  canAssignRole,
};
