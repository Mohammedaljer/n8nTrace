const crypto = require('crypto');
const { AUDIT_LOG_IP_MODE, AUDIT_LOG_IP_SALT, TRUST_PROXY } = require('../config');
const { pool } = require('../db/pool');

// ============================================================================
// AUDIT LOGGING (client IP + mode)
// ============================================================================

const AUDIT_IP_MAX_LEN = 45; // IPv6 max
const TRUST_PROXY_ENABLED = TRUST_PROXY !== '0' && TRUST_PROXY !== 'false';

/** Check if string looks like a public (non-private) IP for X-Forwarded-For preference. */
function isPublicIp(s) {
  if (!s || typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (/^127\.|^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^::1$|^fc00:|^fe80:/i.test(trimmed)) return false;
  return /^[\da-f.:\[\]]+$/i.test(trimmed);
}

/** Strip port from IP string: [addr]:port or ipv4:port only, so IPv6 like 2001:db8::1 is unchanged. */
function stripPort(part) {
  if (/\]:\d+$/.test(part)) return part.replace(/\]:\d+$/, ']');
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(part)) return part.replace(/:\d+$/, '');
  return part;
}

/** Parse Forwarded header (RFC 7239); return first valid for= value or null. */
function parseForwardedFor(header) {
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/\bfor=([^;,\s]+)/i);
  if (!match) return null;
  let v = match[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  v = stripPort(v).trim();
  if (v.length > 0 && v.length <= AUDIT_IP_MAX_LEN && /^[\da-f.:\[\]]+$/i.test(v)) return v;
  return null;
}

/** Parse X-Forwarded-For: left-most public IP if any, else left-most. */
function parseXForwardedFor(header) {
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(',').map(s => stripPort(s.trim()));
  let firstPublic = null;
  for (const p of parts) {
    if (p.length > 0 && p.length <= AUDIT_IP_MAX_LEN && /^[\da-f.:\[\]]+$/i.test(p)) {
      if (!firstPublic) firstPublic = p;
      if (isPublicIp(p)) return p;
    }
  }
  return firstPublic;
}

/** Sanitize IP string: strip port, brackets (keep content), reject invalid, max length. */
function sanitizeIp(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  let s = raw.trim().replace(/,/g, '');
  const portMatch = s.match(/^(.+):(\d+)$/);
  if (portMatch && !portMatch[1].includes('.')) s = portMatch[1];
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (s.length > AUDIT_IP_MAX_LEN) s = s.slice(0, AUDIT_IP_MAX_LEN);
  if (s.length === 0 || !/^[\da-f.:]+$/i.test(s)) return null;
  return s;
}

/**
 * Get client IP from request. When TRUST_PROXY is enabled: use Forwarded for=, then X-Forwarded-For (left-most public if any, else left-most), then X-Real-IP, then req.ip/req.ips.
 * When TRUST_PROXY is disabled: use only req.ip or connection.remoteAddress (do not trust headers).
 * Sanitized: single IP, no port, max length.
 */
function getClientIp(req) {
  let raw = null;
  if (TRUST_PROXY_ENABLED) {
    raw = parseForwardedFor(req.get('forwarded'));
    if (!raw) raw = parseXForwardedFor(req.get('x-forwarded-for'));
    if (!raw && req.get('x-real-ip')) raw = sanitizeIp(req.get('x-real-ip'));
    if (!raw && req.ip) raw = sanitizeIp(req.ip);
    if (!raw && req.ips && req.ips.length > 0) raw = sanitizeIp(req.ips[0]);
  }
  if (!raw) raw = sanitizeIp(req.ip || req.connection?.remoteAddress || '');
  return raw ? sanitizeIp(raw) : null;
}

/** Return IP string for audit log per AUDIT_LOG_IP_MODE: none → null, raw → sanitized IP, hashed → SHA-256(ip + salt). */
function getAuditIp(req) {
  if (AUDIT_LOG_IP_MODE === 'none') return null;
  const clientIp = getClientIp(req);
  if (!clientIp) return null;
  if (AUDIT_LOG_IP_MODE === 'hashed') {
    return crypto.createHash('sha256').update(clientIp + AUDIT_LOG_IP_SALT).digest('hex');
  }
  return clientIp;
}

async function logAudit(action, { actorUserId = null, targetType = null, targetId = null, metadata = {}, ip = null, userAgent = null, instanceId = null } = {}) {
  try {
    // Never log sensitive data
    const safeMetadata = { ...metadata };
    delete safeMetadata.password;
    delete safeMetadata.token;
    delete safeMetadata.secret;
    
    await pool.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata, ip, user_agent, instance_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [actorUserId, action, targetType, targetId, JSON.stringify(safeMetadata), ip, userAgent, instanceId]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

function getAuditContext(req) {
  return {
    actorUserId: req.user?.sub || null,
    ip: getAuditIp(req),
    userAgent: req.get('user-agent')?.substring(0, 500) || null,
  };
}


module.exports = { logAudit, getAuditContext, getAuditIp, getClientIp, isPublicIp };
