const crypto = require('crypto');
const { pool } = require('../db/pool');
const { TOKEN_EXPIRY_MINUTES } = require('../config');

function generateSecureToken() { return crypto.randomBytes(32).toString('hex'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function getBaseUrl() { return process.env.APP_URL || process.env.CORS_ORIGIN || 'http://localhost:3000'; }
function clearAuthCookie(res) {
  const opts = { path: '/', httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  res.clearCookie(TOKEN_COOKIE, opts);
}

async function createPasswordToken(userId, type) {
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);
  await pool.query(`UPDATE user_password_tokens SET used_at = now() WHERE user_id = $1 AND type = $2 AND used_at IS NULL`, [userId, type]);
  await pool.query(`INSERT INTO user_password_tokens (user_id, token_hash, type, expires_at) VALUES ($1, $2, $3, $4)`, [userId, tokenHash, type, expiresAt]);
  return { rawToken, expiresAt };
}

async function validateAndConsumeToken(rawToken, expectedType) {
  const tokenHash = hashToken(rawToken);
  const { rows } = await pool.query(
    `SELECT t.id, t.user_id, t.type, t.expires_at, t.used_at, u.email, u.is_active
     FROM user_password_tokens t JOIN app_users u ON u.id = t.user_id WHERE t.token_hash = $1`, [tokenHash]
  );
  if (!rows.length) return { valid: false, error: 'Invalid or expired link' };
  const token = rows[0];
  if (token.used_at) return { valid: false, error: 'Link already used' };
  if (new Date(token.expires_at) < new Date()) return { valid: false, error: 'Link expired' };
  if (token.type !== expectedType) return { valid: false, error: 'Invalid link type' };
  if (!token.is_active) return { valid: false, error: 'Account inactive' };
  await pool.query(`UPDATE user_password_tokens SET used_at = now() WHERE id = $1`, [token.id]);
  return { valid: true, userId: token.user_id, email: token.email };
}

module.exports = { generateSecureToken, hashToken, getBaseUrl, createPasswordToken, validateAndConsumeToken };
