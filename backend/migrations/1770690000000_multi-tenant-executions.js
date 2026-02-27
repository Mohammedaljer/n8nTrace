/**
 * Multi-tenant execution support
 * 
 * Problem: execution_id can repeat across different n8n instances.
 * Current PK on execution_id alone causes upsert collisions.
 * 
 * Solution: 
 * 1. Drop FK from execution_nodes that references executions(execution_id)
 * 2. Change PK from (execution_id) to (instance_id, execution_id)
 * 3. Recreate FK with composite reference
 * 
 * This enables: ON CONFLICT (instance_id, execution_id) DO UPDATE ...
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  // Step 1: Drop the FK from execution_nodes that references executions
  pgm.dropConstraint('execution_nodes', 'execution_nodes_execution_id_fkey', { ifExists: true });

  // Step 2: Drop the old single-column PK
  pgm.dropConstraint('executions', 'executions_pkey');

  // Step 3: Add composite PK (instance_id, execution_id)
  pgm.addConstraint('executions', 'executions_pkey', {
    primaryKey: ['instance_id', 'execution_id'],
  });

  // Step 4: Add index on instance_id for better query performance
  pgm.createIndex('executions', 'instance_id', { 
    name: 'idx_executions_instance_id',
    ifNotExists: true,
  });

  // Step 5: Recreate FK from execution_nodes to executions with composite key
  // Note: execution_nodes already has (instance_id, execution_id) in its PK
  pgm.addConstraint('execution_nodes', 'execution_nodes_execution_fkey', {
    foreignKeys: {
      columns: ['instance_id', 'execution_id'],
      references: 'executions(instance_id, execution_id)',
      onDelete: 'CASCADE',
    },
  });
};

export const down = (pgm) => {
  // Reverse the changes
  pgm.dropConstraint('execution_nodes', 'execution_nodes_execution_fkey', { ifExists: true });
  pgm.dropIndex('executions', 'instance_id', { name: 'idx_executions_instance_id' });
  pgm.dropConstraint('executions', 'executions_pkey');
  
  // Restore original single-column PK
  pgm.addConstraint('executions', 'executions_pkey', {
    primaryKey: ['execution_id'],
  });
  
  // Restore original FK
  pgm.addConstraint('execution_nodes', 'execution_nodes_execution_id_fkey', {
    foreignKeys: {
      columns: ['execution_id'],
      references: 'executions(execution_id)',
    },
  });
};
