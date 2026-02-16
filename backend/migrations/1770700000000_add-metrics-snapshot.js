/**
 * Add n8n_metrics_snapshot table for instance health monitoring
 * 
 * This table stores periodic snapshots of n8n instance metrics
 * (memory, CPU, event loop, etc.) written by external n8n workflows.
 * The dashboard only reads from this table.
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  // Create the n8n_metrics_snapshot table
  pgm.createTable('n8n_metrics_snapshot', {
    id: { 
      type: 'bigserial', 
      primaryKey: true 
    },
    ts: { 
      type: 'timestamptz', 
      notNull: true,
      comment: 'Timestamp from workflow payload'
    },
    inserted_at: { 
      type: 'timestamptz', 
      notNull: true, 
      default: pgm.func('now()'),
      comment: 'Auto-filled by DB for retention cleanup'
    },
    instance_id: { 
      type: 'text', 
      notNull: true,
      comment: 'Instance identifier: prod, test, prod_01, dev_01, etc.'
    },
    n8n_version: { 
      type: 'text',
      comment: 'n8n application version'
    },
    node_version: { 
      type: 'text',
      comment: 'Node.js runtime version'
    },
    process_start_time_seconds: { 
      type: 'bigint',
      comment: 'Unix timestamp when n8n process started'
    },
    is_leader: { 
      type: 'boolean',
      comment: 'Whether this instance is the queue leader'
    },
    active_workflows: { 
      type: 'integer',
      comment: 'Number of currently active workflows'
    },
    cpu_total_seconds: { 
      type: 'double precision',
      comment: 'Cumulative CPU time used (counter, not rate)'
    },
    memory_rss_bytes: { 
      type: 'bigint',
      comment: 'Resident Set Size memory in bytes'
    },
    heap_used_bytes: { 
      type: 'bigint',
      comment: 'V8 heap memory used in bytes'
    },
    external_memory_bytes: { 
      type: 'bigint',
      comment: 'Memory used by C++ objects bound to JS objects'
    },
    eventloop_lag_p99_s: { 
      type: 'double precision',
      comment: 'Event loop lag p99 in seconds'
    },
    open_fds: { 
      type: 'integer',
      comment: 'Number of open file descriptors'
    }
  });

  // Index for querying by instance and time range
  pgm.createIndex('n8n_metrics_snapshot', ['instance_id', 'ts'], {
    name: 'idx_metrics_instance_ts'
  });

  // Index for querying by instance and insertion time (for retention)
  pgm.createIndex('n8n_metrics_snapshot', ['instance_id', 'inserted_at'], {
    name: 'idx_metrics_instance_inserted'
  });

  // Index for retention cleanup queries
  pgm.createIndex('n8n_metrics_snapshot', ['inserted_at'], {
    name: 'idx_metrics_inserted_at'
  });

  // Add new metrics permissions
  pgm.sql(`
    INSERT INTO permissions (key, description) VALUES 
      ('metrics.read.version', 'Read n8n version information only'),
      ('metrics.read.full', 'Read all instance metrics'),
      ('metrics.manage', 'Manage metrics access and configuration')
    ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description
  `);
};

export const down = (pgm) => {
  // Remove permissions
  pgm.sql(`
    DELETE FROM permissions WHERE key IN (
      'metrics.read.version',
      'metrics.read.full', 
      'metrics.manage'
    )
  `);

  // Drop indexes
  pgm.dropIndex('n8n_metrics_snapshot', ['inserted_at'], { name: 'idx_metrics_inserted_at' });
  pgm.dropIndex('n8n_metrics_snapshot', ['instance_id', 'inserted_at'], { name: 'idx_metrics_instance_inserted' });
  pgm.dropIndex('n8n_metrics_snapshot', ['instance_id', 'ts'], { name: 'idx_metrics_instance_ts' });

  // Drop table
  pgm.dropTable('n8n_metrics_snapshot');
};
