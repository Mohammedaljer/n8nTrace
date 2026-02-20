const express = require('express');
const bcrypt = require('bcryptjs');

function createAuthRouter(deps) {
  const {
    pool,
    state,
    loginLimiter, sensitiveAuthLimiter, BCRYPT_ROUNDS, signToken, setAuthCookie, clearAuthCookie, requireAuth, getUserPermissions, createPasswordToken, validateAndConsumeToken, hashToken, logAudit, getAuditContext
  } = deps;

  const router = express.Router();

// ============================================================================
// ROUTES: AUTH
// ============================================================================

router.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { rows } = await pool.query(`SELECT id, email, password_hash, is_active, token_version FROM app_users WHERE email = $1`, [String(email).toLowerCase()]);
  const user = rows[0];

  if (!user || !user.is_active || !user.password_hash || !(await bcrypt.compare(String(password), user.password_hash))) {
    await logAudit('login_failed', { ...getAuditContext(req), metadata: { email: String(email).toLowerCase().substring(0, 100) } });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken({ sub: user.id, email: user.email, token_version: user.token_version ?? 0 });
  setAuthCookie(res, token);
  await logAudit('login_success', { ...getAuditContext(req), actorUserId: user.id });
  res.json({ ok: true });
});

router.post('/api/auth/logout', (req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

router.get('/api/auth/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`SELECT id, email, is_active FROM app_users WHERE id = $1`, [req.user.sub]);
  if (!rows[0]) return res.status(401).json({ error: 'Not authenticated' });
  const permissions = await getUserPermissions(rows[0].id);
  res.json({ user: { id: rows[0].id, email: rows[0].email }, permissions });
});

router.post('/api/auth/forgot-password', sensitiveAuthLimiter, async (req, res) => {
  const { email } = req.body || {};
  const message = 'If this email exists, a reset link has been generated. Contact your administrator.';
  if (email) {
    const { rows } = await pool.query(`SELECT id FROM app_users WHERE email = $1 AND is_active = true`, [String(email).toLowerCase().trim()]);
    if (rows.length) {
      await createPasswordToken(rows[0].id, 'reset_password');
      await logAudit('password_reset_requested', { ...getAuditContext(req), targetType: 'user', targetId: rows[0].id });
    }
  }
  res.json({ ok: true, message });
});

router.post('/api/auth/set-password', sensitiveAuthLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const result = await validateAndConsumeToken(token, 'invite_set_password');
  if (!result.valid) return res.status(400).json({ error: result.error });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query(`UPDATE app_users SET password_hash = $2, password_set_at = now(), token_version = COALESCE(token_version, 0) + 1, updated_at = now() WHERE id = $1`, [result.userId, passwordHash]);
  await logAudit('password_set', { ...getAuditContext(req), actorUserId: result.userId, targetType: 'user', targetId: result.userId });
  res.json({ ok: true, message: 'Password set successfully' });
});

router.post('/api/auth/reset-password', sensitiveAuthLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const result = await validateAndConsumeToken(token, 'reset_password');
  if (!result.valid) return res.status(400).json({ error: result.error });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query(`UPDATE app_users SET password_hash = $2, password_set_at = now(), token_version = COALESCE(token_version, 0) + 1, updated_at = now() WHERE id = $1`, [result.userId, passwordHash]);
  await logAudit('password_reset_completed', { ...getAuditContext(req), actorUserId: result.userId, targetType: 'user', targetId: result.userId });
  res.json({ ok: true, message: 'Password reset successfully' });
});

router.post('/api/auth/validate-token', async (req, res) => {
  const { token, type } = req.body || {};
  if (!token || !type) return res.status(400).json({ valid: false });
  const tokenHash = hashToken(token);
  const { rows } = await pool.query(`SELECT t.expires_at, t.used_at, t.type, u.email, u.is_active FROM user_password_tokens t JOIN app_users u ON u.id = t.user_id WHERE t.token_hash = $1`, [tokenHash]);
  if (!rows.length) return res.json({ valid: false });
  const data = rows[0];
  const isValid = !data.used_at && new Date(data.expires_at) > new Date() && data.type === type && data.is_active;
  res.json({ valid: isValid, email: isValid ? data.email : undefined });
});

  return router;
}

module.exports = { createAuthRouter };
