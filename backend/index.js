/**
 * n8n Pulse - Backend API Server
 * Production-ready with secure defaults, retention cleanup, and audit logging
 */

// Load dotenv only in non-production environments
// In production, environment variables come from Docker/Compose
if (process.env.APP_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch {
    // dotenv not installed (expected in production)
  }
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');
const cron = require('node-cron');
const RETENTION_TZ = process.env.RETENTION_TZ || 'UTC';
// ============================================================================
// ENVIRONMENT VALIDATION
// ============================================================================

const APP_ENV = process.env.APP_ENV || 'production';
const IS_DEV = APP_ENV === 'development';

const requiredEnvVars = ['DATABASE_URL'];
const productionRequiredEnvVars = ['JWT_SECRET'];
const UNSAFE_PLACEHOLDERS = ['changeme', 'password123', 'secret', 'asdasd', 'asdsad', 'your_ingest_password_change_me'];

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

validateEnv();

// ============================================================================
// CONFIGURATION
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '30m';
const TRUST_PROXY = process.env.TRUST_PROXY || '1'; // default 1 when behind single reverse proxy (e.g. nginx in stack)
const COOKIE_SECURE = (process.env.COOKIE_SECURE || (IS_DEV ? 'false' : 'true')).toLowerCase() === 'true';
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'lax';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
const TOKEN_COOKIE = 'n8n_pulse_token';
const TOKEN_EXPIRY_MINUTES = 60;
const BCRYPT_ROUNDS = 10;
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

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================

const app = express();

if (TRUST_PROXY !== '0' && TRUST_PROXY !== 'false') {
  const trustValue = TRUST_PROXY === '1' || TRUST_PROXY === 'true' ? 1 : TRUST_PROXY;
  app.set('trust proxy', trustValue);
  console.log(`Proxy trust enabled: ${trustValue}`);
}

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

if (LOG_FORMAT === 'json') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Date.now() - start,
        ip: req.ip,
      }));
    });
    next();
  });
} else {
  const morgan = require('morgan');
  app.use(morgan('dev'));
}

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const corsOrigin = process.env.CORS_ORIGIN || (IS_DEV ? 'http://localhost:3000' : undefined);
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin, credentials: true }));

// ============================================================================
// CSRF DEFENSE-IN-DEPTH: Origin/Referer check for state-changing requests
// Applies to /api/admin/* and /api/setup/* (POST/PUT/PATCH/DELETE).
// ============================================================================
const APP_URL = process.env.APP_URL || process.env.CORS_ORIGIN || (IS_DEV ? 'http://localhost:3000' : '');
function getExpectedOrigin() {
  if (!APP_URL || APP_URL === '*') return null;
  try {
    const u = new URL(APP_URL);
    return u.origin;
  } catch {
    return null;
  }
}
const expectedOrigin = getExpectedOrigin();

function csrfOriginRefererCheck(req, res, next) {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
  const path = req.path || '';
  const isProtected = path.startsWith('/api/admin/') || path.startsWith('/api/setup/');
  if (!isProtected) return next();
  if (!expectedOrigin) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  let allowed = false;
  if (origin) {
    allowed = (origin === expectedOrigin);
  } else if (referer) {
    try {
      const refUrl = new URL(referer);
      const expUrl = new URL(expectedOrigin);
      allowed = (refUrl.origin === expUrl.origin);
    } catch {
      allowed = false;
    }
  }
  if (!allowed) {
    return res.status(403).json({ error: 'Invalid request origin' });
  }
  next();
}
app.use(csrfOriginRefererCheck);

// ============================================================================
// DATABASE CONNECTION
// ============================================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '5000', 10),
});

pool.on('error', (err) => console.error('Database pool error:', err.message));

// Safe SQL quoting for DDL (identifiers and literals can't use $1 params)
function quoteIdent(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
function quoteLiteral(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

// ============================================================================
// AUTO-INIT: Migrations + Admin Seed (idempotent, runs on every startup)
// ============================================================================

let dbReady = false;

async function autoInit() {
  const MAX_RETRIES = 15;
  const RETRY_DELAY_MS = 2000;

  // 1. Wait for DB
  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('DB connection OK');
      break;
    } catch (err) {
      if (i === MAX_RETRIES) {
        console.error('FATAL: Could not connect to database after retries');
        process.exit(1);
      }
      console.log(`DB not ready (attempt ${i}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  // 2. Run migrations (node-pg-migrate)
  try {
    const { runner } = require('node-pg-migrate');
    const applied = await runner({
      databaseUrl: process.env.DATABASE_URL,
      dir: require('path').join(__dirname, 'migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      log: () => {},
    });
    if (applied.length > 0) {
      console.log(`Migrations applied: ${applied.map(m => m.name).join(', ')}`);
    } else {
      console.log('Migrations: up to date');
    }
  } catch (err) {
    console.error('FATAL: Migration failed:', err.message);
    process.exit(1);
  }

  // 3. Seed admin user from env ONLY when both ADMIN_EMAIL and ADMIN_PASSWORD are explicitly set.
  // Otherwise, first admin must be created via GET /setup → POST /api/setup/initial-admin.
  const adminEmailEnv = process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL.trim();
  const adminPasswordEnv = process.env.ADMIN_PASSWORD;
  let userId = null;
  if (adminEmailEnv && adminPasswordEnv) {
    const adminEmail = adminEmailEnv.toLowerCase().trim();
    try {
      const existing = await pool.query('SELECT id FROM app_users WHERE email = $1', [adminEmail]);
      if (existing.rows.length === 0) {
        const passwordHash = await bcrypt.hash(adminPasswordEnv, BCRYPT_ROUNDS);
        const result = await pool.query(
          `INSERT INTO app_users (email, password_hash, is_active) VALUES ($1, $2, true) RETURNING id`,
          [adminEmail, passwordHash]
        );
        userId = result.rows[0].id;
        console.log(`Admin user created from env: ${adminEmail}`);
      } else {
        userId = existing.rows[0].id;
        console.log(`Admin user exists: ${adminEmail}`);
      }
    } catch (err) {
      console.error('Admin seed error:', err.message);
    }
  } else {
    console.log('Admin seed skipped (ADMIN_EMAIL/ADMIN_PASSWORD not both set). Use /setup to create initial admin.');
  }

  // Ensure full RBAC chain: roles → permissions → groups (idempotent; required for setup flow too)
  const roles = [
      { key: 'admin', name: 'Administrator' },
      { key: 'analyst', name: 'Analyst' },
      { key: 'viewer', name: 'Viewer' },
    ];
    const perms = [
      { key: 'admin:users', description: 'Manage users' },
      { key: 'admin:roles', description: 'Manage roles and permissions' },
      { key: 'admin:groups', description: 'Manage groups' },
      { key: 'read:workflows', description: 'Read workflows' },
      { key: 'read:executions', description: 'Read executions' },
      { key: 'read:nodes', description: 'Read execution nodes' },
      { key: 'export:data', description: 'Export data' },
      // Metrics permissions
      { key: 'metrics.read.version', description: 'Read n8n version information only' },
      { key: 'metrics.read.full', description: 'Read all instance metrics' },
      { key: 'metrics.manage', description: 'Manage metrics access and configuration' },
    ];
    // role key → permission keys
    const rolePerm = {
      admin: ['admin:users', 'admin:roles', 'admin:groups', 'read:workflows', 'read:executions', 'read:nodes', 'export:data', 'metrics.read.version', 'metrics.read.full', 'metrics.manage'],
      analyst: ['read:workflows', 'read:executions', 'read:nodes', 'export:data', 'metrics.read.version', 'metrics.read.full'],
      viewer: ['read:workflows', 'read:executions', 'read:nodes', 'metrics.read.version'],
    };
    const groups = [
      { name: 'Admins', description: 'Full access including user and group management.', roleKey: 'admin' },
      { name: 'Admin', description: 'Full access including user and group management.', roleKey: 'admin' },
      { name: 'Analyst', description: 'Viewer permissions plus data export capabilities.', roleKey: 'analyst' },
      { name: 'Viewer', description: 'Basic read-only access to dashboards and data.', roleKey: 'viewer' },
    ];

    // Create roles
    for (const r of roles) {
      await pool.query(`INSERT INTO roles (key, name) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [r.key, r.name]);
    }
    // Create permissions
    for (const p of perms) {
      await pool.query(`INSERT INTO permissions (key, description) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`, [p.key, p.description]);
    }
    // Link role → permissions
    for (const [rKey, pKeys] of Object.entries(rolePerm)) {
      const roleRow = await pool.query(`SELECT id FROM roles WHERE key = $1`, [rKey]);
      if (roleRow.rows.length === 0) continue;
      const roleId = roleRow.rows[0].id;
      for (const pKey of pKeys) {
        const permRow = await pool.query(`SELECT id FROM permissions WHERE key = $1`, [pKey]);
        if (permRow.rows.length === 0) continue;
        await pool.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [roleId, permRow.rows[0].id]);
      }
    }
    // Create groups and link to roles
    for (const g of groups) {
      await pool.query(`INSERT INTO groups (name, description) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description`, [g.name, g.description]);
      const grpRow = await pool.query(`SELECT id FROM groups WHERE name = $1`, [g.name]);
      const roleRow = await pool.query(`SELECT id FROM roles WHERE key = $1`, [g.roleKey]);
      if (grpRow.rows.length > 0 && roleRow.rows.length > 0) {
        await pool.query(`INSERT INTO group_roles (group_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [grpRow.rows[0].id, roleRow.rows[0].id]);
      }
    }

  // Add admin user to Admins group only when created from env
  if (userId != null) {
    const adminsGrp = await pool.query(`SELECT id FROM groups WHERE name = 'Admins'`);
    if (adminsGrp.rows.length > 0) {
      await pool.query(`INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, adminsGrp.rows[0].id]);
    }
  }

  dbReady = true;
  if (adminEmailEnv && adminPasswordEnv) {
    console.log(`Ready: admin from env (${String(adminEmailEnv).replace(/./g, '*')})`);
  } else {
    console.log('Ready: no admin from env; use /setup to create initial admin.');
  }

  // 4. Provision least-privilege ingest user for n8n (idempotent)
  const ingestUser = process.env.PULSE_INGEST_USER;
  const ingestPass = process.env.PULSE_INGEST_PASSWORD;
  if (ingestUser && ingestPass) {
    try {
      // Validate ingest username (alphanumeric + underscore only, max 63 chars)
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(ingestUser)) {
        throw new Error('Invalid PULSE_INGEST_USER: must be alphanumeric/underscore, start with letter/underscore, max 63 chars');
      }

      const dbOwner = process.env.DATABASE_URL.match(/\/\/([^:]+):/)?.[1] || 'n8n_pulse';
      // Tables the ingest user can access (SELECT, INSERT, UPDATE - no DELETE)
      const allowedTables = ['executions', 'execution_nodes', 'workflows_index', 'n8n_metrics_snapshot'];
      // Protected tables - auth/RBAC/audit (explicit revoke for defense in depth)
      const protectedTables = [
        'app_users', 'user_password_tokens', 'audit_log',
        'groups', 'roles', 'permissions', 'user_groups', 'group_roles',
        'group_scopes', 'role_permissions', 'user_scopes', 'pgmigrations'
      ];

      // Create role if not exists (Postgres has no CREATE ROLE IF NOT EXISTS)
      const roleExists = await pool.query(
        `SELECT 1 FROM pg_roles WHERE rolname = $1`, [ingestUser]
      );
      if (roleExists.rows.length === 0) {
        await pool.query(`CREATE ROLE ${quoteIdent(ingestUser)} LOGIN`);
      }
      // Always reset password (idempotent)
      await pool.query(`ALTER ROLE ${quoteIdent(ingestUser)} WITH LOGIN PASSWORD ${quoteLiteral(ingestPass)}`);

      // ========================================================================
      // REVOKE: Start with clean slate (tables + sequences)
      // ========================================================================
      await pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${quoteIdent(ingestUser)}`);
      await pool.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${quoteIdent(ingestUser)}`);
      await pool.query(`REVOKE ALL ON SCHEMA public FROM ${quoteIdent(ingestUser)}`);

      // ========================================================================
      // GRANT: Schema usage (required to see tables/sequences)
      // ========================================================================
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(ingestUser)}`);

      // ========================================================================
      // GRANT: SELECT, INSERT, UPDATE on allowed tables only (no DELETE)
      // ========================================================================
      for (const table of allowedTables) {
        await pool.query(`GRANT SELECT, INSERT, UPDATE ON ${quoteIdent(table)} TO ${quoteIdent(ingestUser)}`);
      }

      // ========================================================================
      // GRANT: Sequence permissions for SERIAL/BIGSERIAL columns
      // Required for INSERT to work with auto-increment primary keys
      // Dynamically finds all sequences owned by the table
      // ========================================================================
      const grantedSequences = [];
      for (const table of allowedTables) {
        try {
          // Find all sequences associated with this table (any column, not just 'id')
          const seqResult = await pool.query(
            `SELECT c.relname AS seq_name
             FROM pg_class c
             JOIN pg_depend d ON d.objid = c.oid
             JOIN pg_class t ON t.oid = d.refobjid
             WHERE c.relkind = 'S'
               AND t.relname = $1
               AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')`,
            [table]
          );
          
          for (const row of seqResult.rows) {
            if (row.seq_name) {
              // Grant USAGE (for nextval) and SELECT (for currval) on the sequence
              await pool.query(`GRANT USAGE, SELECT ON SEQUENCE public.${quoteIdent(row.seq_name)} TO ${quoteIdent(ingestUser)}`);
              grantedSequences.push(`public.${row.seq_name}`);
            }
          }
        } catch (seqErr) {
          // Log at debug level - not all tables have sequences
          if (IS_DEV) console.log(`No sequences for ${table}: ${seqErr.message}`);
        }
      }

      // ========================================================================
      // REVOKE: Explicitly revoke on protected tables (defense in depth)
      // ========================================================================
      for (const table of protectedTables) {
        await pool.query(`REVOKE ALL ON ${quoteIdent(table)} FROM ${quoteIdent(ingestUser)}`);
      }

      // ========================================================================
      // DEFAULT PRIVILEGES: Ensure future objects don't auto-grant to ingest user
      // This prevents migrations from accidentally giving access to new tables
      // ========================================================================
      await pool.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(dbOwner)} IN SCHEMA public REVOKE ALL ON TABLES FROM ${quoteIdent(ingestUser)}`);
      await pool.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(dbOwner)} IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${quoteIdent(ingestUser)}`);

      console.log(`Ingest user '${ingestUser}': SELECT/INSERT/UPDATE on [${allowedTables.join(', ')}]`);
      if (grantedSequences.length > 0) {
        console.log(`Ingest user '${ingestUser}': USAGE/SELECT on sequences [${grantedSequences.join(', ')}]`);
      }
      console.log(`Ingest user '${ingestUser}': No access to auth/RBAC/audit tables`);
    } catch (err) {
      console.error(`Ingest user setup error: ${err.message}`);
    }
  }
}

// ============================================================================
// AUDIT LOGGING (client IP + mode)
// ============================================================================

const AUDIT_IP_MAX_LEN = 45; // IPv6 max
const TRUST_PROXY_ENABLED = TRUST_PROXY !== '0' && TRUST_PROXY !== 'false';

/** Check if string looks like a public (non-private) IP for X-Forwarded-For preference. */
function isPublicIp(s) {
  if (!s || typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (/^127\.|^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^::1$|^fc00:|^fe80:/i.test(trimmed)) return false;
  return /^[\da-f.:\[\]]+$/i.test(trimmed);
}

/** Strip port from IP string: [addr]:port or ipv4:port only, so IPv6 like 2001:db8::1 is unchanged. */
function stripPort(part) {
  if (/\]:\d+$/.test(part)) return part.replace(/\]:\d+$/, ']');
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(part)) return part.replace(/:\d+$/, '');
  return part;
}

/** Parse Forwarded header (RFC 7239); return first valid for= value or null. */
function parseForwardedFor(header) {
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/\bfor=([^;,\s]+)/i);
  if (!match) return null;
  let v = match[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  v = stripPort(v).trim();
  if (v.length > 0 && v.length <= AUDIT_IP_MAX_LEN && /^[\da-f.:\[\]]+$/i.test(v)) return v;
  return null;
}

/** Parse X-Forwarded-For: left-most public IP if any, else left-most. */
function parseXForwardedFor(header) {
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(',').map(s => stripPort(s.trim()));
  let firstPublic = null;
  for (const p of parts) {
    if (p.length > 0 && p.length <= AUDIT_IP_MAX_LEN && /^[\da-f.:\[\]]+$/i.test(p)) {
      if (!firstPublic) firstPublic = p;
      if (isPublicIp(p)) return p;
    }
  }
  return firstPublic;
}

/** Sanitize IP string: strip port, brackets (keep content), reject invalid, max length. */
function sanitizeIp(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  let s = raw.trim().replace(/,/g, '');
  const portMatch = s.match(/^(.+):(\d+)$/);
  if (portMatch && !portMatch[1].includes('.')) s = portMatch[1];
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (s.length > AUDIT_IP_MAX_LEN) s = s.slice(0, AUDIT_IP_MAX_LEN);
  if (s.length === 0 || !/^[\da-f.:]+$/i.test(s)) return null;
  return s;
}

/**
 * Get client IP from request. When TRUST_PROXY is enabled: use Forwarded for=, then X-Forwarded-For (left-most public if any, else left-most), then X-Real-IP, then req.ip/req.ips.
 * When TRUST_PROXY is disabled: use only req.ip or connection.remoteAddress (do not trust headers).
 * Sanitized: single IP, no port, max length.
 */
function getClientIp(req) {
  let raw = null;
  if (TRUST_PROXY_ENABLED) {
    raw = parseForwardedFor(req.get('forwarded'));
    if (!raw) raw = parseXForwardedFor(req.get('x-forwarded-for'));
    if (!raw && req.get('x-real-ip')) raw = sanitizeIp(req.get('x-real-ip'));
    if (!raw && req.ip) raw = sanitizeIp(req.ip);
    if (!raw && req.ips && req.ips.length > 0) raw = sanitizeIp(req.ips[0]);
  }
  if (!raw) raw = sanitizeIp(req.ip || req.connection?.remoteAddress || '');
  return raw ? sanitizeIp(raw) : null;
}

/** Return IP string for audit log per AUDIT_LOG_IP_MODE: none → null, raw → sanitized IP, hashed → SHA-256(ip + salt). */
function getAuditIp(req) {
  if (AUDIT_LOG_IP_MODE === 'none') return null;
  const clientIp = getClientIp(req);
  if (!clientIp) return null;
  if (AUDIT_LOG_IP_MODE === 'hashed') {
    return crypto.createHash('sha256').update(clientIp + AUDIT_LOG_IP_SALT).digest('hex');
  }
  return clientIp;
}

async function logAudit(action, { actorUserId = null, targetType = null, targetId = null, metadata = {}, ip = null, userAgent = null, instanceId = null } = {}) {
  try {
    // Never log sensitive data
    const safeMetadata = { ...metadata };
    delete safeMetadata.password;
    delete safeMetadata.token;
    delete safeMetadata.secret;
    
    await pool.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata, ip, user_agent, instance_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [actorUserId, action, targetType, targetId, JSON.stringify(safeMetadata), ip, userAgent, instanceId]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

function getAuditContext(req) {
  return {
    actorUserId: req.user?.sub || null,
    ip: getAuditIp(req),
    userAgent: req.get('user-agent')?.substring(0, 500) || null,
  };
}

// ============================================================================
// RETENTION CLEANUP JOB
// ============================================================================

let retentionJobRunning = false;
let lastRetentionResult = null;

/**
 * Extended retention cleanup - deletes old data from:
 * 1. executions (finished only, older than cutoff)
 * 2. execution_nodes (cascaded or by FK)
 * 3. workflows_index (orphans only - not referenced by any execution)
 * 4. n8n_metrics_snapshot (older than cutoff)
 * 5. audit_log (older than cutoff)
 * 
 * NEVER deletes from: app_users, groups, roles, permissions, or any RBAC tables
 */
async function runRetentionCleanup() {
  if (!RETENTION_ENABLED || RETENTION_DAYS <= 0) {
    return { ok: false, error: 'Retention not enabled' };
  }
  if (retentionJobRunning) {
    console.log('Retention: Skipping - previous job still running');
    return { ok: false, error: 'Previous job still running' };
  }

  const client = await pool.connect();
  const deleted = {
    executions: 0,
    execution_nodes: 0,
    workflows_index: 0,
    n8n_metrics_snapshot: 0,
    audit_log: 0
  };

  try {
    // Acquire advisory lock to prevent concurrent runs across instances
    const lockResult = await client.query('SELECT pg_try_advisory_lock(12345) AS acquired');
    if (!lockResult.rows[0].acquired) {
      console.log('Retention: Skipping - another instance is running cleanup');
      return { ok: false, error: 'Another instance is running cleanup' };
    }

    retentionJobRunning = true;
    const startTime = Date.now();
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    console.log(`Retention: Starting cleanup (cutoff: ${cutoffDate})`);

    // -------------------------------------------------------------------------
    // 1. DELETE EXECUTIONS (finished only, older than cutoff)
    // Uses stopped_at for finished executions, falls back to inserted_at
    // -------------------------------------------------------------------------
    let batchDeleted;
    do {
      const result = await client.query(
        `WITH to_delete AS (
           SELECT instance_id, execution_id
           FROM executions
           WHERE finished = true
             AND COALESCE(stopped_at, inserted_at) < $1
           LIMIT $2
         )
         DELETE FROM executions
         WHERE (instance_id, execution_id) IN (
           SELECT instance_id, execution_id FROM to_delete
         )
         RETURNING 1`,
        [cutoffDate, RETENTION_BATCH_SIZE]
      );
      batchDeleted = result.rowCount;
      deleted.executions += batchDeleted;
      if (batchDeleted > 0) await new Promise(r => setTimeout(r, 50));
    } while (batchDeleted === RETENTION_BATCH_SIZE);
    console.log(`Retention: Deleted ${deleted.executions} executions`);

    // -------------------------------------------------------------------------
    // 2. DELETE ORPHAN EXECUTION_NODES (if FK cascade didn't clean them)
    // Delete nodes whose parent execution no longer exists
    // -------------------------------------------------------------------------
    do {
      const result = await client.query(
        `WITH orphan_nodes AS (
           SELECT en.instance_id, en.execution_id, en.node_name, en.run_index
           FROM execution_nodes en
           LEFT JOIN executions e ON e.instance_id = en.instance_id AND e.execution_id = en.execution_id
           WHERE e.execution_id IS NULL
           LIMIT $1
         )
         DELETE FROM execution_nodes
         WHERE (instance_id, execution_id, node_name, run_index) IN (
           SELECT instance_id, execution_id, node_name, run_index FROM orphan_nodes
         )
         RETURNING 1`,
        [RETENTION_BATCH_SIZE]
      );
      batchDeleted = result.rowCount;
      deleted.execution_nodes += batchDeleted;
      if (batchDeleted > 0) await new Promise(r => setTimeout(r, 50));
    } while (batchDeleted === RETENTION_BATCH_SIZE);
    console.log(`Retention: Deleted ${deleted.execution_nodes} orphan execution_nodes`);

    // -------------------------------------------------------------------------
    // 3. DELETE ORPHAN WORKFLOWS_INDEX
    // Only delete workflows that are:
    // - Older than cutoff (by updated_at or created_at)
    // - NOT referenced by any remaining executions
    // -------------------------------------------------------------------------
    do {
      const result = await client.query(
        `WITH orphan_workflows AS (
           SELECT w.workflow_id
           FROM workflows_index w
           LEFT JOIN executions e ON e.workflow_id = w.workflow_id
           WHERE e.workflow_id IS NULL
             AND COALESCE(w.updated_at, w.created_at, w.distinct_inserted_at) < $1
           LIMIT $2
         )
         DELETE FROM workflows_index
         WHERE workflow_id IN (SELECT workflow_id FROM orphan_workflows)
         RETURNING 1`,
        [cutoffDate, RETENTION_BATCH_SIZE]
      );
      batchDeleted = result.rowCount;
      deleted.workflows_index += batchDeleted;
      if (batchDeleted > 0) await new Promise(r => setTimeout(r, 50));
    } while (batchDeleted === RETENTION_BATCH_SIZE);
    console.log(`Retention: Deleted ${deleted.workflows_index} orphan workflows`);

    // -------------------------------------------------------------------------
    // 4. DELETE N8N_METRICS_SNAPSHOT (older than cutoff by ts or inserted_at)
    // -------------------------------------------------------------------------
    do {
      const result = await client.query(
        `WITH to_delete AS (
           SELECT id FROM n8n_metrics_snapshot
           WHERE COALESCE(ts, inserted_at) < $1
           LIMIT $2
         )
         DELETE FROM n8n_metrics_snapshot
         WHERE id IN (SELECT id FROM to_delete)
         RETURNING 1`,
        [cutoffDate, RETENTION_BATCH_SIZE]
      );
      batchDeleted = result.rowCount;
      deleted.n8n_metrics_snapshot += batchDeleted;
      if (batchDeleted > 0) await new Promise(r => setTimeout(r, 50));
    } while (batchDeleted === RETENTION_BATCH_SIZE);
    console.log(`Retention: Deleted ${deleted.n8n_metrics_snapshot} metrics snapshots`);

    // -------------------------------------------------------------------------
    // 5. DELETE AUDIT_LOG (older than cutoff by created_at)
    // -------------------------------------------------------------------------
    do {
      const result = await client.query(
        `WITH to_delete AS (
           SELECT id FROM audit_log
           WHERE created_at < $1
           LIMIT $2
         )
         DELETE FROM audit_log
         WHERE id IN (SELECT id FROM to_delete)
         RETURNING 1`,
        [cutoffDate, RETENTION_BATCH_SIZE]
      );
      batchDeleted = result.rowCount;
      deleted.audit_log += batchDeleted;
      if (batchDeleted > 0) await new Promise(r => setTimeout(r, 50));
    } while (batchDeleted === RETENTION_BATCH_SIZE);
    console.log(`Retention: Deleted ${deleted.audit_log} audit log entries`);

    // -------------------------------------------------------------------------
    // FINALIZE
    // -------------------------------------------------------------------------
    const durationMs = Date.now() - startTime;
    const durationSec = (durationMs / 1000).toFixed(2);
    console.log(`Retention: Completed in ${durationSec}s`);
    console.log(`Retention: Summary - executions:${deleted.executions}, nodes:${deleted.execution_nodes}, workflows:${deleted.workflows_index}, metrics:${deleted.n8n_metrics_snapshot}, audit:${deleted.audit_log}`);

    // Log audit event (this creates a new audit entry after cleanup)
    await logAudit('retention_cleanup', {
      metadata: {
        cutoff_date: cutoffDate,
        deleted,
        duration_ms: durationMs
      }
    });

    lastRetentionResult = {
      ok: true,
      cutoff: cutoffDate,
      deleted,
      durationMs
    };

    return lastRetentionResult;

  } catch (err) {
    console.error('Retention: Error during cleanup:', err.message);
    return { ok: false, error: err.message };
  } finally {
    await client.query('SELECT pg_advisory_unlock(12345)');
    client.release();
    retentionJobRunning = false;
  }
}

// Schedule retention job (runs according to server/container time, no TZ config)
if (RETENTION_ENABLED && RETENTION_DAYS > 0) {
  const [hour, minute] = RETENTION_RUN_AT.split(':').map(Number);
  const cronExpr = `${minute} ${hour} * * *`;
  
  cron.schedule(cronExpr, runRetentionCleanup);
  console.log(`Retention: Scheduled daily at ${RETENTION_RUN_AT} server time (keep ${RETENTION_DAYS} days)`);
}

// ============================================================================
// RATE LIMITING
// ============================================================================

function getStableIp(req) {
  let ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const portMatch = ip.match(/^(.+):(\d+)$/);
  if (portMatch && !ip.includes('::')) ip = portMatch[1];
  return ip;
}

function createRateLimiter(windowMs, max) {
  return rateLimit({
    windowMs, max, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => getStableIp(req),
    handler: (req, res, next, options) => {
      res.set('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil(options.windowMs / 1000) });
    },
  });
}

const authLimiter = createRateLimiter(60 * 1000, 20);
const sensitiveAuthLimiter = createRateLimiter(15 * 60 * 1000, 5);
const adminCreateLimiter = createRateLimiter(60 * 1000, 10);
const setupLimiter = createRateLimiter(15 * 60 * 1000, 5); // same as sensitive auth
const metricsLimiter = createRateLimiter(60 * 1000, 60);

// Strict login limiter: 5 attempts per 15 minutes per IP (brute-force protection)
const loginLimiter = createRateLimiter(15 * 60 * 1000, 5);

// Admin API rate limiter: 100 requests per minute per IP
const adminApiLimiter = createRateLimiter(60 * 1000, 100);

// ============================================================================
// TOKEN HELPERS
// ============================================================================

function generateSecureToken() { return crypto.randomBytes(32).toString('hex'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function getBaseUrl() { return process.env.APP_URL || process.env.CORS_ORIGIN || 'http://localhost:3000'; }
function signToken(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY }); }

function setAuthCookie(res, token) {
  const opts = { httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, path: '/', maxAge: 30 * 60 * 1000 };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  res.cookie(TOKEN_COOKIE, token, opts);
}

function clearAuthCookie(res) {
  const opts = { path: '/', httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  res.clearCookie(TOKEN_COOKIE, opts);
}

// ============================================================================
// USER HELPERS
// ============================================================================

async function getUserPermissions(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT p.key AS permission FROM app_users u
     LEFT JOIN user_groups ug ON ug.user_id = u.id
     LEFT JOIN group_roles gr ON gr.group_id = ug.group_id
     LEFT JOIN role_permissions rp ON rp.role_id = gr.role_id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = $1 AND u.is_active = true`, [userId]
  );
  return rows.map(r => r.permission).filter(Boolean);
}

async function getUserScope(userId) {
  const { rows } = await pool.query(
    `SELECT gs.instance_id, gs.workflow_id, gs.tag FROM app_users u
     LEFT JOIN user_groups ug ON ug.user_id = u.id
     LEFT JOIN group_scopes gs ON gs.group_id = ug.group_id
     WHERE u.id = $1 AND u.is_active = true`, [userId]
  );
  return {
    instanceIds: [...new Set(rows.map(r => r.instance_id).filter(Boolean))],
    workflowIds: [...new Set(rows.map(r => r.workflow_id).filter(Boolean))],
    tags: [...new Set(rows.map(r => r.tag).filter(Boolean))],
    hasAnyScopeRows: rows.some(r => r.instance_id || r.workflow_id || r.tag),
  };
}

async function getUserTokenVersion(userId) {
  const { rows } = await pool.query(`SELECT token_version FROM app_users WHERE id = $1`, [userId]);
  return rows[0]?.token_version ?? 0;
}

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================

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
      return res.status(401).json({ error: err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid session' });
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
  return (req.permissions || []).some(p => p === 'admin:users' || p === 'admin:roles');
}

// ============================================================================
// ANTI-LOCKOUT HELPERS
// ============================================================================

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
     JOIN permissions p ON p.id = rp.permission_id WHERE u.id = $1 AND u.is_active = true AND p.key = 'admin:users') AS ok`, [userId]
  );
  return Boolean(rows[0]?.ok);
}

async function groupIdsGrantAdmin(groupIds) {
  if (!groupIds?.length) return false;
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM group_roles gr JOIN role_permissions rp ON rp.role_id = gr.role_id
     JOIN permissions p ON p.id = rp.permission_id WHERE gr.group_id = ANY($1::uuid[]) AND p.key = 'admin:users') AS ok`, [groupIds]
  );
  return Boolean(rows[0]?.ok);
}

// ============================================================================
// PASSWORD TOKEN HELPERS
// ============================================================================

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

// ============================================================================
// SCOPE WHERE BUILDER
// ============================================================================

function buildScopeWhere({ instanceCol, workflowCol, tagsCol, tagsMode }) {
  return ({ scope, paramsStartIndex = 1 }) => {
    const where = [], params = [];
    let i = paramsStartIndex;
    if (scope?.instanceIds?.length) { where.push(`${instanceCol} = ANY($${i++}::text[])`); params.push(scope.instanceIds); }
    if (scope?.workflowIds?.length) { where.push(`${workflowCol} = ANY($${i++}::text[])`); params.push(scope.workflowIds); }
    if (tagsCol && scope?.tags?.length) { where.push(tagsMode === 'text_array' ? `${tagsCol} && $${i++}::text[]` : `${tagsCol} = ANY($${i++}::text[])`); params.push(scope.tags); }
    return { where, params, nextIndex: i };
  };
}

// ============================================================================
// ROUTES: HEALTH
// ============================================================================

app.get('/health', async (req, res) => {
  if (!dbReady) return res.status(503).json({ ok: false, db: 'initializing' });
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'connected' }); }
  catch { res.status(503).json({ ok: false, db: 'disconnected' }); }
});

app.get('/ready', async (req, res) => {
  if (!dbReady) return res.status(503).json({ ready: false });
  try { await pool.query('SELECT 1'); res.json({ ready: true }); }
  catch { res.status(503).json({ ready: false }); }
});

if (DEBUG_IP) {
  app.get('/api/debug/ip', (req, res) => res.json({ ip: req.ip, stableIp: getStableIp(req), xForwardedFor: req.headers['x-forwarded-for'] || null }));
}

// ============================================================================
// ROUTES: SETUP (first-run initial admin)
// setupRequired = true only when zero users exist. After first admin created, setup is disabled.
// ============================================================================
app.get('/api/setup/status', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Service initializing', setupRequired: false });
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM app_users', []);
    const count = rows[0]?.c ?? 0;
    res.json({ setupRequired: count === 0 });
  } catch (err) {
    console.error('Setup status error:', err.message);
    res.status(500).json({ error: 'Internal error', setupRequired: false });
  }
});

const WEAK_PASSWORDS = new Set(['password', 'password123', 'admin', '12345678', '1234567890', 'qwerty', 'letmein', 'welcome', 'monkey', 'abc123', 'admin123', 'changeme', 'secret']);
function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.trim().length <= 255;
}
function isPasswordStrongEnough(pwd) {
  if (typeof pwd !== 'string' || pwd.length < 8) return false;
  if (WEAK_PASSWORDS.has(pwd.toLowerCase())) return false;
  return true;
}

app.post('/api/setup/initial-admin', setupLimiter, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Service initializing' });
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
  if (!isPasswordStrongEnough(password)) return res.status(400).json({ error: 'Password must be at least 8 characters and not a common weak password' });

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
        `INSERT INTO app_users (email, password_hash, is_active, token_version) VALUES ($1, $2, true, 0) RETURNING id`,
        [cleanEmail, passwordHash]
      );
      const userId = ins.rows[0].id;
      const adminsGrp = await client.query(`SELECT id FROM groups WHERE name = 'Admins'`);
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

// ============================================================================
// ROUTES: AUTH
// ============================================================================

app.post('/api/auth/login', loginLimiter, async (req, res) => {
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

app.post('/api/auth/logout', (req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`SELECT id, email, is_active FROM app_users WHERE id = $1`, [req.user.sub]);
  if (!rows[0]) return res.status(401).json({ error: 'Not authenticated' });
  const permissions = await getUserPermissions(rows[0].id);
  res.json({ user: { id: rows[0].id, email: rows[0].email }, permissions });
});

app.post('/api/auth/forgot-password', sensitiveAuthLimiter, async (req, res) => {
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

app.post('/api/auth/set-password', sensitiveAuthLimiter, async (req, res) => {
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

app.post('/api/auth/reset-password', sensitiveAuthLimiter, async (req, res) => {
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

app.post('/api/auth/validate-token', async (req, res) => {
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
// ROUTES: DATA
// ============================================================================

const makeDataWhereWorkflows = buildScopeWhere({ instanceCol: 'instance_id', workflowCol: 'workflow_id', tagsCol: 'tags', tagsMode: 'text' });
const makeDataWhereExecutions = buildScopeWhere({ instanceCol: 'instance_id', workflowCol: 'workflow_id', tagsCol: null });
const makeDataWhereNodes = buildScopeWhere({ instanceCol: 'instance_id', workflowCol: 'workflow_id', tagsCol: null });

app.get('/api/workflows', requireAuth, attachScope, requirePermission('read:workflows'), async (req, res) => {
  if (!isAdminRequest(req) && !req.scope?.hasAnyScopeRows) return res.json([]);
  const limit = Math.min(Number(req.query.limit || 1000), 5000);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const { where, params, nextIndex } = makeDataWhereWorkflows({ scope: req.scope, paramsStartIndex: 1 });
  params.push(limit, offset);
  const sql = `SELECT instance_id, workflow_id, name, active, is_archived, updated_at, tags, nodes_count FROM workflows_index ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC NULLS LAST LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`;
  res.json((await pool.query(sql, params)).rows);
});

app.get('/api/executions', requireAuth, attachScope, requirePermission('read:executions'), async (req, res) => {
  if (!isAdminRequest(req) && !req.scope?.hasAnyScopeRows) return res.json([]);
  const limit = Math.min(Number(req.query.limit || 500), 5000);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const { where, params, nextIndex } = makeDataWhereExecutions({ scope: req.scope, paramsStartIndex: 1 });
  params.push(limit, offset);
  const sql = `SELECT instance_id, execution_id, workflow_id, status, finished, mode, started_at, stopped_at, duration_ms, nodes_count, last_node_executed FROM executions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY started_at DESC LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`;
  res.json((await pool.query(sql, params)).rows);
});

app.get('/api/execution-nodes', requireAuth, attachScope, requirePermission('read:nodes'), async (req, res) => {
  if (!isAdminRequest(req) && !req.scope?.hasAnyScopeRows) return res.json([]);
  const executionId = req.query.execution_id || null;
  const where = [], params = [];
  let i = 1;
  if (executionId) { where.push(`execution_id = $${i++}`); params.push(String(executionId)); }
  const { where: scopeWhere, params: scopeParams, nextIndex } = makeDataWhereNodes({ scope: req.scope, paramsStartIndex: i });
  where.push(...scopeWhere); params.push(...scopeParams);
  const limit = Math.min(Number(req.query.limit || 50000), 200000);
  params.push(limit);
  const sql = `SELECT instance_id, execution_id, workflow_id, node_name, node_type, run_index, runs_count, is_last_run, execution_status, execution_time_ms, start_time_ms, start_time, items_out_count, items_out_total_all_runs FROM execution_nodes ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${executionId ? 'start_time_ms ASC NULLS LAST, node_name ASC' : 'inserted_at DESC NULLS LAST'} LIMIT $${nextIndex}`;
  res.json((await pool.query(sql, params)).rows);
});

// ============================================================================
// ROUTES: ADMIN (all routes under /api/admin/* are rate limited)
// ============================================================================

// Apply rate limiting to ALL admin routes (100 req/min per IP)
app.use('/api/admin', adminApiLimiter);

// ============================================================================
// ROUTES: ADMIN USERS
// ============================================================================

app.get('/api/admin/users', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 200), 1000);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.is_active, u.created_at, u.password_set_at,
            COALESCE(json_agg(json_build_object('id', g.id, 'name', g.name)) FILTER (WHERE g.id IS NOT NULL), '[]'::json) AS groups
     FROM app_users u LEFT JOIN user_groups ug ON ug.user_id = u.id LEFT JOIN groups g ON g.id = ug.group_id
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]
  );
  res.json(rows);
});

app.post('/api/admin/users', requireAuth, requirePermission('admin:users'), adminCreateLimiter, async (req, res) => {
  const { email, groupIds } = req.body || {};
  const cleanEmail = String(email || '').toLowerCase().trim();
  if (!cleanEmail) return res.status(400).json({ error: 'Email required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Invalid email' });

  const gids = Array.isArray(groupIds) ? groupIds : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (gids.length) {
      const { rowCount } = await client.query(`SELECT id FROM groups WHERE id = ANY($1::uuid[])`, [gids]);
      if (rowCount !== gids.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid groupIds' }); }
    }
    const ins = await client.query(`INSERT INTO app_users (email, password_hash, is_active, token_version) VALUES ($1, '', true, 0) RETURNING id, email, is_active, created_at`, [cleanEmail]);
    const user = ins.rows[0];
    for (const gid of gids) await client.query(`INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [user.id, gid]);
    await client.query('COMMIT');

    const { rawToken, expiresAt } = await createPasswordToken(user.id, 'invite_set_password');
    await logAudit('user_created', { ...getAuditContext(req), targetType: 'user', targetId: user.id, metadata: { email: cleanEmail } });
    res.status(201).json({ ...user, inviteLink: `${getBaseUrl()}/set-password?token=${rawToken}`, inviteLinkExpiresAt: expiresAt });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e?.code === '23505') return res.status(409).json({ error: 'Email exists' });
    throw e;
  } finally { client.release(); }
});

app.post('/api/admin/users/:userId/reset-password-link', requireAuth, requirePermission('admin:users'), adminCreateLimiter, async (req, res) => {
  const { rows } = await pool.query(`SELECT id, email, is_active FROM app_users WHERE id = $1`, [req.params.userId]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  if (!rows[0].is_active) return res.status(400).json({ error: 'User inactive' });

  const { rawToken, expiresAt } = await createPasswordToken(req.params.userId, 'reset_password');
  await logAudit('password_reset_link_generated', { ...getAuditContext(req), targetType: 'user', targetId: req.params.userId });
  res.json({ resetLink: `${getBaseUrl()}/reset-password?token=${rawToken}`, resetLinkExpiresAt: expiresAt, userEmail: rows[0].email });
});

app.post('/api/admin/users/:userId/regenerate-invite', requireAuth, requirePermission('admin:users'), adminCreateLimiter, async (req, res) => {
  const { rows } = await pool.query(`SELECT id, email, is_active, password_set_at, password_hash FROM app_users WHERE id = $1`, [req.params.userId]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  if (!rows[0].is_active) return res.status(400).json({ error: 'User inactive' });
  if (rows[0].password_hash && rows[0].password_set_at) return res.status(400).json({ error: 'Password already set' });

  const { rawToken, expiresAt } = await createPasswordToken(req.params.userId, 'invite_set_password');
  res.json({ inviteLink: `${getBaseUrl()}/set-password?token=${rawToken}`, inviteLinkExpiresAt: expiresAt, userEmail: rows[0].email });
});

app.put('/api/admin/users/:userId/groups', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const groupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds : null;
  if (!groupIds) return res.status(400).json({ error: 'groupIds required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(`SELECT id FROM app_users WHERE id = $1`, [req.params.userId]);
    if (!u.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    if (groupIds.length) {
      const { rowCount } = await client.query(`SELECT id FROM groups WHERE id = ANY($1::uuid[])`, [groupIds]);
      if (rowCount !== groupIds.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid groupIds' }); }
    }
    const wasAdmin = await userIsActiveAdmin(req.params.userId);
    const willBeAdmin = await groupIdsGrantAdmin(groupIds);
    if (wasAdmin && !willBeAdmin && (await countActiveAdmins()) <= 1) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Cannot remove last admin' }); }
    await client.query(`DELETE FROM user_groups WHERE user_id = $1`, [req.params.userId]);
    for (const gid of groupIds) await client.query(`INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.params.userId, gid]);
    await client.query('COMMIT');
    await logAudit('user_groups_changed', { ...getAuditContext(req), targetType: 'user', targetId: req.params.userId, metadata: { groupIds } });
    res.json({ ok: true });
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
});

app.patch('/api/admin/users/:userId', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const { is_active } = req.body || {};
  if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'is_active required' });
  if (!is_active) {
    const targetIsAdmin = await userIsActiveAdmin(req.params.userId);
    if (targetIsAdmin && (await countActiveAdmins()) <= 1) return res.status(409).json({ error: 'Cannot deactivate last admin' });
  }
  const { rows, rowCount } = await pool.query(`UPDATE app_users SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING id, email, is_active`, [req.params.userId, is_active]);
  if (!rowCount) return res.status(404).json({ error: 'User not found' });
  await logAudit(is_active ? 'user_activated' : 'user_deactivated', { ...getAuditContext(req), targetType: 'user', targetId: req.params.userId });
  res.json(rows[0]);
});

app.delete('/api/admin/users/:userId', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const targetIsAdmin = await userIsActiveAdmin(req.params.userId);
  if (targetIsAdmin && (await countActiveAdmins()) <= 1) return res.status(409).json({ error: 'Cannot delete last admin' });
  const r = await pool.query(`DELETE FROM app_users WHERE id = $1`, [req.params.userId]);
  if (!r.rowCount) return res.status(404).json({ error: 'User not found' });
  await logAudit('user_deleted', { ...getAuditContext(req), targetType: 'user', targetId: req.params.userId });
  res.json({ ok: true });
});

// ============================================================================
// ROUTES: ADMIN ROLES & GROUPS
// ============================================================================

app.get('/api/admin/roles', requireAuth, requirePermission('admin:users'), async (req, res) => {
  res.json((await pool.query(`SELECT id, key, name, created_at FROM roles ORDER BY name ASC`)).rows);
});

app.get('/api/admin/roles-with-permissions', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.key, r.name, r.created_at,
            COALESCE(json_agg(json_build_object('id', p.id, 'key', p.key, 'description', p.description)) FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS permissions
     FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id GROUP BY r.id ORDER BY r.name ASC`
  );
  res.json(rows);
});

app.get('/api/admin/groups', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.description, g.created_at,
            COALESCE(json_agg(DISTINCT jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name)) FILTER (WHERE r.id IS NOT NULL), '[]'::json) AS roles,
            COALESCE(json_agg(DISTINCT jsonb_build_object('instance_id', gs.instance_id, 'workflow_id', gs.workflow_id, 'tag', gs.tag)) FILTER (WHERE gs.id IS NOT NULL), '[]'::json) AS scopes
     FROM groups g LEFT JOIN group_roles gr ON gr.group_id = g.id LEFT JOIN roles r ON r.id = gr.role_id LEFT JOIN group_scopes gs ON gs.group_id = g.id GROUP BY g.id ORDER BY g.created_at DESC LIMIT 200`
  );
  res.json(rows);
});

app.post('/api/admin/groups', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const { name, description, roleIds, scope } = req.body || {};
  const cleanName = String(name || '').trim();
  if (!cleanName) return res.status(400).json({ error: 'Name required' });

  const roleIdList = Array.isArray(roleIds) ? roleIds : [];
  const instanceIds = Array.isArray(scope?.instanceIds) ? scope.instanceIds : [];
  const workflowIds = Array.isArray(scope?.workflowIds) ? scope.workflowIds : [];
  const tags = Array.isArray(scope?.tags) ? scope.tags : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (roleIdList.length) {
      const { rowCount } = await client.query(`SELECT id FROM roles WHERE id = ANY($1::uuid[])`, [roleIdList]);
      if (rowCount !== roleIdList.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid roleIds' }); }
    }
    const ins = await client.query(`INSERT INTO groups (name, description) VALUES ($1, $2) RETURNING id, name, description, created_at`, [cleanName, description?.trim() || null]);
    const g = ins.rows[0];
    for (const rid of roleIdList) await client.query(`INSERT INTO group_roles (group_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [g.id, rid]);
    for (const v of instanceIds) await client.query(`INSERT INTO group_scopes (group_id, instance_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [g.id, String(v)]);
    for (const v of workflowIds) await client.query(`INSERT INTO group_scopes (group_id, workflow_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [g.id, String(v)]);
    for (const v of tags) await client.query(`INSERT INTO group_scopes (group_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [g.id, String(v)]);
    await client.query('COMMIT');
    await logAudit('group_created', { ...getAuditContext(req), targetType: 'group', targetId: g.id, metadata: { name: cleanName } });
    res.status(201).json(g);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e?.code === '23505') return res.status(409).json({ error: 'Group name exists' });
    throw e;
  } finally { client.release(); }
});

app.put('/api/admin/groups/:groupId', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const { name, description, roleIds, scope } = req.body || {};
  const cleanName = String(name || '').trim();
  if (!cleanName) return res.status(400).json({ error: 'Name required' });

  const roleIdList = Array.isArray(roleIds) ? roleIds : [];
  const instanceIds = Array.isArray(scope?.instanceIds) ? scope.instanceIds : [];
  const workflowIds = Array.isArray(scope?.workflowIds) ? scope.workflowIds : [];
  const tags = Array.isArray(scope?.tags) ? scope.tags : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const g0 = await client.query(`SELECT id FROM groups WHERE id = $1`, [req.params.groupId]);
    if (!g0.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Group not found' }); }
    if (roleIdList.length) {
      const { rowCount } = await client.query(`SELECT id FROM roles WHERE id = ANY($1::uuid[])`, [roleIdList]);
      if (rowCount !== roleIdList.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid roleIds' }); }
    }
    await client.query(`UPDATE groups SET name = $2, description = $3 WHERE id = $1`, [req.params.groupId, cleanName, description?.trim() || null]);
    await client.query(`DELETE FROM group_roles WHERE group_id = $1`, [req.params.groupId]);
    await client.query(`DELETE FROM group_scopes WHERE group_id = $1`, [req.params.groupId]);
    for (const rid of roleIdList) await client.query(`INSERT INTO group_roles (group_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.params.groupId, rid]);
    for (const v of instanceIds) await client.query(`INSERT INTO group_scopes (group_id, instance_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.params.groupId, String(v)]);
    for (const v of workflowIds) await client.query(`INSERT INTO group_scopes (group_id, workflow_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.params.groupId, String(v)]);
    for (const v of tags) await client.query(`INSERT INTO group_scopes (group_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.params.groupId, String(v)]);
    await client.query('COMMIT');
    await logAudit('group_updated', { ...getAuditContext(req), targetType: 'group', targetId: req.params.groupId });
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
});

app.delete('/api/admin/groups/:groupId', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const r = await pool.query(`DELETE FROM groups WHERE id = $1`, [req.params.groupId]);
  if (!r.rowCount) return res.status(404).json({ error: 'Group not found' });
  await logAudit('group_deleted', { ...getAuditContext(req), targetType: 'group', targetId: req.params.groupId });
  res.json({ ok: true });
});

// ============================================================================
// ROUTES: AUDIT LOG (Admin only)
// ============================================================================

app.get('/api/admin/audit-logs', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const action = req.query.action || null;
  const actorId = req.query.actor_id || null;
  const dateFrom = req.query.date_from || null;
  const dateTo = req.query.date_to || null;

  const where = [];
  const params = [];
  let i = 1;

  if (action) { where.push(`al.action = $${i++}`); params.push(action); }
  if (actorId) { where.push(`al.actor_user_id = $${i++}`); params.push(actorId); }
  if (dateFrom) { where.push(`al.created_at >= $${i++}`); params.push(dateFrom); }
  if (dateTo) { where.push(`al.created_at <= $${i++}`); params.push(dateTo); }

  params.push(limit, offset);
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Safe UUID cast: only attempt join when target_id looks like a valid UUID
  const { rows } = await pool.query(
    `SELECT al.id, al.created_at, al.action, al.target_type, al.target_id, al.ip,
            u.email AS actor_email,
            target_user.email AS target_email
     FROM audit_log al
     LEFT JOIN app_users u ON u.id = al.actor_user_id
     LEFT JOIN app_users target_user ON 
       al.target_type = 'user' 
       AND al.target_id IS NOT NULL 
       AND al.target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND target_user.id = al.target_id::uuid
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    params
  );

  // Get total count for pagination
  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM audit_log al ${whereClause}`, params.slice(0, -2));

  res.json({ logs: rows, total: countResult.rows[0].total, limit, offset });
});

app.get('/api/admin/audit-log-actions', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const { rows } = await pool.query(`SELECT DISTINCT action FROM audit_log ORDER BY action ASC`);
  res.json(rows.map(r => r.action));
});

// ============================================================================
// ROUTES: RETENTION (Manual trigger for admins)
// ============================================================================

app.post('/api/admin/retention/run', requireAuth, requirePermission('admin:users'), async (req, res) => {
  if (!RETENTION_ENABLED) return res.status(400).json({ error: 'Retention not enabled' });
  
  try {
    await logAudit('retention_manual_trigger', getAuditContext(req));
    const result = await runRetentionCleanup();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/retention/status', requireAuth, requirePermission('admin:users'), async (req, res) => {
  res.json({
    enabled: RETENTION_ENABLED,
    retentionDays: RETENTION_DAYS,
    runAt: RETENTION_RUN_AT,
    isRunning: retentionJobRunning,
    lastResult: lastRetentionResult,
  });
});

// ============================================================================
// ROUTES: METRICS (n8n Instance Health)
// ============================================================================

/**
 * Input validation helpers for metrics endpoints
 */
function validateInstanceId(instanceId) {
  if (!instanceId || typeof instanceId !== 'string') return false;
  // Allow alphanumeric, underscores, hyphens, max 100 chars
  return /^[a-zA-Z0-9_-]{1,100}$/.test(instanceId);
}

function validateTimestamp(timestamp) {
  if (!timestamp) return true; // Optional
  const date = new Date(timestamp);
  return !isNaN(date.getTime());
}

function parseAndClampTimeRange(from, to) {
  const now = new Date();
  let fromDate = from ? new Date(from) : new Date(now.getTime() - 24 * 60 * 60 * 1000); // Default: last 24h
  let toDate = to ? new Date(to) : now;
  
  // Ensure dates are valid
  if (isNaN(fromDate.getTime())) fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (isNaN(toDate.getTime())) toDate = now;
  
  // Clamp range to max allowed days
  const maxMs = METRICS_MAX_TIME_RANGE_DAYS * 24 * 60 * 60 * 1000;
  if (toDate - fromDate > maxMs) {
    fromDate = new Date(toDate.getTime() - maxMs);
  }
  
  return { fromDate, toDate };
}

/**
 * Check if user has access to a specific instance_id via scopes
 */
async function userHasInstanceAccess(userId, instanceId, permissions) {
  // Admin with admin:users permission has global access
  if (permissions.includes('admin:users')) return true;
  
  // Check if user has scope for this instance
  const scope = await getUserScope(userId);
  
  // If user has no scope rows, they have no instance access (default-deny)
  if (!scope.hasAnyScopeRows) return false;
  
  // Check if instance_id is in user's allowed instances
  return scope.instanceIds.includes(instanceId);
}

/**
 * Get all instance_ids the user has access to
 */
async function getUserAllowedInstances(userId, permissions) {
  // Admin has global access - return all instances ordered by most recent activity
  if (permissions.includes('admin:users')) {
    const { rows } = await pool.query(
      `SELECT instance_id, MAX(ts) as last_activity
       FROM n8n_metrics_snapshot 
       WHERE instance_id IS NOT NULL 
       GROUP BY instance_id
       ORDER BY last_activity DESC`
    );
    return rows.map(r => r.instance_id);
  }
  
  // Get user's scoped instances
  const scope = await getUserScope(userId);
  return scope.instanceIds;
}

/**
 * GET /api/metrics/config
 * Returns metrics feature configuration (for frontend feature flag)
 */
app.get('/api/metrics/config', requireAuth, async (req, res) => {
  const permissions = await getUserPermissions(req.user.sub);
  res.json({
    enabled: METRICS_ENABLED,
    hasVersionPermission: permissions.includes('metrics.read.version'),
    hasFullPermission: permissions.includes('metrics.read.full'),
    hasManagePermission: permissions.includes('metrics.manage'),
    maxTimeRangeDays: METRICS_MAX_TIME_RANGE_DAYS,
    maxDatapoints: METRICS_MAX_DATAPOINTS,
  });
});

/**
 * GET /api/metrics/instances
 * Returns list of instances the user has access to
 */
app.get('/api/metrics/instances', requireAuth, metricsLimiter, async (req, res) => {
  if (!METRICS_ENABLED) {
    return res.json({ enabled: false, instances: [] });
  }
  
  const permissions = await getUserPermissions(req.user.sub);
  if (!permissions.includes('metrics.read.version') && !permissions.includes('metrics.read.full')) {
    return res.json({ enabled: true, instances: [] });
  }
  
  try {
    const instances = await getUserAllowedInstances(req.user.sub, permissions);
    res.json({ enabled: true, instances });
  } catch (err) {
    console.error('Metrics instances error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/metrics/latest?instance_id=...
 * Returns the latest metrics snapshot for an instance
 * - Admin/Analyst: full metrics
 * - Viewer: only version info
 */
app.get('/api/metrics/latest', requireAuth, metricsLimiter, attachScope, async (req, res) => {
  // Feature flag check
  if (!METRICS_ENABLED) {
    return res.json({ enabled: false });
  }
  
  const instanceId = req.query.instance_id;
  
  // Validate instance_id
  if (!validateInstanceId(instanceId)) {
    await logAudit('metrics_access_denied', { 
      ...getAuditContext(req), 
      metadata: { reason: 'invalid_instance_id', instanceId: String(instanceId).substring(0, 20) } 
    });
    return res.status(400).json({ error: 'Invalid or missing instance_id' });
  }
  
  const permissions = await getUserPermissions(req.user.sub);
  
  // Check permission exists
  const hasVersionPerm = permissions.includes('metrics.read.version');
  const hasFullPerm = permissions.includes('metrics.read.full');
  
  if (!hasVersionPerm && !hasFullPerm) {
    await logAudit('metrics_access_denied', { 
      ...getAuditContext(req), 
      metadata: { reason: 'no_permission', instanceId } 
    });
    return res.status(403).json({ error: 'No metrics permission' });
  }
  
  // Check instance scope (authorization)
  const hasAccess = await userHasInstanceAccess(req.user.sub, instanceId, permissions);
  if (!hasAccess) {
    await logAudit('metrics_access_denied', { 
      ...getAuditContext(req), 
      metadata: { reason: 'no_instance_scope', instanceId } 
    });
    return res.status(403).json({ error: 'No access to this instance' });
  }
  
  try {
    // Select columns based on permission level
    const columns = hasFullPerm
      ? `id, ts, instance_id, n8n_version, node_version, process_start_time_seconds, 
         is_leader, active_workflows, cpu_total_seconds, memory_rss_bytes, 
         heap_used_bytes, external_memory_bytes, eventloop_lag_p99_s, open_fds`
      : `id, ts, instance_id, n8n_version, node_version`; // Viewer: version only
    
    const { rows } = await pool.query(
      `SELECT ${columns} FROM n8n_metrics_snapshot 
       WHERE instance_id = $1 
       ORDER BY ts DESC LIMIT 1`,
      [instanceId]
    );
    
    if (rows.length === 0) {
      return res.json({ enabled: true, data: null });
    }
    
    res.json({ enabled: true, data: rows[0], permissionLevel: hasFullPerm ? 'full' : 'version' });
  } catch (err) {
    console.error('Metrics latest error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/metrics/timeseries?instance_id=...&from=...&to=...
 * Returns time series metrics for charts
 * CPU rate is computed as delta(cpu_total_seconds)/delta(time_seconds)
 */
app.get('/api/metrics/timeseries', requireAuth, metricsLimiter, attachScope, async (req, res) => {
  // Feature flag check
  if (!METRICS_ENABLED) {
    return res.json({ enabled: false });
  }
  
  const instanceId = req.query.instance_id;
  const { from, to } = req.query;
  
  // Validate instance_id
  if (!validateInstanceId(instanceId)) {
    await logAudit('metrics_access_denied', { 
      ...getAuditContext(req), 
      metadata: { reason: 'invalid_instance_id', instanceId: String(instanceId).substring(0, 20) } 
    });
    return res.status(400).json({ error: 'Invalid or missing instance_id' });
  }
  
  // Validate timestamps
  if (!validateTimestamp(from) || !validateTimestamp(to)) {
    return res.status(400).json({ error: 'Invalid timestamp format' });
  }
  
  const permissions = await getUserPermissions(req.user.sub);
  
  // Timeseries requires full metrics permission (not just version)
  if (!permissions.includes('metrics.read.full')) {
    await logAudit('metrics_access_denied', { 
      ...getAuditContext(req), 
      metadata: { reason: 'no_full_permission', instanceId } 
    });
    return res.status(403).json({ error: 'Full metrics permission required for timeseries' });
  }
  
  // Check instance scope
  const hasAccess = await userHasInstanceAccess(req.user.sub, instanceId, permissions);
  if (!hasAccess) {
    await logAudit('metrics_access_denied', { 
      ...getAuditContext(req), 
      metadata: { reason: 'no_instance_scope', instanceId } 
    });
    return res.status(403).json({ error: 'No access to this instance' });
  }
  
  try {
    const { fromDate, toDate } = parseAndClampTimeRange(from, to);
    
    // Query with limit to prevent DoS
    const { rows } = await pool.query(
      `SELECT ts, cpu_total_seconds, memory_rss_bytes, heap_used_bytes, 
              external_memory_bytes, eventloop_lag_p99_s, open_fds, active_workflows
       FROM n8n_metrics_snapshot 
       WHERE instance_id = $1 AND ts >= $2 AND ts <= $3
       ORDER BY ts ASC
       LIMIT $4`,
      [instanceId, fromDate.toISOString(), toDate.toISOString(), METRICS_MAX_DATAPOINTS]
    );
    
    // Compute CPU rate (delta cpu_total_seconds / delta time in seconds)
    const dataWithRate = rows.map((row, index) => {
      let cpuRate = null;
      if (index > 0) {
        const prevRow = rows[index - 1];
        const deltaCpu = row.cpu_total_seconds - prevRow.cpu_total_seconds;
        const deltaTimeMs = new Date(row.ts).getTime() - new Date(prevRow.ts).getTime();
        const deltaTimeSec = deltaTimeMs / 1000;
        if (deltaTimeSec > 0 && deltaCpu >= 0) {
          cpuRate = deltaCpu / deltaTimeSec;
        }
      }
      return {
        ts: row.ts,
        cpuRate,
        memoryRssBytes: row.memory_rss_bytes,
        heapUsedBytes: row.heap_used_bytes,
        externalMemoryBytes: row.external_memory_bytes,
        eventloopLagP99S: row.eventloop_lag_p99_s,
        openFds: row.open_fds,
        activeWorkflows: row.active_workflows,
      };
    });
    
    res.json({
      enabled: true,
      instanceId,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      datapoints: dataWithRate.length,
      data: dataWithRate,
    });
  } catch (err) {
    console.error('Metrics timeseries error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/workflows/status?instance_id=...
 * Returns workflow status (active/inactive) for an instance
 */
app.get('/api/workflows/status', requireAuth, metricsLimiter, attachScope, async (req, res) => {
  const instanceId = req.query.instance_id;
  
  // Validate instance_id
  if (!validateInstanceId(instanceId)) {
    return res.status(400).json({ error: 'Invalid or missing instance_id' });
  }
  
  const permissions = await getUserPermissions(req.user.sub);
  
  // Require at least read:workflows permission
  if (!permissions.includes('read:workflows')) {
    return res.status(403).json({ error: 'No workflows permission' });
  }
  
  // Check instance scope (non-admin users need scope)
  if (!permissions.includes('admin:users')) {
    const scope = await getUserScope(req.user.sub);
    if (!scope.instanceIds.includes(instanceId)) {
      return res.status(403).json({ error: 'No access to this instance' });
    }
  }
  
  try {
    const { rows } = await pool.query(
      `SELECT workflow_id, name, active 
       FROM workflows_index 
       WHERE instance_id = $1 
       ORDER BY name ASC
       LIMIT 1000`,
      [instanceId]
    );
    
    res.json({
      instanceId,
      total: rows.length,
      active: rows.filter(r => r.active).length,
      inactive: rows.filter(r => !r.active).length,
      workflows: rows.map(r => ({
        workflowId: r.workflow_id,
        name: r.name,
        active: r.active,
      })),
    });
  } catch (err) {
    console.error('Workflows status error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

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

// ============================================================================
// START SERVER
// ============================================================================

const port = Number(process.env.PORT || 8001);
const server = app.listen(port, async () => {
  console.log(`n8n Pulse API listening on :${port}`);
  console.log(`Environment: ${APP_ENV}`);
  await autoInit();
  if (RETENTION_ENABLED) console.log(`Retention: ${RETENTION_DAYS} days, daily at ${RETENTION_RUN_AT} ${RETENTION_TZ}`);
  if (METRICS_ENABLED) console.log(`Metrics: enabled (max ${METRICS_MAX_TIME_RANGE_DAYS} days, ${METRICS_MAX_DATAPOINTS} datapoints)`);
  else console.log('Metrics: disabled');
});
