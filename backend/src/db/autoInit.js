const { pool } = require('./pool');
const { quoteIdent, quoteLiteral } = require('../utils/sql');
const bcrypt = require('bcryptjs');
const {
  BCRYPT_ROUNDS,
  IS_DEV,
  TRUST_PROXY,
} = require('../config');

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
  const path = require('path');
  const pgMigrate = require('node-pg-migrate');
  const runner = pgMigrate.runner;

  const applied = await runner({
    databaseUrl: process.env.DATABASE_URL,
    dir: path.join(__dirname, '..', '..', 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
  });

  if (applied.length > 0) console.log(`Migrations applied: ${applied.map((m) => m.name).join(', ')}`);
  else console.log('Migrations: up to date');
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
      const allowedTables = ['executions', 'execution_nodes', 'workflows_index', 'n8n_metrics_snapshot', 'metrics_series', 'metrics_samples'];
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

module.exports = { autoInit };
