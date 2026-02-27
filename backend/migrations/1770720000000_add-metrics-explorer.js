/**
 * Add generic Prometheus/OpenMetrics storage model
 * 
 * This migration creates tables for storing generic time-series metrics:
 * - metrics_series: stores unique metric name + label combinations
 * - metrics_samples: stores actual time-series data points
 * 
 * Supports all Prometheus metric types: Counter, Gauge, Histogram, Summary
 * 
 * We keep n8n_metrics_snapshot for fixed KPI set, this is for everything else.
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  // =========================================================================
  // TABLE: metrics_series
  // Stores unique combinations of metric_name + labels (the "series catalog")
  // =========================================================================
  pgm.createTable('metrics_series', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
      comment: 'Unique series identifier'
    },
    instance_id: {
      type: 'text',
      notNull: true,
      comment: 'Instance identifier (e.g., prod, test, prod_01)'
    },
    metric_name: {
      type: 'text',
      notNull: true,
      comment: 'Metric name (e.g., http_requests_total, workflow_duration_seconds)'
    },
    labels: {
      type: 'jsonb',
      notNull: true,
      default: '{}',
      comment: 'Label key-value pairs (e.g., {"status":"success","workflow":"wf123"})'
    },
    labels_hash: {
      type: 'text',
      notNull: true,
      comment: 'SHA256 hash of canonical labels JSON for fast lookups'
    },
    metric_type: {
      type: 'text',
      comment: 'Prometheus metric type: gauge, counter, histogram, summary, unknown'
    },
    help: {
      type: 'text',
      comment: 'Metric description/help text'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
      comment: 'When this series was first seen'
    }
  });

  // Unique constraint: one series per instance + metric_name + labels_hash combination
  pgm.createConstraint('metrics_series', 'metrics_series_unique', {
    unique: ['instance_id', 'metric_name', 'labels_hash']
  });

  // Index for catalog queries (list metrics by instance)
  pgm.createIndex('metrics_series', ['instance_id', 'metric_name'], {
    name: 'idx_metrics_series_instance_name'
  });

  // Optional GIN index for label-based queries (if doing complex label filtering)
  pgm.createIndex('metrics_series', 'labels', {
    name: 'idx_metrics_series_labels',
    method: 'gin'
  });

  // =========================================================================
  // TABLE: metrics_samples
  // Stores actual time-series data points
  // =========================================================================
  pgm.createTable('metrics_samples', {
    series_id: {
      type: 'uuid',
      notNull: true,
      references: 'metrics_series(id)',
      onDelete: 'CASCADE',
      comment: 'Foreign key to metrics_series'
    },
    ts: {
      type: 'timestamptz',
      notNull: true,
      comment: 'Timestamp of the sample'
    },
    value: {
      type: 'double precision',
      notNull: true,
      comment: 'Metric value (gauge, counter, bucket count, quantile value)'
    }
  });

  // Primary key on (series_id, ts) for efficient time-range queries
  pgm.addConstraint('metrics_samples', 'metrics_samples_pkey', {
    primaryKey: ['series_id', 'ts']
  });

  // Index on ts for retention cleanup queries (delete old samples by timestamp)
  pgm.createIndex('metrics_samples', 'ts', {
    name: 'idx_metrics_samples_ts'
  });

  // =========================================================================
  // Note: Retention cleanup
  // The existing retention job in src/services/retention.js should be extended
  // to delete old metrics_samples rows where ts < (now() - RETENTION_DAYS).
  // No database changes needed - just service layer update.
  // =========================================================================
};

export const down = (pgm) => {
  // Drop tables (CASCADE will handle foreign keys)
  pgm.dropTable('metrics_samples', { cascade: true });
  pgm.dropTable('metrics_series', { cascade: true });
};
