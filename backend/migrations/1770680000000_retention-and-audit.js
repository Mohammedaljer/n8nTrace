/**
 * Migration: Add ingested_at column and indexes for retention cleanup
 * Safe migration approach for large tables
 */
export const shorthands = undefined;

export const up = async (pgm) => {
  // Check if ingested_at already exists on executions
  const execHasCol = await pgm.db.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'executions' AND column_name = 'ingested_at'
    ) AS exists
  `);
  
  if (!execHasCol.rows[0].exists) {
    // Add nullable column first (instant, no table rewrite)
    pgm.addColumn('executions', {
      ingested_at: { type: 'timestamptz', notNull: false },
    });
    
    // Backfill existing rows with started_at as fallback
    pgm.sql(`UPDATE executions SET ingested_at = COALESCE(inserted_at, started_at, now()) WHERE ingested_at IS NULL`);
    
    // Set default for new rows and make NOT NULL
    pgm.alterColumn('executions', 'ingested_at', { default: pgm.func('now()'), notNull: true });
  }
  
  // Check if ingested_at already exists on execution_nodes
  const nodesHasCol = await pgm.db.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'execution_nodes' AND column_name = 'ingested_at'
    ) AS exists
  `);
  
  if (!nodesHasCol.rows[0].exists) {
    pgm.addColumn('execution_nodes', {
      ingested_at: { type: 'timestamptz', notNull: false },
    });
    
    pgm.sql(`UPDATE execution_nodes SET ingested_at = COALESCE(inserted_at, start_time, now()) WHERE ingested_at IS NULL`);
    
    pgm.alterColumn('execution_nodes', 'ingested_at', { default: pgm.func('now()'), notNull: true });
  }
  
  // Add indexes for retention cleanup performance (CONCURRENTLY not supported in migrations)
  pgm.createIndex('executions', 'ingested_at', { 
    name: 'idx_executions_ingested_at', 
    ifNotExists: true 
  });
  
  pgm.createIndex('execution_nodes', 'ingested_at', { 
    name: 'idx_execution_nodes_ingested_at', 
    ifNotExists: true 
  });
  
  // Create audit_log table
  pgm.createTable('audit_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    actor_user_id: { type: 'uuid', references: '"app_users"(id)', onDelete: 'SET NULL' },
    action: { type: 'text', notNull: true },
    target_type: { type: 'text' },
    target_id: { type: 'text' },
    metadata: { type: 'jsonb', default: '{}' },
    ip: { type: 'text' },
    user_agent: { type: 'text' },
    instance_id: { type: 'text' },
  });
  
  pgm.createIndex('audit_log', 'created_at', { name: 'idx_audit_log_created_at' });
  pgm.createIndex('audit_log', 'actor_user_id', { name: 'idx_audit_log_actor' });
  pgm.createIndex('audit_log', 'action', { name: 'idx_audit_log_action' });
};

export const down = (pgm) => {
  pgm.dropTable('audit_log');
  pgm.dropIndex('execution_nodes', 'idx_execution_nodes_ingested_at');
  pgm.dropIndex('executions', 'idx_executions_ingested_at');
  // Don't drop ingested_at columns - they may have been pre-existing
};
