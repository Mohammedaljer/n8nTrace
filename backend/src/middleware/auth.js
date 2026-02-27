const jwt = require('jsonwebtoken');

const { pool } = require('../db/pool');
const {
  JWT_SECRET,
  JWT_EXPIRY,
  COOKIE_SECURE,
  COOKIE_SAMESITE,
  COOKIE_DOMAIN,
  TOKEN_COOKIE,
} = require('../config');

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function setAuthCookie(res, token) {
  const opts = {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    path: '/',
    maxAge: 30 * 60 * 1000,
  };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  res.cookie(TOKEN_COOKIE, token, opts);
}

function clearAuthCookie(res) {
  const opts = {
    path: '/',
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
  };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  res.clearCookie(TOKEN_COOKIE, opts);
}

async function getUserPermissions(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT p.key AS permission FROM app_users u
     LEFT JOIN user_groups ug ON ug.user_id = u.id
     LEFT JOIN group_roles gr ON gr.group_id = ug.group_id
     LEFT JOIN role_permissions rp ON rp.role_id = gr.role_id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = $1 AND u.is_active = true`,
    [userId]
  );
  return rows.map((r) => r.permission).filter(Boolean);
}

async function getUserScope(userId) {
  const { rows } = await pool.query(
    `SELECT gs.instance_id, gs.workflow_id, gs.tag FROM app_users u
     LEFT JOIN user_groups ug ON ug.user_id = u.id
     LEFT JOIN group_scopes gs ON gs.group_id = ug.group_id
     WHERE u.id = $1 AND u.is_active = true`,
    [userId]
  );

  return {
    instanceIds: [...new Set(rows.map((r) => r.instance_id).filter(Boolean))],
    workflowIds: [...new Set(rows.map((r) => r.workflow_id).filter(Boolean))],
    tags: [...new Set(rows.map((r) => r.tag).filter(Boolean))],
    hasAnyScopeRows: rows.some((r) => r.instance_id || r.workflow_id || r.tag),
  };
}

async function getUserTokenVersion(userId) {
  const { rows } = await pool.query(`SELECT token_version FROM app_users WHERE id = $1`, [userId]);
  return rows[0]?.token_version ?? 0;
}

function requireAuth(req, res, next) {
  return (async () => {
    try {
      const token = req.cookies[TOKEN_COOKIE];
      if (!token) return res.status(401).json({ error: 'Not authenticated' });

      const payload = jwt.verify(token, JWT_SECRET);

      const currentVersion = await getUserTokenVersion(payload.sub);
      if (payload.token_version !== undefined && payload.token_version !== currentVersion) {
        clearAuthCookie(res);
        return res.status(401).json({ error: 'Session expired' });
      }

      req.user = payload;
      return next();
    } catch (err) {
      clearAuthCookie(res);
      return res.status(401).json({
        error: err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid session',
      });
    }
  })();
}

function requirePermission(permissionKey) {
  return async (req, res, next) => {
    if (!req.user?.sub) return res.status(401).json({ error: 'Not authenticated' });
    const perms = await getUserPermissions(req.user.sub);
    if (!perms.includes(permissionKey)) return res.status(403).json({ error: 'Forbidden' });
    req.permissions = perms;
    next();
  };
}

async function attachScope(req, res, next) {
  if (req.user?.sub) req.scope = await getUserScope(req.user.sub);
  next();
}

function isAdminRequest(req) {
  return (req.permissions || []).some((p) => p === 'admin:users' || p === 'admin:roles');
}

async function countActiveAdmins() {
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT u.id)::int AS c FROM app_users u
     JOIN user_groups ug ON ug.user_id = u.id JOIN group_roles gr ON gr.group_id = ug.group_id
     JOIN role_permissions rp ON rp.role_id = gr.role_id JOIN permissions p ON p.id = rp.permission_id
     WHERE u.is_active = true AND p.key = 'admin:users'`
  );
  return rows[0]?.c ?? 0;
}

async function userIsActiveAdmin(userId) {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM app_users u JOIN user_groups ug ON ug.user_id = u.id
     JOIN group_roles gr ON gr.group_id = ug.group_id JOIN role_permissions rp ON rp.role_id = gr.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = $1 AND u.is_active = true AND p.key = 'admin:users') AS ok`,
    [userId]
  );
  return Boolean(rows[0]?.ok);
}

async function groupIdsGrantAdmin(groupIds) {
  if (!groupIds?.length) return false;
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM group_roles gr JOIN role_permissions rp ON rp.role_id = gr.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE gr.group_id = ANY($1::uuid[]) AND p.key = 'admin:users') AS ok`,
    [groupIds]
  );
  return Boolean(rows[0]?.ok);
}

module.exports = {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  getUserPermissions,
  getUserScope,
  attachScope,
  requireAuth,
  requirePermission,
  isAdminRequest,
  countActiveAdmins,
  userIsActiveAdmin,
  groupIdsGrantAdmin,
};
