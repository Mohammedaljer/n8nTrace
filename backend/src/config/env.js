const crypto = require('crypto');

const APP_ENV = process.env.APP_ENV || 'production';
const IS_DEV = APP_ENV === 'development';

const requiredEnvVars = ['DATABASE_URL'];
const productionRequiredEnvVars = ['JWT_SECRET', 'APP_URL', 'CORS_ORIGIN'];
const UNSAFE_PLACEHOLDERS = ['changeme', 'password123', 'secret', 'asdasd', 'asdsad', 'your_ingest_password_change_me', 'dev-insecure-secret-change-me', 'dev-insecure'];

function validateEnv() {
  const missing = [];
  for (const key of requiredEnvVars) {
    if (!process.env[key]) missing.push(key);
  }
  if (!IS_DEV) {
    for (const key of productionRequiredEnvVars) {
      if (!process.env[key]) missing.push(key);
    }
  }
  if (missing.length > 0) {
    console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  const jwtSecret = process.env.JWT_SECRET || '';
  if (!IS_DEV && jwtSecret.length < 32) {
    console.error('FATAL: JWT_SECRET must be at least 32 characters in production');
    process.exit(1);
  }
  if (IS_DEV && (!jwtSecret || jwtSecret.length < 20)) {
    console.warn('WARNING: JWT_SECRET is missing or weak.');
  }

  // Fail-fast in production: unsafe defaults
  if (!IS_DEV) {
    const corsOrigin = (process.env.CORS_ORIGIN || '').trim();
    if (corsOrigin === '*') {
      console.error('FATAL: CORS_ORIGIN must not be * in production when using credentials (cookies)');
      process.exit(1);
    }
    const cookieSecure = (process.env.COOKIE_SECURE || 'true').toLowerCase();
    if (cookieSecure === 'false' || cookieSecure === '0') {
      console.error('FATAL: COOKIE_SECURE must be true in production (use HTTPS)');
      process.exit(1);
    }
    const secretLower = jwtSecret.toLowerCase();
    if (UNSAFE_PLACEHOLDERS.some(p => secretLower.includes(p))) {
      console.error('FATAL: JWT_SECRET must not contain placeholder or weak values (e.g. changeme, password123, secret)');
      process.exit(1);
    }
    const dbUrl = process.env.DATABASE_URL || '';
    const postgresPassword = process.env.POSTGRES_PASSWORD || (dbUrl.match(/:[^:@]+@/)?.[0]?.slice(1, -1) || '');
    const combined = (postgresPassword + ' ' + dbUrl).toLowerCase();
    if (UNSAFE_PLACEHOLDERS.some(p => combined.includes(p))) {
      console.error('FATAL: Database credentials must not use placeholder values (e.g. changeme, password123). Set POSTGRES_PASSWORD and DATABASE_URL to strong values.');
      process.exit(1);
    }
  }
}

module.exports = { validateEnv };
