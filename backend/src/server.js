/**
 * n8n Pulse - Backend API Server
 * Refactored into modules with zero behavior changes.
 */

// Load dotenv only in non-production environments
if (process.env.APP_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch {
    // dotenv not installed (expected in production)
  }
}

const { validateEnv } = require('./config/env');
validateEnv();

const { pool } = require('./db/pool');
const { autoInit } = require('./db/autoInit');
const { createApp } = require('./app');
const { APP_ENV, RETENTION_ENABLED, METRICS_ENABLED, METRICS_MAX_TIME_RANGE_DAYS, METRICS_MAX_DATAPOINTS, tz } = require('./config');

const state = { dbReady: false };

const app = createApp({ pool, state });

const port = Number(process.env.PORT || 8001);
const server = app.listen(port, async () => {
  console.log(`n8n Pulse API listening on :${port}`);
  console.log(`Environment: ${APP_ENV}`);
  await autoInit();
  state.dbReady = true;
  if (RETENTION_ENABLED) console.log(`Retention: ${process.env.RETENTION_DAYS || 90} days, daily at ${process.env.RETENTION_RUN_AT || '03:30'} ${tz}`);
  if (METRICS_ENABLED) console.log(`Metrics: enabled (max ${METRICS_MAX_TIME_RANGE_DAYS} days, ${METRICS_MAX_DATAPOINTS} datapoints)`);
  else console.log('Metrics: disabled');
});

let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received. Shutting down...`);
  server.close(() => console.log('HTTP server closed'));
  try { await pool.end(); console.log('Database pool closed'); } catch {}
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
