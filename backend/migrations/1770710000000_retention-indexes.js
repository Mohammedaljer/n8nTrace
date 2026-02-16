/**
 * Add indexes for extended retention cleanup
 * 
 * This migration adds indexes to support efficient retention cleanup
 * on n8n_metrics_snapshot, audit_log, and executions tables.
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  // Index on executions.stopped_at for finished execution retention queries
  pgm.createIndex('executions', 'stopped_at', {
    name: 'idx_executions_stopped_at',
    ifNotExists: true
  });

  // Index on executions(finished, stopped_at) for retention WHERE clause
  pgm.createIndex('executions', ['finished', 'stopped_at'], {
    name: 'idx_executions_finished_stopped',
    ifNotExists: true
  });

  // Note: idx_audit_log_created_at already exists from retention-and-audit migration
  // Note: idx_metrics_inserted_at already exists from add-metrics-snapshot migration
  // Note: idx_executions_ingested_at already exists from retention-and-audit migration
};

export const down = (pgm) => {
  pgm.dropIndex('executions', ['finished', 'stopped_at'], { 
    name: 'idx_executions_finished_stopped',
    ifExists: true 
  });
  pgm.dropIndex('executions', 'stopped_at', { 
    name: 'idx_executions_stopped_at',
    ifExists: true 
  });
};
