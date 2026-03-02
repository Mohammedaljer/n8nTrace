const { pool } = require('./pool');
const { quoteIdent, quoteLiteral } = require('../utils/sql');
const bcrypt = require('bcryptjs');
const {
  BCRYPT_ROUNDS,
  IS_DEV,
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
          `INSERT INTO app_users (email, password_hash, is_active, password_set_at) VALUES ($1, $2, true, now()) RETURNING id`,
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

  // ========================================================================
  // Merge legacy "Admins" group into "Admin" (safe, idempotent)
  // Existing databases may have users assigned to "Admins". Move them to
  // "Admin" before deleting the legacy group.
  // ========================================================================
  try {
    const legacyGrp = await pool.query(`SELECT id FROM groups WHERE name = 'Admins'`);
    const canonicalGrp = await pool.query(`SELECT id FROM groups WHERE name = 'Admin'`);
    if (legacyGrp.rows.length > 0 && canonicalGrp.rows.length > 0) {
      const legacyId = legacyGrp.rows[0].id;
      const canonicalId = canonicalGrp.rows[0].id;
      // Move user memberships from legacy → canonical (skip duplicates)
      await pool.query(
        `INSERT INTO user_groups (user_id, group_id)
         SELECT user_id, $1 FROM user_groups WHERE group_id = $2
         ON CONFLICT DO NOTHING`,
        [canonicalId, legacyId]
      );
      // Remove legacy memberships, scopes, role links, then the group itself
      await pool.query(`DELETE FROM user_groups WHERE group_id = $1`, [legacyId]);
      await pool.query(`DELETE FROM group_scopes WHERE group_id = $1`, [legacyId]);
      await pool.query(`DELETE FROM group_roles WHERE group_id = $1`, [legacyId]);
      await pool.query(`DELETE FROM groups WHERE id = $1`, [legacyId]);
      console.log('Merged legacy "Admins" group into "Admin" and removed it.');
    } else if (legacyGrp.rows.length > 0 && canonicalGrp.rows.length === 0) {
      // Only legacy exists, no canonical yet — rename it
      await pool.query(`UPDATE groups SET name = 'Admin' WHERE id = $1`, [legacyGrp.rows[0].id]);
      console.log('Renamed legacy "Admins" group to "Admin".');
    }
  } catch (mergeErr) {
    console.error('Admin group merge error (non-fatal):', mergeErr.message);
  }

  // Add admin user to Admin group only when created from env
  if (userId != null) {
    const adminGrp = await pool.query(`SELECT id FROM groups WHERE name = 'Admin'`);
    if (adminGrp.rows.length > 0) {
      await pool.query(`INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, adminGrp.rows[0].id]);
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

module.exports = { autoInit };
