const { pool } = require('../db/pool');

/**
 * Centralized authorization helper that resolves "allowed workflow IDs" per request.
 * This is the single source of truth for RBAC scope enforcement.
 * 
 * Returns:
 * - { isAdmin: true } for admins (unrestricted access)
 * - { isAdmin: false, allowedWorkflowIds: [...] } for scoped users
 * - { isAdmin: false, allowedWorkflowIds: [] } for non-admins with no scopes (default deny)
 * 
 * Caches result on req.authz for per-request reuse.
 */
async function getAuthorizationContext(req, options = {}) {
  const { instanceFilter = null } = options;
  
  // Return cached result if available (per-request caching)
  const cacheKey = `authz_${instanceFilter || 'all'}`;
  if (req._authzCache?.[cacheKey]) {
    return req._authzCache[cacheKey];
  }
  
  const userId = req.user?.sub;
  if (!userId) {
    return { isAdmin: false, allowedWorkflowIds: [], hasAnyScopeRows: false };
  }
  
  // Get permissions (may already be attached by requirePermission middleware)
  const permissions = req.permissions || await getUserPermissions(userId);
  req.permissions = permissions; // Cache for later use
  
  // Admin check: admin:users or admin:roles permission = unrestricted access
  const isAdmin = permissions.includes('admin:users') || permissions.includes('admin:roles');
  if (isAdmin) {
    const result = { isAdmin: true, allowedWorkflowIds: null, hasAnyScopeRows: true };
    if (!req._authzCache) req._authzCache = {};
    req._authzCache[cacheKey] = result;
    return result;
  }
  
  // Get user's group scopes
  const { rows: scopeRows } = await pool.query(
    `SELECT gs.instance_id, gs.workflow_id, gs.tag 
     FROM app_users u
     JOIN user_groups ug ON ug.user_id = u.id
     JOIN group_scopes gs ON gs.group_id = ug.group_id
     WHERE u.id = $1 AND u.is_active = true`,
    [userId]
  );
  
  // Default deny: non-admin with no scope rows
  if (scopeRows.length === 0) {
    const result = { isAdmin: false, allowedWorkflowIds: [], hasAnyScopeRows: false };
    if (!req._authzCache) req._authzCache = {};
    req._authzCache[cacheKey] = result;
    return result;
  }
  
  // Collect explicit workflow IDs from scopes
  const explicitWorkflowIds = new Set();
  const scopedTags = new Set();
  const scopedInstanceIds = new Set();
  let hasGlobalInstanceScope = false;
  // Track if user has ANY explicit instance scope row (not just tag/workflow)
  let hasExplicitInstanceScope = false;
  
  for (const row of scopeRows) {
    // Track instance scopes
    // A row with instance_id = NULL means "all instances" ONLY if:
    // - It's an instance-only scope (no tag, no workflow_id set in that row)
    // OR - It's combined with other scopes
    // For pure tag scopes (tag set, instance_id=NULL, workflow_id=NULL), 
    // we DON'T grant global instance metrics access
    if (row.instance_id === null && !row.tag && !row.workflow_id) {
      // This is an explicit "all instances" grant
      hasGlobalInstanceScope = true;
      hasExplicitInstanceScope = true;
    } else if (row.instance_id) {
      scopedInstanceIds.add(row.instance_id);
      hasExplicitInstanceScope = true;
    }
    // Note: If only tag or workflow_id is set (no instance_id), 
    // we don't set hasGlobalInstanceScope - user gets workflow access but not instance metrics
    
    // Collect explicit workflow IDs
    if (row.workflow_id) {
      explicitWorkflowIds.add(row.workflow_id);
    }
    
    // Collect tags for JSONB matching
    if (row.tag) {
      scopedTags.add(row.tag);
    }
  }
  
  // Build allowed workflow IDs set
  const allowedWorkflowIds = new Set(explicitWorkflowIds);
  
  // Determine if user has tag-only scope (no instance restriction for workflow access)
  // A tag-only scope means: tag is set but NO explicit instance_id scope
  const hasTagOnlyScope = scopedTags.size > 0 && !hasExplicitInstanceScope;
  
  // Resolve workflows by tag scopes using JSONB membership check
  if (scopedTags.size > 0) {
    const tagsArray = [...scopedTags];
    
    // Build instance filter condition
    let instanceCondition = '';
    const queryParams = [tagsArray];
    let paramIndex = 2;
    
    if (instanceFilter) {
      // Specific instance requested
      // For tag-only scopes: allow access to any instance (tag filters the workflows)
      // For instance-scoped users: verify they have access to this instance
      if (!hasTagOnlyScope && !hasGlobalInstanceScope && !scopedInstanceIds.has(instanceFilter)) {
        // User has explicit instance scope but not for this instance
        const result = { isAdmin: false, allowedWorkflowIds: [], hasAnyScopeRows: true, hasExplicitInstanceScope };
        if (!req._authzCache) req._authzCache = {};
        req._authzCache[cacheKey] = result;
        return result;
      }
      // Apply instance filter to query
      instanceCondition = ` AND instance_id = $${paramIndex}`;
      queryParams.push(instanceFilter);
      paramIndex++;
    } else if (!hasTagOnlyScope && !hasGlobalInstanceScope && scopedInstanceIds.size > 0) {
      // User has instance-specific scopes, filter to those instances
      instanceCondition = ` AND instance_id = ANY($${paramIndex}::text[])`;
      queryParams.push([...scopedInstanceIds]);
      paramIndex++;
    }
    // If hasGlobalInstanceScope OR hasTagOnlyScope, no instance filter needed
    
    // Use JSONB ?| operator for exact tag membership check
    // tags column contains JSON array string like '["backup","production"]'
    // We cast to jsonb and check if ANY of the allowed tags is present
    // Safe handling: invalid JSON will not match (caught by try-catch)
    // We use a subquery with error handling via PL/pgSQL or simple regex pre-check
    const tagQuery = `
      SELECT workflow_id FROM workflows_index 
      WHERE (
        CASE 
          WHEN tags IS NOT NULL 
               AND tags != '' 
               AND tags != '[]' 
               AND tags ~ '^\\s*\\[.*\\]\\s*$'  -- Basic JSON array format check
          THEN
            (tags::jsonb ?| $1::text[])
          ELSE false
        END
      )${instanceCondition}
    `;
    
    try {
      const { rows: tagWorkflows } = await pool.query(tagQuery, queryParams);
      for (const row of tagWorkflows) {
        allowedWorkflowIds.add(row.workflow_id);
      }
    } catch (err) {
      // If JSONB cast fails for any reason (shouldn't happen with CASE but safety first)
      console.error('Tag scope resolution error:', err.message);
      // Continue with explicit workflow IDs only (fail-safe to deny)
    }
  }
  
  // Handle instance-only scopes (no tags, no explicit workflow_ids)
  // In this case, user has access to ALL workflows in the scoped instances
  const hasInstanceOnlyScope = hasExplicitInstanceScope && scopedTags.size === 0 && explicitWorkflowIds.size === 0;
  
  if (hasInstanceOnlyScope) {
    let instanceQuery, queryParams;
    
    if (instanceFilter) {
      // Check if user has access to the requested instance
      if (!hasGlobalInstanceScope && !scopedInstanceIds.has(instanceFilter)) {
        const result = { isAdmin: false, allowedWorkflowIds: [], hasAnyScopeRows: true, hasExplicitInstanceScope };
        if (!req._authzCache) req._authzCache = {};
        req._authzCache[cacheKey] = result;
        return result;
      }
      instanceQuery = `SELECT workflow_id FROM workflows_index WHERE instance_id = $1`;
      queryParams = [instanceFilter];
    } else if (hasGlobalInstanceScope) {
      // All instances - get all workflows
      instanceQuery = `SELECT workflow_id FROM workflows_index`;
      queryParams = [];
    } else {
      // Get workflows from scoped instances
      instanceQuery = `SELECT workflow_id FROM workflows_index WHERE instance_id = ANY($1::text[])`;
      queryParams = [[...scopedInstanceIds]];
    }
    
    try {
      const { rows: instanceWorkflows } = await pool.query(instanceQuery, queryParams);
      for (const row of instanceWorkflows) {
        allowedWorkflowIds.add(row.workflow_id);
      }
    } catch (err) {
      console.error('Instance scope resolution error:', err.message);
    }
  }
  
  // Also add explicit workflow_id scopes, respecting instance filter
  if (explicitWorkflowIds.size > 0) {
    let workflowInstanceCheck = '';
    const queryParams = [[...explicitWorkflowIds]];
    
    if (instanceFilter) {
      workflowInstanceCheck = ' AND instance_id = $2';
      queryParams.push(instanceFilter);
    } else if (!hasGlobalInstanceScope && scopedInstanceIds.size > 0) {
      workflowInstanceCheck = ' AND instance_id = ANY($2::text[])';
      queryParams.push([...scopedInstanceIds]);
    }
    
    const workflowQuery = `
      SELECT workflow_id FROM workflows_index 
      WHERE workflow_id = ANY($1::text[])${workflowInstanceCheck}
    `;
    
    try {
      const { rows: explicitWorkflows } = await pool.query(workflowQuery, queryParams);
      // Clear and re-add only workflows that exist and match instance filter
      for (const wid of explicitWorkflowIds) {
        allowedWorkflowIds.delete(wid);
      }
      for (const row of explicitWorkflows) {
        allowedWorkflowIds.add(row.workflow_id);
      }
    } catch (err) {
      console.error('Explicit workflow scope resolution error:', err.message);
    }
  }
  
  const result = {
    isAdmin: false,
    allowedWorkflowIds: [...allowedWorkflowIds],
    hasAnyScopeRows: true,
    scopedInstanceIds: [...scopedInstanceIds],
    hasGlobalInstanceScope,
    hasExplicitInstanceScope, // true if user has any instance-level scope (for metrics access)
  };
  
  if (!req._authzCache) req._authzCache = {};
  req._authzCache[cacheKey] = result;
  return result;
}

/**
 * Middleware to attach authorization context to request.
 * Call this instead of attachScope for endpoints that need workflow filtering.
 */
async function attachAuthz(req, res, next) {
  if (req.user?.sub) {
    req.authz = await getAuthorizationContext(req);
  }
  next();
}

/**
 * Check if user has access to a specific instance (for instance-level metrics).
 * For non-admin users with tag/workflow scopes but no explicit instance scope,
 * they do NOT have access to instance-level infrastructure metrics.
 */
async function userHasInstanceAccessForMetrics(req, instanceId) {
  const authz = await getAuthorizationContext(req, { instanceFilter: instanceId });
  
  // Admin has full access
  if (authz.isAdmin) return true;
  
  // Non-admin must have explicit instance scope (not just tag/workflow scope)
  if (!authz.hasAnyScopeRows) return false;
  
  // Check if user has explicit instance scope (global or specific)
  return authz.hasGlobalInstanceScope || authz.scopedInstanceIds?.includes(instanceId);
}

// Legacy function kept for backward compatibility with existing code
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

module.exports = { getAuthorizationContext, attachAuthz, buildScopeWhere };
