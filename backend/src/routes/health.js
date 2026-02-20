const express = require('express');


function createHealthRouter(deps) {
  const {
    pool,
    state,
    DEBUG_IP, getStableIp
  } = deps;

  const router = express.Router();

// ============================================================================
// ROUTES: HEALTH
// ============================================================================

router.get('/health', async (req, res) => {
  if (!state.dbReady) return res.status(503).json({ ok: false, db: 'initializing' });
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'connected' }); }
  catch { res.status(503).json({ ok: false, db: 'disconnected' }); }
});

router.get('/ready', async (req, res) => {
  if (!state.dbReady) return res.status(503).json({ ready: false });
  try { await pool.query('SELECT 1'); res.json({ ready: true }); }
  catch { res.status(503).json({ ready: false }); }
});

if (DEBUG_IP) {
  router.get('/api/debug/ip', (req, res) => res.json({ ip: req.ip, stableIp: getStableIp(req), xForwardedFor: req.headers['x-forwarded-for'] || null }));
}

  return router;
}

module.exports = { createHealthRouter };
