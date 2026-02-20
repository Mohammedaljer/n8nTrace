const cron = require('node-cron');
const { pool } = require('../db/pool');
const { logAudit } = require('./audit');
const { RETENTION_ENABLED, RETENTION_DAYS, RETENTION_RUN_AT, RETENTION_BATCH_SIZE, tz } = require('../config');

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

function getRetentionStatus() {
  return {
    enabled: RETENTION_ENABLED,
    retentionDays: RETENTION_DAYS,
    runAt: RETENTION_RUN_AT,
    isRunning: retentionJobRunning,
    lastResult: lastRetentionResult,
  };
}

module.exports = { runRetentionCleanup, getRetentionStatus };
