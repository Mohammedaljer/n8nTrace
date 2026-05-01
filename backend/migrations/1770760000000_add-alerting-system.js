/**
 * Add full alerting subsystem schema.
 *
 * Includes:
 * - Rules, selectors, destinations
 * - Incident lifecycle and events
 * - Evaluation state and notification outbox
 * - Workflow alert profile for template/test/inactivity defaults
 * - Alert RBAC permissions
 */
exports.up = (pgm) => {
  pgm.createTable('workflow_alert_profile', {
    workflow_id: {
      type: 'text',
      notNull: true,
      primaryKey: true,
      references: 'workflows_index(workflow_id)',
      onDelete: 'CASCADE',
    },
    instance_id: { type: 'text', notNull: true },
    is_template: { type: 'boolean', notNull: true, default: false },
    is_test: { type: 'boolean', notNull: true, default: false },
    inactivity_exempt: { type: 'boolean', notNull: true, default: false },
    source: { type: 'text', notNull: true, default: 'auto' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('workflow_alert_profile', ['instance_id'], { name: 'idx_wf_alert_profile_instance' });
  pgm.createIndex('workflow_alert_profile', ['inactivity_exempt'], { name: 'idx_wf_alert_profile_exempt' });

  pgm.createTable('alert_rules', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    rule_type: { type: 'text', notNull: true },
    severity: { type: 'text', notNull: true, default: 'warning' },
    enabled: { type: 'boolean', notNull: true, default: true },
    evaluation_interval_sec: { type: 'integer', notNull: true, default: 300 },
    cooldown_sec: { type: 'integer', notNull: true, default: 600 },
    open_after_n: { type: 'integer', notNull: true, default: 1 },
    resolve_after_n: { type: 'integer', notNull: true, default: 1 },
    apply_default_exclusions: { type: 'boolean', notNull: true, default: true },
    config: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    next_eval_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_eval_at: { type: 'timestamptz' },
    lease_owner: { type: 'text' },
    lease_expires_at: { type: 'timestamptz' },
    created_by: { type: 'uuid', references: 'app_users(id)', onDelete: 'SET NULL' },
    updated_by: { type: 'uuid', references: 'app_users(id)', onDelete: 'SET NULL' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('alert_rules', 'alert_rules_type_check', {
    check: "rule_type IN ('workflow_inactivity', 'stuck_execution', 'metrics_freshness')",
  });
  pgm.addConstraint('alert_rules', 'alert_rules_severity_check', {
    check: "severity IN ('info', 'warning', 'critical')",
  });
  pgm.addConstraint('alert_rules', 'alert_rules_eval_interval_check', {
    check: 'evaluation_interval_sec >= 15',
  });
  pgm.addConstraint('alert_rules', 'alert_rules_open_after_check', {
    check: 'open_after_n >= 1',
  });
  pgm.addConstraint('alert_rules', 'alert_rules_resolve_after_check', {
    check: 'resolve_after_n >= 1',
  });
  pgm.createIndex('alert_rules', ['enabled', 'next_eval_at'], { name: 'idx_alert_rules_due' });
  pgm.createIndex('alert_rules', ['lease_expires_at'], { name: 'idx_alert_rules_lease' });

  pgm.createTable('alert_rule_selectors', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    rule_id: {
      type: 'uuid',
      notNull: true,
      references: 'alert_rules(id)',
      onDelete: 'CASCADE',
    },
    selector_mode: { type: 'text', notNull: true },
    selector_kind: { type: 'text', notNull: true },
    selector_value: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('alert_rule_selectors', 'alert_rule_selectors_mode_check', {
    check: "selector_mode IN ('include', 'exclude')",
  });
  pgm.addConstraint('alert_rule_selectors', 'alert_rule_selectors_kind_check', {
    check: "selector_kind IN ('workflow_id', 'tag', 'instance_id', 'name_pattern')",
  });
  pgm.addConstraint('alert_rule_selectors', 'alert_rule_selectors_unique', {
    unique: ['rule_id', 'selector_mode', 'selector_kind', 'selector_value'],
  });
  pgm.createIndex('alert_rule_selectors', ['rule_id'], { name: 'idx_alert_rule_selectors_rule' });

  pgm.createTable('alert_destinations', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    type: { type: 'text', notNull: true, default: 'webhook' },
    enabled: { type: 'boolean', notNull: true, default: true },
    webhook_url: { type: 'text', notNull: true },
    secret_encrypted: { type: 'text' },
    headers: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    timeout_ms: { type: 'integer', notNull: true, default: 5000 },
    retry_max_attempts: { type: 'integer', notNull: true, default: 6 },
    created_by: { type: 'uuid', references: 'app_users(id)', onDelete: 'SET NULL' },
    updated_by: { type: 'uuid', references: 'app_users(id)', onDelete: 'SET NULL' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('alert_destinations', 'alert_destinations_type_check', {
    check: "type IN ('webhook')",
  });
  pgm.createIndex('alert_destinations', ['enabled'], { name: 'idx_alert_destinations_enabled' });

  pgm.createTable('alert_rule_destinations', {
    rule_id: {
      type: 'uuid',
      notNull: true,
      references: 'alert_rules(id)',
      onDelete: 'CASCADE',
    },
    destination_id: {
      type: 'uuid',
      notNull: true,
      references: 'alert_destinations(id)',
      onDelete: 'CASCADE',
    },
    notify_on_open: { type: 'boolean', notNull: true, default: true },
    notify_on_resolve: { type: 'boolean', notNull: true, default: true },
    notify_on_ack: { type: 'boolean', notNull: true, default: false },
    min_severity: { type: 'text', notNull: true, default: 'info' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, {
    constraints: {
      primaryKey: ['rule_id', 'destination_id'],
    },
  });
  pgm.addConstraint('alert_rule_destinations', 'alert_rule_destinations_severity_check', {
    check: "min_severity IN ('info', 'warning', 'critical')",
  });

  pgm.createTable('alert_incidents', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    rule_id: {
      type: 'uuid',
      notNull: true,
      references: 'alert_rules(id)',
      onDelete: 'CASCADE',
    },
    fingerprint: { type: 'text', notNull: true },
    instance_id: { type: 'text' },
    workflow_id: { type: 'text', references: 'workflows_index(workflow_id)', onDelete: 'SET NULL' },
    status: { type: 'text', notNull: true, default: 'open' },
    severity: { type: 'text', notNull: true, default: 'warning' },
    title: { type: 'text', notNull: true },
    summary: { type: 'text' },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    resolved_at: { type: 'timestamptz' },
    acknowledged_at: { type: 'timestamptz' },
    acknowledged_by: { type: 'uuid', references: 'app_users(id)', onDelete: 'SET NULL' },
    acknowledge_note: { type: 'text' },
    suppressed_until: { type: 'timestamptz' },
    details: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('alert_incidents', 'alert_incidents_status_check', {
    check: "status IN ('open', 'acknowledged', 'resolved', 'suppressed')",
  });
  pgm.addConstraint('alert_incidents', 'alert_incidents_severity_check', {
    check: "severity IN ('info', 'warning', 'critical')",
  });
  pgm.createIndex('alert_incidents', ['status', 'last_seen_at'], { name: 'idx_alert_incidents_status_seen' });
  pgm.createIndex('alert_incidents', ['severity', 'status'], { name: 'idx_alert_incidents_severity_status' });
  pgm.createIndex('alert_incidents', ['workflow_id'], { name: 'idx_alert_incidents_workflow' });
  pgm.createIndex('alert_incidents', ['instance_id'], { name: 'idx_alert_incidents_instance' });
  pgm.sql(`
    CREATE UNIQUE INDEX idx_alert_incidents_active_unique
    ON alert_incidents (rule_id, fingerprint)
    WHERE status IN ('open', 'acknowledged', 'suppressed')
  `);

  pgm.createTable('alert_incident_events', {
    id: { type: 'bigserial', primaryKey: true },
    incident_id: {
      type: 'uuid',
      notNull: true,
      references: 'alert_incidents(id)',
      onDelete: 'CASCADE',
    },
    event_type: { type: 'text', notNull: true },
    actor_user_id: { type: 'uuid', references: 'app_users(id)', onDelete: 'SET NULL' },
    note: { type: 'text' },
    event_data: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('alert_incident_events', 'alert_incident_events_type_check', {
    check: "event_type IN ('open', 'acknowledged', 'resolved', 'suppressed', 'reopened', 'notified', 'note')",
  });
  pgm.createIndex('alert_incident_events', ['incident_id', 'created_at'], { name: 'idx_alert_incident_events_timeline' });

  pgm.createTable('alert_evaluation_state', {
    rule_id: {
      type: 'uuid',
      notNull: true,
      references: 'alert_rules(id)',
      onDelete: 'CASCADE',
    },
    target_fingerprint: { type: 'text', notNull: true },
    instance_id: { type: 'text' },
    workflow_id: { type: 'text', references: 'workflows_index(workflow_id)', onDelete: 'SET NULL' },
    consecutive_breach: { type: 'integer', notNull: true, default: 0 },
    consecutive_ok: { type: 'integer', notNull: true, default: 0 },
    last_value: { type: 'double precision' },
    last_message: { type: 'text' },
    last_eval_at: { type: 'timestamptz' },
    last_notification_at: { type: 'timestamptz' },
    suppressed_until: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, {
    constraints: {
      primaryKey: ['rule_id', 'target_fingerprint'],
    },
  });
  pgm.createIndex('alert_evaluation_state', ['workflow_id'], { name: 'idx_alert_eval_state_workflow' });
  pgm.createIndex('alert_evaluation_state', ['instance_id'], { name: 'idx_alert_eval_state_instance' });

  pgm.createTable('alert_notification_outbox', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    incident_id: {
      type: 'uuid',
      notNull: true,
      references: 'alert_incidents(id)',
      onDelete: 'CASCADE',
    },
    rule_id: {
      type: 'uuid',
      notNull: true,
      references: 'alert_rules(id)',
      onDelete: 'CASCADE',
    },
    destination_id: {
      type: 'uuid',
      notNull: true,
      references: 'alert_destinations(id)',
      onDelete: 'CASCADE',
    },
    event_type: { type: 'text', notNull: true },
    dedupe_key: { type: 'text', notNull: true, unique: true },
    payload: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    status: { type: 'text', notNull: true, default: 'pending' },
    attempt_count: { type: 'integer', notNull: true, default: 0 },
    max_attempts: { type: 'integer', notNull: true, default: 6 },
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    lease_owner: { type: 'text' },
    lease_expires_at: { type: 'timestamptz' },
    last_error: { type: 'text' },
    last_response_status: { type: 'integer' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('alert_notification_outbox', 'alert_notification_outbox_status_check', {
    check: "status IN ('pending', 'sending', 'retry', 'sent', 'dead')",
  });
  pgm.addConstraint('alert_notification_outbox', 'alert_notification_outbox_event_type_check', {
    check: "event_type IN ('open', 'resolved', 'acknowledged', 'reminder', 'test')",
  });
  pgm.createIndex('alert_notification_outbox', ['status', 'next_attempt_at'], { name: 'idx_alert_outbox_due' });
  pgm.createIndex('alert_notification_outbox', ['lease_expires_at'], { name: 'idx_alert_outbox_lease' });
  pgm.createIndex('alert_notification_outbox', ['incident_id'], { name: 'idx_alert_outbox_incident' });

  pgm.createTable('alert_notification_attempts', {
    id: { type: 'bigserial', primaryKey: true },
    outbox_id: {
      type: 'uuid',
      notNull: true,
      references: 'alert_notification_outbox(id)',
      onDelete: 'CASCADE',
    },
    attempt_no: { type: 'integer', notNull: true },
    attempted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    success: { type: 'boolean', notNull: true },
    response_status: { type: 'integer' },
    response_body: { type: 'text' },
    error: { type: 'text' },
    latency_ms: { type: 'integer' },
  });
  pgm.createIndex('alert_notification_attempts', ['outbox_id', 'attempt_no'], { name: 'idx_alert_attempts_outbox' });

  pgm.sql(`
    INSERT INTO permissions (key, description) VALUES
      ('alerts.read', 'Read alerts pages, incidents, and widgets'),
      ('alerts.rules.manage', 'Create, update, enable, disable, and delete alert rules'),
      ('alerts.incidents.ack', 'Acknowledge alert incidents'),
      ('alerts.destinations.manage', 'Manage alert destinations and routing'),
      ('alerts.destinations.test', 'Send test webhooks for alert destinations'),
      ('alerts.history.read', 'Read alert delivery history and incident timeline')
    ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description
  `);

  pgm.sql(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    JOIN permissions p ON p.key IN (
      'alerts.read',
      'alerts.rules.manage',
      'alerts.incidents.ack',
      'alerts.destinations.manage',
      'alerts.destinations.test',
      'alerts.history.read'
    )
    WHERE r.key = 'admin'
    ON CONFLICT DO NOTHING
  `);

  pgm.sql(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    JOIN permissions p ON p.key IN (
      'alerts.read',
      'alerts.incidents.ack',
      'alerts.history.read'
    )
    WHERE r.key = 'analyst'
    ON CONFLICT DO NOTHING
  `);

  pgm.sql(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    JOIN permissions p ON p.key IN ('alerts.read')
    WHERE r.key = 'viewer'
    ON CONFLICT DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM role_permissions
    WHERE permission_id IN (
      SELECT id FROM permissions WHERE key IN (
        'alerts.read',
        'alerts.rules.manage',
        'alerts.incidents.ack',
        'alerts.destinations.manage',
        'alerts.destinations.test',
        'alerts.history.read'
      )
    )
  `);

  pgm.sql(`
    DELETE FROM permissions WHERE key IN (
      'alerts.read',
      'alerts.rules.manage',
      'alerts.incidents.ack',
      'alerts.destinations.manage',
      'alerts.destinations.test',
      'alerts.history.read'
    )
  `);

  pgm.dropTable('alert_notification_attempts');
  pgm.dropTable('alert_notification_outbox');
  pgm.dropTable('alert_evaluation_state');
  pgm.dropTable('alert_incident_events');
  pgm.sql('DROP INDEX IF EXISTS idx_alert_incidents_active_unique');
  pgm.dropTable('alert_incidents');
  pgm.dropTable('alert_rule_destinations');
  pgm.dropTable('alert_destinations');
  pgm.dropTable('alert_rule_selectors');
  pgm.dropTable('alert_rules');
  pgm.dropTable('workflow_alert_profile');
};
