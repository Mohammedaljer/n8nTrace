/**
 * Add alert retention controls:
 * - Global defaults managed in-app (no docker env changes)
 * - Per-rule overrides for resolved and unresolved incidents
 */
exports.up = (pgm) => {
  pgm.addColumns('alert_rules', {
    retention_resolved_days: { type: 'integer' },
    retention_unresolved_days: { type: 'integer' },
  });

  pgm.addConstraint('alert_rules', 'alert_rules_retention_resolved_days_check', {
    check: 'retention_resolved_days IS NULL OR retention_resolved_days >= 1',
  });

  pgm.addConstraint('alert_rules', 'alert_rules_retention_unresolved_days_check', {
    check: 'retention_unresolved_days IS NULL OR retention_unresolved_days >= 1',
  });

  pgm.createTable('alert_retention_settings', {
    id: { type: 'boolean', primaryKey: true, notNull: true, default: true },
    resolved_days_default: { type: 'integer', notNull: true, default: 30 },
    unresolved_days_default: { type: 'integer', notNull: true, default: 180 },
    updated_by: { type: 'uuid', references: 'app_users(id)', onDelete: 'SET NULL' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('alert_retention_settings', 'alert_retention_settings_singleton_check', {
    check: 'id = true',
  });

  pgm.addConstraint('alert_retention_settings', 'alert_retention_settings_resolved_days_check', {
    check: 'resolved_days_default >= 1',
  });

  pgm.addConstraint('alert_retention_settings', 'alert_retention_settings_unresolved_days_check', {
    check: 'unresolved_days_default >= 1',
  });

  pgm.sql(`
    INSERT INTO alert_retention_settings (id, resolved_days_default, unresolved_days_default)
    VALUES (true, 30, 180)
    ON CONFLICT (id) DO NOTHING
  `);

  pgm.createIndex('alert_incidents', ['status', 'resolved_at'], { name: 'idx_alert_incidents_status_resolved' });
};

exports.down = (pgm) => {
  pgm.dropIndex('alert_incidents', ['status', 'resolved_at'], { name: 'idx_alert_incidents_status_resolved' });

  pgm.dropTable('alert_retention_settings');

  pgm.dropConstraint('alert_rules', 'alert_rules_retention_unresolved_days_check');
  pgm.dropConstraint('alert_rules', 'alert_rules_retention_resolved_days_check');

  pgm.dropColumns('alert_rules', ['retention_resolved_days', 'retention_unresolved_days']);
};
