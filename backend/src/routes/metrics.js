const express = require('express');
const { METRICS_ENABLED, METRICS_MAX_TIME_RANGE_DAYS, METRICS_MAX_DATAPOINTS } = require('../config');

function createMetricsRouter(deps) {
  const {
    pool,
    state,
    requireAuth, metricsLimiter, getAuthorizationContext, attachAuthz, logAudit, getAuditContext
  } = deps;

  const router = express.Router();

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
 * Check if user has access to instance-level infrastructure metrics (CPU/RAM/etc).
 * ADMIN ONLY or users with EXPLICIT instance scope.
 * Users with only tag/workflow scopes do NOT get instance metrics access.
 */
async function userHasInstanceMetricsAccess(req, instanceId) {
  const authz = await getAuthorizationContext(req, { instanceFilter: instanceId });
  
  // Admin has full access to instance metrics
  if (authz.isAdmin) return { hasAccess: true, level: 'admin' };
  
  // Non-admin: must have EXPLICIT instance scope (not just tag/workflow scope)
  if (!authz.hasAnyScopeRows) return { hasAccess: false, level: 'none' };
  
  // User must have explicit instance scope to access instance metrics
  // Tag-only or workflow-only scopes do NOT grant instance metrics access
  if (!authz.hasExplicitInstanceScope) {
    return { hasAccess: false, level: 'none' };
  }
  
  // Check if user has access to this specific instance
  if (authz.hasGlobalInstanceScope || authz.scopedInstanceIds?.includes(instanceId)) {
    return { hasAccess: true, level: 'instance' };
  }
  
  return { hasAccess: false, level: 'none' };
}

/**
 * Get all instance_ids the user has access to for instance metrics.
 * Admin: all instances
 * Non-admin with explicit instance scope: those instances only
 * Non-admin with only tag/workflow scopes: empty (no instance metrics access)
 */
async function getUserAllowedInstancesForMetrics(req) {
  const authz = await getAuthorizationContext(req);
  
  // Admin has global access - return all instances ordered by most recent activity
  if (authz.isAdmin) {
    const { rows } = await pool.query(
      `SELECT instance_id, MAX(ts) as last_activity
       FROM n8n_metrics_snapshot 
       WHERE instance_id IS NOT NULL 
       GROUP BY instance_id
       ORDER BY last_activity DESC`
    );
    return rows.map(r => r.instance_id);
  }
  
  // Non-admin must have EXPLICIT instance scope for instance metrics
  // Users with only tag/workflow scopes get NO instance metrics access
  if (!authz.hasExplicitInstanceScope) {
    return [];
  }
  
  // Non-admin with global explicit instance scope
  if (authz.hasGlobalInstanceScope) {
    // Global instance scope = all instances
    const { rows } = await pool.query(
      `SELECT instance_id, MAX(ts) as last_activity
       FROM n8n_metrics_snapshot 
       WHERE instance_id IS NOT NULL 
       GROUP BY instance_id
       ORDER BY last_activity DESC`
    );
    return rows.map(r => r.instance_id);
  }
  
  // Return only explicitly scoped instances
  return authz.scopedInstanceIds || [];
}

/**
 * GET /api/metrics/config
 * Returns metrics feature configuration (for frontend feature flag)
 * 
 * NOTE: canCustomizeDashboard is granted to ALL authenticated users.
 * This allows personal UI customization (widget toggles) without granting
 * admin-level metrics.manage permission. Instance metrics remain admin-only.
 */
router.get('/api/metrics/config', requireAuth, async (req, res) => {
  const permissions = await getUserPermissions(req.user.sub);
  res.json({
    enabled: METRICS_ENABLED,
    hasVersionPermission: permissions.includes('metrics.read.version'),
    hasFullPermission: permissions.includes('metrics.read.full'),
    hasManagePermission: permissions.includes('metrics.manage'),
    // canCustomizeDashboard: any authenticated user can personalize their dashboard view
    // This is separate from hasManagePermission which is for global/admin configuration
    canCustomizeDashboard: true,
    maxTimeRangeDays: METRICS_MAX_TIME_RANGE_DAYS,
    maxDatapoints: METRICS_MAX_DATAPOINTS,
  });
});

/**
 * GET /api/metrics/instances
 * Returns list of instances the user has access to for instance metrics.
 * - Admin: all instances
 * - Users with explicit instance scope: those instances
 * - Users with only tag/workflow scopes: empty array (no instance metrics)
 */
router.get('/api/metrics/instances', requireAuth, metricsLimiter, attachAuthz, async (req, res) => {
  if (!METRICS_ENABLED) {
    return res.json({ enabled: false, instances: [] });
  }
  
  const permissions = await getUserPermissions(req.user.sub);
  if (!permissions.includes('metrics.read.version') && !permissions.includes('metrics.read.full')) {
    return res.json({ enabled: true, instances: [] });
  }
  
  try {
    const instances = await getUserAllowedInstancesForMetrics(req);
    res.json({ enabled: true, instances });
  } catch (err) {
    console.error('Metrics instances error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/metrics/latest?instance_id=...
 * Returns the latest metrics snapshot for an instance
 * - Admin: full metrics
 * - Users with explicit instance scope: full metrics
 * - Users with only tag/workflow scopes: NO ACCESS (403)
 */
router.get('/api/metrics/latest', requireAuth, metricsLimiter, attachAuthz, async (req, res) => {
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
  
  // Check instance metrics access (admin or explicit instance scope required)
  const accessCheck = await userHasInstanceMetricsAccess(req, instanceId);
  if (!accessCheck.hasAccess) {
    await logAudit('metrics_access_denied', { 
      ...getAuditContext(req), 
      metadata: { reason: 'no_instance_scope', instanceId } 
    });
    return res.status(403).json({ error: 'No access to instance metrics. Tag/workflow scopes do not grant instance-level access.' });
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
 * ADMIN ONLY or users with explicit instance scope
 */
router.get('/api/metrics/timeseries', requireAuth, metricsLimiter, attachAuthz, async (req, res) => {
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
  
  // Check instance metrics access (admin or explicit instance scope required)
  const accessCheck = await userHasInstanceMetricsAccess(req, instanceId);
  if (!accessCheck.hasAccess) {
    await logAudit('metrics_access_denied', { 
      ...getAuditContext(req), 
      metadata: { reason: 'no_instance_scope', instanceId } 
    });
    return res.status(403).json({ error: 'No access to instance metrics. Tag/workflow scopes do not grant instance-level access.' });
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
 * - Admin: all workflows in instance
 * - Scoped users: only workflows allowed by their tag/workflow scopes
 */
router.get('/api/workflows/status', requireAuth, metricsLimiter, attachAuthz, async (req, res) => {
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
  
  // Get authorization context with instance filter
  const authz = await getAuthorizationContext(req, { instanceFilter: instanceId });
  
  // Default deny for non-admin with no scopes
  if (!authz.isAdmin && !authz.hasAnyScopeRows) {
    return res.json({
      instanceId,
      total: 0,
      active: 0,
      inactive: 0,
      workflows: [],
    });
  }
  
  try {
    let rows;
    
    if (authz.isAdmin) {
      // Admin: all workflows in instance
      const result = await pool.query(
        `SELECT workflow_id, name, active 
         FROM workflows_index 
         WHERE instance_id = $1 
         ORDER BY name ASC
         LIMIT 1000`,
        [instanceId]
      );
      rows = result.rows;
    } else {
      // Scoped user: only allowed workflows
      if (authz.allowedWorkflowIds.length === 0) {
        return res.json({
          instanceId,
          total: 0,
          active: 0,
          inactive: 0,
          workflows: [],
        });
      }
      
      const result = await pool.query(
        `SELECT workflow_id, name, active 
         FROM workflows_index 
         WHERE instance_id = $1 AND workflow_id = ANY($2::text[])
         ORDER BY name ASC
         LIMIT 1000`,
        [instanceId, authz.allowedWorkflowIds]
      );
      rows = result.rows;
    }
    
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

  return router;
}

module.exports = { createMetricsRouter };
