const db = require('../db/database');

/**
 * Sanitizes an object to ensure no sensitive credentials or tokens enter audit logs.
 */
function sanitizeDetails(details) {
  if (!details || typeof details !== 'object') return details;
  const sanitized = { ...details };
  const sensitiveKeys = ['password', 'password_hash', 'token', 'token_hash', 'secret', 'key', 'credential', 'razorpay_signature'];
  for (const k of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => k.toLowerCase().includes(s))) {
      sanitized[k] = '[REDACTED]';
    } else if (typeof sanitized[k] === 'object' && sanitized[k] !== null) {
      sanitized[k] = sanitizeDetails(sanitized[k]);
    }
  }
  return sanitized;
}

/**
 * Records an audit log entry.
 * Never throws an error so primary business logic remains unaffected.
 */
async function logAuditEvent({
  tenant_id = null,
  user_id = null,
  action,
  target_type = null,
  target_id = null,
  ip_address = null,
  details = null,
}) {
  try {
    const cleanDetails = details ? JSON.stringify(sanitizeDetails(details)) : null;
    await db('audit_logs').insert({
      tenant_id,
      user_id,
      action,
      target_type,
      target_id: target_id ? String(target_id) : null,
      ip_address,
      details: cleanDetails,
      created_at: db.fn.now(),
    });
  } catch (err) {
    console.error('[AuditService] Failed to record audit log:', err.message);
  }
}

module.exports = {
  logAuditEvent,
  sanitizeDetails,
};
