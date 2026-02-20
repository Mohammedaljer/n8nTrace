// Auto-generated from original index.js CONFIGURATION section (logic unchanged)

// Environment first (must be defined before any derived values use IS_DEV)
const APP_ENV = process.env.APP_ENV || 'production';
const IS_DEV = APP_ENV === 'development';

// Timezone
const tz = process.env.RETENTION_TZ || 'UTC';

// App URL & CORS (must exist because you export them)
const CORS_ORIGIN = process.env.CORS_ORIGIN || (IS_DEV ? 'http://localhost:3000' : undefined);
const APP_URL = process.env.APP_URL || process.env.CORS_ORIGIN || (IS_DEV ? 'http://localhost:3000' : '');

// Auth / cookies
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '30m';
const TRUST_PROXY = process.env.TRUST_PROXY || '1'; // default 1 when behind single reverse proxy (e.g. nginx in stack)
const COOKIE_SECURE = (process.env.COOKIE_SECURE || (IS_DEV ? 'false' : 'true')).toLowerCase() === 'true';
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'lax';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
const TOKEN_COOKIE = 'n8n_pulse_token';
const TOKEN_EXPIRY_MINUTES = 60;
const BCRYPT_ROUNDS = 10;

// Logging / debug
const DEBUG_IP = IS_DEV && (process.env.DEBUG_IP || 'false').toLowerCase() === 'true';
const LOG_FORMAT = process.env.LOG_FORMAT || (IS_DEV ? 'dev' : 'json');

// Retention configuration
const RETENTION_ENABLED = (process.env.RETENTION_ENABLED || 'false').toLowerCase() === 'true';
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '90', 10);
const RETENTION_RUN_AT = process.env.RETENTION_RUN_AT || '03:30';
const RETENTION_BATCH_SIZE = 10000; // Hardcoded conservative batch size

// Metrics feature flag (global toggle)
const METRICS_ENABLED = (process.env.METRICS_ENABLED || 'false').toLowerCase() === 'true';
// Metrics security limits
const METRICS_MAX_TIME_RANGE_DAYS = parseInt(process.env.METRICS_MAX_TIME_RANGE_DAYS || '30', 10);
const METRICS_MAX_DATAPOINTS = parseInt(process.env.METRICS_MAX_DATAPOINTS || '1000', 10);

// Audit log IP: none | raw | hashed. If hashed, AUDIT_LOG_IP_SALT is required.
const AUDIT_LOG_IP_MODE = (process.env.AUDIT_LOG_IP_MODE || 'raw').toLowerCase();
const AUDIT_LOG_IP_SALT = process.env.AUDIT_LOG_IP_SALT || '';
if (AUDIT_LOG_IP_MODE === 'hashed' && !AUDIT_LOG_IP_SALT) {
  console.error('FATAL: AUDIT_LOG_IP_SALT is required when AUDIT_LOG_IP_MODE=hashed');
  process.exit(1);
}

module.exports = {
  tz,
  APP_ENV,
  IS_DEV,

  CORS_ORIGIN,
  APP_URL,

  JWT_SECRET,
  JWT_EXPIRY,
  TRUST_PROXY,
  COOKIE_SECURE,
  COOKIE_SAMESITE,
  COOKIE_DOMAIN,
  TOKEN_COOKIE,
  TOKEN_EXPIRY_MINUTES,
  BCRYPT_ROUNDS,

  DEBUG_IP,
  LOG_FORMAT,

  RETENTION_ENABLED,
  RETENTION_DAYS,
  RETENTION_RUN_AT,
  RETENTION_BATCH_SIZE,

  METRICS_ENABLED,
  METRICS_MAX_TIME_RANGE_DAYS,
  METRICS_MAX_DATAPOINTS,

  AUDIT_LOG_IP_MODE,
  AUDIT_LOG_IP_SALT,
};
