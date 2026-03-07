const express = require('express');
const bcrypt = require('bcryptjs');
const { BCRYPT_ROUNDS } = require('../config');
const { validatePasswordStrength } = require('../utils/password');

function createSetupRouter(deps) {
  const {
    pool,
    state,
    setupLimiter, apiReadLimiter, logAudit, getAuditContext
  } = deps;

  const router = express.Router();

// ============================================================================
// ROUTES: SETUP (first-run initial admin)
// setupRequired = true only when zero users exist. After first admin created, setup is disabled.
// ============================================================================
router.get('/api/setup/status', apiReadLimiter, async (req, res) => {
  if (!state.dbReady) return res.status(503).json({ error: 'Service initializing', setupRequired: false });
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM app_users', []);
    const count = rows[0]?.c ?? 0;
    res.json({ setupRequired: count === 0 });
  } catch (err) {
    console.error('Setup status error:', err.message);
    res.status(500).json({ error: 'Internal error', setupRequired: false });
  }
});

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{1,63}$/.test(s.trim()) && s.trim().length <= 255;
}

router.post('/api/setup/initial-admin', setupLimiter, async (req, res) => {
  if (!state.dbReady) return res.status(503).json({ error: 'Service initializing' });
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
  const pwCheck = validatePasswordStrength(password, { email });
  if (!pwCheck.valid) return res.status(400).json({ error: pwCheck.reason });

  try {
    const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS c FROM app_users', []);
    if (countRows[0]?.c !== 0) {
      return res.status(403).json({ error: 'Setup already completed' });
    }
    const cleanEmail = String(email).toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO app_users (email, password_hash, is_active, token_version, password_set_at) VALUES ($1, $2, true, 0, now()) RETURNING id`,
        [cleanEmail, passwordHash]
      );
      const userId = ins.rows[0].id;
      const adminsGrp = await client.query(`SELECT id FROM groups WHERE name = 'Admin'`);
      if (adminsGrp.rows.length > 0) {
        await client.query(`INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, adminsGrp.rows[0].id]);
      }
      await client.query('COMMIT');
      await logAudit('setup_initial_admin_created', { ...getAuditContext(req), targetType: 'user', targetId: userId, metadata: { email: cleanEmail } });
      res.status(201).json({ ok: true, message: 'Initial admin created' });
    } catch (e) {
      await client.query('ROLLBACK');
      if (e?.code === '23505') return res.status(409).json({ error: 'Email already exists' });
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Setup initial-admin error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

  return router;
}

module.exports = { createSetupRouter };
