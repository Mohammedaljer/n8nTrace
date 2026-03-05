/**
 * Migration: Performance indexes
 *
 * 1. idx_execution_nodes_workflow_id — speeds up RBAC-filtered node queries
 *    that join execution_nodes by workflow_id for non-admin users.
 *
 * 2. idx_audit_log_action_created — composite index for filtered time-range
 *    queries on specific audit actions (e.g. "show all login_failed in the
 *    last 24 h").
 */

exports.up = (pgm) => {
  pgm.createIndex('execution_nodes', 'workflow_id', {
    name: 'idx_execution_nodes_workflow_id',
    ifNotExists: true,
  });

  pgm.createIndex('audit_log', ['action', 'created_at'], {
    name: 'idx_audit_log_action_created',
    ifNotExists: true,
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('execution_nodes', 'workflow_id', {
    name: 'idx_execution_nodes_workflow_id',
    ifNotExists: true,
  });

  pgm.dropIndex('audit_log', ['action', 'created_at'], {
    name: 'idx_audit_log_action_created',
    ifNotExists: true,
  });
};
