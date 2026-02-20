const express = require('express');


function createDataRouter(deps) {
  const {
    pool,
    state,
    requireAuth, attachAuthz, requirePermission
  } = deps;

  const router = express.Router();

// ============================================================================
// ROUTES: DATA (with centralized RBAC enforcement)
// ============================================================================

/**
 * GET /api/workflows
 * Returns workflows filtered by user's RBAC scopes.
 * - Admin: all workflows
 * - Scoped user: only workflows allowed by tag/workflow_id scopes
 * - No scopes: empty array (default deny)
 */
router.get('/api/workflows', requireAuth, attachAuthz, requirePermission('read:workflows'), async (req, res) => {
  const authz = req.authz;
  
  // Default deny for non-admin with no scopes
  if (!authz.isAdmin && !authz.hasAnyScopeRows) {
    return res.json([]);
  }
  
  const limit = Math.min(Number(req.query.limit || 1000), 5000);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const instanceFilter = req.query.instance_id || null;
  
  // Build query based on authorization
  let sql, params;
  
  if (authz.isAdmin) {
    // Admin: no workflow restriction, optional instance filter
    if (instanceFilter) {
      sql = `SELECT instance_id, workflow_id, name, active, is_archived, updated_at, tags, nodes_count 
             FROM workflows_index WHERE instance_id = $1 
             ORDER BY updated_at DESC NULLS LAST LIMIT $2 OFFSET $3`;
      params = [instanceFilter, limit, offset];
    } else {
      sql = `SELECT instance_id, workflow_id, name, active, is_archived, updated_at, tags, nodes_count 
             FROM workflows_index 
             ORDER BY updated_at DESC NULLS LAST LIMIT $1 OFFSET $2`;
      params = [limit, offset];
    }
  } else {
    // Scoped user: filter by allowed workflow IDs
    if (authz.allowedWorkflowIds.length === 0) {
      return res.json([]);
    }
    
    if (instanceFilter) {
      sql = `SELECT instance_id, workflow_id, name, active, is_archived, updated_at, tags, nodes_count 
             FROM workflows_index 
             WHERE workflow_id = ANY($1::text[]) AND instance_id = $2
             ORDER BY updated_at DESC NULLS LAST LIMIT $3 OFFSET $4`;
      params = [authz.allowedWorkflowIds, instanceFilter, limit, offset];
    } else {
      sql = `SELECT instance_id, workflow_id, name, active, is_archived, updated_at, tags, nodes_count 
             FROM workflows_index 
             WHERE workflow_id = ANY($1::text[])
             ORDER BY updated_at DESC NULLS LAST LIMIT $2 OFFSET $3`;
      params = [authz.allowedWorkflowIds, limit, offset];
    }
  }
  
  res.json((await pool.query(sql, params)).rows);
});

/**
 * GET /api/executions
 * Returns executions filtered by user's RBAC scopes.
 * - Admin: all executions
 * - Scoped user: only executions for allowed workflows
 * - No scopes: empty array (default deny)
 */
router.get('/api/executions', requireAuth, attachAuthz, requirePermission('read:executions'), async (req, res) => {
  const authz = req.authz;
  
  // Default deny for non-admin with no scopes
  if (!authz.isAdmin && !authz.hasAnyScopeRows) {
    return res.json([]);
  }
  
  const limit = Math.min(Number(req.query.limit || 500), 5000);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const instanceFilter = req.query.instance_id || null;
  const workflowFilter = req.query.workflow_id || null;
  
  // Build query based on authorization
  let sql, params;
  let paramIndex = 1;
  const whereClause = [];
  params = [];
  
  if (authz.isAdmin) {
    // Admin: no workflow restriction
    if (instanceFilter) {
      whereClause.push(`instance_id = $${paramIndex++}`);
      params.push(instanceFilter);
    }
    if (workflowFilter) {
      whereClause.push(`workflow_id = $${paramIndex++}`);
      params.push(workflowFilter);
    }
  } else {
    // Scoped user: must filter by allowed workflow IDs
    if (authz.allowedWorkflowIds.length === 0) {
      return res.json([]);
    }
    
    // Apply workflow scope filter
    whereClause.push(`workflow_id = ANY($${paramIndex++}::text[])`);
    params.push(authz.allowedWorkflowIds);
    
    if (instanceFilter) {
      whereClause.push(`instance_id = $${paramIndex++}`);
      params.push(instanceFilter);
    }
    if (workflowFilter) {
      // Verify requested workflow is in allowed list
      if (!authz.allowedWorkflowIds.includes(workflowFilter)) {
        return res.json([]);
      }
      whereClause.push(`workflow_id = $${paramIndex++}`);
      params.push(workflowFilter);
    }
  }
  
  params.push(limit, offset);
  const whereStr = whereClause.length > 0 ? `WHERE ${whereClause.join(' AND ')}` : '';
  sql = `SELECT instance_id, execution_id, workflow_id, status, finished, mode, started_at, stopped_at, duration_ms, nodes_count, last_node_executed 
         FROM executions ${whereStr} 
         ORDER BY started_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  
  res.json((await pool.query(sql, params)).rows);
});

/**
 * GET /api/execution-nodes
 * Returns execution nodes filtered by user's RBAC scopes.
 * - Admin: all nodes
 * - Scoped user: only nodes for allowed workflows
 * - No scopes: empty array (default deny)
 */
router.get('/api/execution-nodes', requireAuth, attachAuthz, requirePermission('read:nodes'), async (req, res) => {
  const authz = req.authz;
  
  // Default deny for non-admin with no scopes
  if (!authz.isAdmin && !authz.hasAnyScopeRows) {
    return res.json([]);
  }
  
  const executionId = req.query.execution_id || null;
  const instanceFilter = req.query.instance_id || null;
  const limit = Math.min(Number(req.query.limit || 50000), 200000);
  
  // Build query based on authorization
  let paramIndex = 1;
  const whereClause = [];
  const params = [];
  
  if (executionId) {
    whereClause.push(`execution_id = $${paramIndex++}`);
    params.push(String(executionId));
  }
  
  if (authz.isAdmin) {
    // Admin: no workflow restriction
    if (instanceFilter) {
      whereClause.push(`instance_id = $${paramIndex++}`);
      params.push(instanceFilter);
    }
  } else {
    // Scoped user: must filter by allowed workflow IDs
    if (authz.allowedWorkflowIds.length === 0) {
      return res.json([]);
    }
    
    whereClause.push(`workflow_id = ANY($${paramIndex++}::text[])`);
    params.push(authz.allowedWorkflowIds);
    
    if (instanceFilter) {
      whereClause.push(`instance_id = $${paramIndex++}`);
      params.push(instanceFilter);
    }
  }
  
  params.push(limit);
  const whereStr = whereClause.length > 0 ? `WHERE ${whereClause.join(' AND ')}` : '';
  const sql = `SELECT instance_id, execution_id, workflow_id, node_name, node_type, run_index, runs_count, is_last_run, execution_status, execution_time_ms, start_time_ms, start_time, items_out_count, items_out_total_all_runs 
               FROM execution_nodes ${whereStr} 
               ORDER BY ${executionId ? 'start_time_ms ASC NULLS LAST, node_name ASC' : 'inserted_at DESC NULLS LAST'} 
               LIMIT $${paramIndex}`;
  
  res.json((await pool.query(sql, params)).rows);
});

  return router;
}

module.exports = { createDataRouter };
