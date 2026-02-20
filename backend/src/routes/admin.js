const express = require('express');
const bcrypt = require('bcryptjs');

function createAdminRouter(deps) {
  const {
    pool,
    state,
    requireAuth, requirePermission, adminApiLimiter, adminCreateLimiter, countActiveAdmins, userIsActiveAdmin, createPasswordToken, getBaseUrl, logAudit, getAuditContext
  } = deps;

  const router = express.Router();

// ============================================================================
// ROUTES: ADMIN (all routes under /api/admin/* are rate limited)
// ============================================================================

// Apply rate limiting to ALL admin routes (100 req/min per IP)
router.use('/api/admin', adminApiLimiter);

// ============================================================================
// ROUTES: ADMIN USERS
// ============================================================================

router.get('/api/admin/users', requireAuth, requirePermission('admin:users'), async (req, res) => {
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

router.post('/api/admin/users', requireAuth, requirePermission('admin:users'), adminCreateLimiter, async (req, res) => {
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

router.post('/api/admin/users/:userId/reset-password-link', requireAuth, requirePermission('admin:users'), adminCreateLimiter, async (req, res) => {
  const { rows } = await pool.query(`SELECT id, email, is_active FROM app_users WHERE id = $1`, [req.params.userId]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  if (!rows[0].is_active) return res.status(400).json({ error: 'User inactive' });

  const { rawToken, expiresAt } = await createPasswordToken(req.params.userId, 'reset_password');
  await logAudit('password_reset_link_generated', { ...getAuditContext(req), targetType: 'user', targetId: req.params.userId });
  res.json({ resetLink: `${getBaseUrl()}/reset-password?token=${rawToken}`, resetLinkExpiresAt: expiresAt, userEmail: rows[0].email });
});

router.post('/api/admin/users/:userId/regenerate-invite', requireAuth, requirePermission('admin:users'), adminCreateLimiter, async (req, res) => {
  const { rows } = await pool.query(`SELECT id, email, is_active, password_set_at, password_hash FROM app_users WHERE id = $1`, [req.params.userId]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  if (!rows[0].is_active) return res.status(400).json({ error: 'User inactive' });
  if (rows[0].password_hash && rows[0].password_set_at) return res.status(400).json({ error: 'Password already set' });

  const { rawToken, expiresAt } = await createPasswordToken(req.params.userId, 'invite_set_password');
  res.json({ inviteLink: `${getBaseUrl()}/set-password?token=${rawToken}`, inviteLinkExpiresAt: expiresAt, userEmail: rows[0].email });
});

router.put('/api/admin/users/:userId/groups', requireAuth, requirePermission('admin:users'), async (req, res) => {
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

router.patch('/api/admin/users/:userId', requireAuth, requirePermission('admin:users'), async (req, res) => {
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

router.delete('/api/admin/users/:userId', requireAuth, requirePermission('admin:users'), async (req, res) => {
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

router.get('/api/admin/roles', requireAuth, requirePermission('admin:users'), async (req, res) => {
  res.json((await pool.query(`SELECT id, key, name, created_at FROM roles ORDER BY name ASC`)).rows);
});

router.get('/api/admin/roles-with-permissions', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.key, r.name, r.created_at,
            COALESCE(json_agg(json_build_object('id', p.id, 'key', p.key, 'description', p.description)) FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS permissions
     FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id GROUP BY r.id ORDER BY r.name ASC`
  );
  res.json(rows);
});

router.get('/api/admin/groups', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.description, g.created_at,
            COALESCE(json_agg(DISTINCT jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name)) FILTER (WHERE r.id IS NOT NULL), '[]'::json) AS roles,
            COALESCE(json_agg(DISTINCT jsonb_build_object('instance_id', gs.instance_id, 'workflow_id', gs.workflow_id, 'tag', gs.tag)) FILTER (WHERE gs.id IS NOT NULL), '[]'::json) AS scopes
     FROM groups g LEFT JOIN group_roles gr ON gr.group_id = g.id LEFT JOIN roles r ON r.id = gr.role_id LEFT JOIN group_scopes gs ON gs.group_id = g.id GROUP BY g.id ORDER BY g.created_at DESC LIMIT 200`
  );
  res.json(rows);
});

router.post('/api/admin/groups', requireAuth, requirePermission('admin:users'), async (req, res) => {
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

router.put('/api/admin/groups/:groupId', requireAuth, requirePermission('admin:users'), async (req, res) => {
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

router.delete('/api/admin/groups/:groupId', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const r = await pool.query(`DELETE FROM groups WHERE id = $1`, [req.params.groupId]);
  if (!r.rowCount) return res.status(404).json({ error: 'Group not found' });
  await logAudit('group_deleted', { ...getAuditContext(req), targetType: 'group', targetId: req.params.groupId });
  res.json({ ok: true });
});

// ============================================================================
// ROUTES: AUDIT LOG (Admin only)
// ============================================================================

router.get('/api/admin/audit-logs', requireAuth, requirePermission('admin:users'), async (req, res) => {
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

router.get('/api/admin/audit-log-actions', requireAuth, requirePermission('admin:users'), async (req, res) => {
  const { rows } = await pool.query(`SELECT DISTINCT action FROM audit_log ORDER BY action ASC`);
  res.json(rows.map(r => r.action));
});

// ============================================================================
// ROUTES: RETENTION (Manual trigger for admins)
// ============================================================================

router.post('/api/admin/retention/run', requireAuth, requirePermission('admin:users'), async (req, res) => {
  if (!RETENTION_ENABLED) return res.status(400).json({ error: 'Retention not enabled' });
  
  try {
    await logAudit('retention_manual_trigger', getAuditContext(req));
    const result = await runRetentionCleanup();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/api/admin/retention/status', requireAuth, requirePermission('admin:users'), async (req, res) => {
  res.json({
    enabled: RETENTION_ENABLED,
    retentionDays: RETENTION_DAYS,
    runAt: RETENTION_RUN_AT,
    isRunning: retentionJobRunning,
    lastResult: lastRetentionResult,
  });
});

  return router;
}

module.exports = { createAdminRouter };
