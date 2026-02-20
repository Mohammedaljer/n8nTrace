const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '5000', 10),
});

pool.on('error', (err) => console.error('Database pool error:', err.message));

// ============================================================================
// AUTO-INIT: Migrations + Admin Seed (idempotent, runs on every startup)
// ============================================================================

let dbReady = false;

module.exports = { pool };
