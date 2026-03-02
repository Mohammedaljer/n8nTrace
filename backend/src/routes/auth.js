const express = require('express');
const bcrypt = require('bcryptjs');
const { BCRYPT_ROUNDS: configBcryptRounds, ACCOUNT_LOCKOUT_THRESHOLD, ACCOUNT_LOCKOUT_DURATION_MINUTES } = require('../config');
const { validatePasswordStrength } = require('../utils/password');

// Guard: ensure BCRYPT_ROUNDS is always a valid number, fallback to 10
const BCRYPT_ROUNDS = (typeof configBcryptRounds === 'number' && configBcryptRounds > 0)
  ? configBcryptRounds
  : (() => {
      console.error('[AUTH] WARNING: BCRYPT_ROUNDS is missing or invalid, falling back to 10');
      return 10;
    })();

function createAuthRouter(deps) {
  const {
    pool,
    state,
    loginLimiter, sensitiveAuthLimiter, authSessionLimiter, signToken, setAuthCookie, clearAuthCookie, requireAuth, getUserPermissions, createPasswordToken, validateAndConsumeToken, hashToken, logAudit, getAuditContext
  } = deps;

  const router = express.Router();

// ============================================================================
// ROUTES: AUTH
// ============================================================================

router.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const GENERIC_AUTH_ERROR = 'Invalid email or password';
  const cleanEmail = String(email).toLowerCase();

  const { rows } = await pool.query(
    `SELECT id, email, password_hash, is_active, token_version,
            failed_login_attempts, locked_until, last_failed_login_at
     FROM app_users WHERE email = $1`,
    [cleanEmail]
  );
  const user = rows[0];

  // User not found — constant-time-ish delay then generic error (no info leak)
  if (!user || !user.is_active || !user.password_hash) {
    // Perform a dummy bcrypt compare to prevent timing-based user enumeration
    await bcrypt.compare(String(password), '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWX0123');
    await logAudit('login_failed', { ...getAuditContext(req), metadata: { email: cleanEmail.substring(0, 100) } });
    return res.status(401).json({ error: GENERIC_AUTH_ERROR });
  }

  // Check account lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await logAudit('login_failed', { ...getAuditContext(req), metadata: { email: cleanEmail.substring(0, 100), reason: 'account_locked' } });
    return res.status(401).json({ error: GENERIC_AUTH_ERROR });
  }

  // Verify password
  const passwordValid = await bcrypt.compare(String(password), user.password_hash);

  if (!passwordValid) {
    const newAttempts = (user.failed_login_attempts || 0) + 1;
    const lockAccount = newAttempts >= ACCOUNT_LOCKOUT_THRESHOLD;
    const lockUntil = lockAccount
      ? new Date(Date.now() + ACCOUNT_LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString()
      : null;

    await pool.query(
      `UPDATE app_users
       SET failed_login_attempts = $2,
           last_failed_login_at = now(),
           locked_until = COALESCE($3::timestamptz, locked_until)
       WHERE id = $1`,
      [user.id, newAttempts, lockUntil]
    );

    await logAudit('login_failed', { ...getAuditContext(req), metadata: { email: cleanEmail.substring(0, 100) } });

    if (lockAccount) {
      await logAudit('account_locked', {
        ...getAuditContext(req),
        targetType: 'user',
        targetId: user.id,
        metadata: { failedAttempts: newAttempts, lockedUntil: lockUntil },
      });
    }

    return res.status(401).json({ error: GENERIC_AUTH_ERROR });
  }

  // Successful login — check if account was previously locked (expired lockout)
  const wasLocked = user.locked_until && new Date(user.locked_until) <= new Date() && user.failed_login_attempts > 0;

  // Reset lockout counters on success
  await pool.query(
    `UPDATE app_users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    [user.id]
  );

  if (wasLocked) {
    await logAudit('account_unlocked', {
      ...getAuditContext(req),
      targetType: 'user',
      targetId: user.id,
      metadata: { previousLockUntil: user.locked_until },
    });
  }

  const token = signToken({ sub: user.id, email: user.email, token_version: user.token_version ?? 0 });
  setAuthCookie(res, token);
  await logAudit('login_success', { ...getAuditContext(req), actorUserId: user.id });
  res.json({ ok: true });
});

router.post('/api/auth/logout', authSessionLimiter, (req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

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

  // Validate token first so we have the user's email for password checks
  const result = await validateAndConsumeToken(token, 'invite_set_password');
  if (!result.valid) return res.status(400).json({ error: result.error });

  const pwCheck = validatePasswordStrength(password, { email: result.email });
  if (!pwCheck.valid) return res.status(400).json({ error: pwCheck.reason });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query(`UPDATE app_users SET password_hash = $2, password_set_at = now(), token_version = COALESCE(token_version, 0) + 1, updated_at = now() WHERE id = $1`, [result.userId, passwordHash]);
  await logAudit('password_set', { ...getAuditContext(req), actorUserId: result.userId, targetType: 'user', targetId: result.userId });
  res.json({ ok: true, message: 'Password set successfully' });
});

router.post('/api/auth/reset-password', sensitiveAuthLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });

  // Validate token first so we have the user's email for password checks
  const result = await validateAndConsumeToken(token, 'reset_password');
  if (!result.valid) return res.status(400).json({ error: result.error });

  const pwCheckReset = validatePasswordStrength(password, { email: result.email });
  if (!pwCheckReset.valid) return res.status(400).json({ error: pwCheckReset.reason });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query(`UPDATE app_users SET password_hash = $2, password_set_at = now(), token_version = COALESCE(token_version, 0) + 1, updated_at = now() WHERE id = $1`, [result.userId, passwordHash]);
  await logAudit('password_reset_completed', { ...getAuditContext(req), actorUserId: result.userId, targetType: 'user', targetId: result.userId });
  res.json({ ok: true, message: 'Password reset successfully' });
});

router.post('/api/auth/validate-token', sensitiveAuthLimiter, async (req, res) => {
  const { token, type } = req.body || {};
  if (!token || !type) return res.status(400).json({ valid: false });
  const tokenHash = hashToken(token);
  const { rows } = await pool.query(`SELECT t.expires_at, t.used_at, t.type, u.email, u.is_active FROM user_password_tokens t JOIN app_users u ON u.id = t.user_id WHERE t.token_hash = $1`, [tokenHash]);
  if (!rows.length) return res.json({ valid: false });
  const data = rows[0];
  const isValid = !data.used_at && new Date(data.expires_at) > new Date() && data.type === type && data.is_active;
  res.json({ valid: isValid, email: isValid ? data.email : undefined });
});

// ============================================================================
// SESSION REVOCATION: Log out all devices
// Increments token_version, invalidating every outstanding JWT for this user.
// ============================================================================
router.post('/api/auth/revoke-all-sessions', requireAuth, async (req, res) => {
  const userId = req.user.sub;
  await pool.query(
    `UPDATE app_users SET token_version = COALESCE(token_version, 0) + 1, updated_at = now() WHERE id = $1`,
    [userId]
  );
  clearAuthCookie(res);
  await logAudit('all_sessions_revoked', {
    ...getAuditContext(req),
    actorUserId: userId,
    targetType: 'user',
    targetId: userId,
  });
  res.json({ ok: true, message: 'All sessions have been revoked. Please log in again.' });
});

  return router;
}

module.exports = { createAuthRouter };
