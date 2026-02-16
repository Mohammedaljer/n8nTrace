/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  // Needed for gen_random_uuid()
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable('app_users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('groups', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    description: { type: 'text' },
  });

  pgm.createTable('permissions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    key: { type: 'text', notNull: true, unique: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('roles', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    key: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Insights tables
  pgm.createTable('workflows_index', {
    instance_id: { type: 'text', notNull: true },
    workflow_id: { type: 'text', notNull: true, primaryKey: true },
    name: { type: 'text', notNull: true },
    active: { type: 'boolean', notNull: true, default: false },
    is_archived: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz' },
    tags: { type: 'text' },
    nodes_count: { type: 'int4' },
    node_types: { type: 'text' },
    distinct_node_names: { type: 'text' },
    distinct_inserted_at: { type: 'timestamptz' },
  });

  pgm.createIndex('workflows_index', 'instance_id', { name: 'idx_workflows_instance_id' });

  pgm.createTable('executions', {
    instance_id: { type: 'text', notNull: true },
    execution_id: { type: 'text', notNull: true, primaryKey: true },
    workflow_id: {
      type: 'text',
      notNull: true,
      references: '"workflows_index"(workflow_id)',
    },
    status: { type: 'text', notNull: true },
    finished: { type: 'boolean', notNull: true },
    mode: { type: 'text', notNull: true },
    started_at: { type: 'timestamptz', notNull: true },
    stopped_at: { type: 'timestamptz', notNull: true },
    duration_ms: { type: 'int8', notNull: true },
    wait_till: { type: 'timestamptz' },
    retry_of: { type: 'text' },
    retry_success_id: { type: 'text' },
    last_node_executed: { type: 'text' },
    node_names_executed: { type: 'text' },
    nodes_count: { type: 'int4' },
    inserted_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  pgm.createIndex('executions', ['status', 'started_at'], { name: 'idx_executions_status_started' });
  pgm.createIndex('executions', 'workflow_id', { name: 'idx_executions_workflow_id' });

  // RBAC join tables
  pgm.createTable('group_roles', {
    group_id: {
      type: 'uuid',
      notNull: true,
      references: '"groups"(id)',
      onDelete: 'CASCADE',
    },
    role_id: {
      type: 'uuid',
      notNull: true,
      references: '"roles"(id)',
      onDelete: 'CASCADE',
    },
  }, {
    constraints: {
      primaryKey: ['group_id', 'role_id'],
    },
  });

  pgm.createTable('role_permissions', {
    role_id: {
      type: 'uuid',
      notNull: true,
      references: '"roles"(id)',
      onDelete: 'CASCADE',
    },
    permission_id: {
      type: 'uuid',
      notNull: true,
      references: '"permissions"(id)',
      onDelete: 'CASCADE',
    },
  }, {
    constraints: {
      primaryKey: ['role_id', 'permission_id'],
    },
  });

  pgm.createTable('user_groups', {
    user_id: {
      type: 'uuid',
      notNull: true,
      references: '"app_users"(id)',
      onDelete: 'CASCADE',
    },
    group_id: {
      type: 'uuid',
      notNull: true,
      references: '"groups"(id)',
      onDelete: 'CASCADE',
    },
  }, {
    constraints: {
      primaryKey: ['user_id', 'group_id'],
    },
  });

  pgm.createTable('group_scopes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    group_id: {
      type: 'uuid',
      notNull: true,
      references: '"groups"(id)',
      onDelete: 'CASCADE',
    },
    instance_id: { type: 'text' },
    workflow_id: { type: 'text' },
    tag: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('group_scopes', 'group_scopes_unique', {
    unique: ['group_id', 'instance_id', 'workflow_id', 'tag'],
  });
  pgm.createIndex('group_scopes', 'group_id', { name: 'idx_group_scopes_group' });

  // This table exists in your DB; we keep it as-is.
  pgm.createTable('user_scopes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: '"app_users"(id)',
      onDelete: 'CASCADE',
    },
    instance_id: { type: 'text' },
    workflow_id: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('user_scopes', 'user_id', { name: 'idx_user_scopes_user' });

  // execution_nodes
  pgm.createTable('execution_nodes', {
    instance_id: { type: 'text', notNull: true },
    execution_id: {
      type: 'text',
      notNull: true,
      references: '"executions"(execution_id)',
    },
    workflow_id: {
      type: 'text',
      notNull: true,
      references: '"workflows_index"(workflow_id)',
    },
    node_name: { type: 'text', notNull: true },
    node_type: { type: 'text', notNull: true },
    run_index: { type: 'int4', notNull: true, default: 0 },
    runs_count: { type: 'int4', notNull: true, default: 1 },
    is_last_run: { type: 'boolean', notNull: true, default: false },
    execution_status: { type: 'text', notNull: true },
    execution_time_ms: { type: 'int8', notNull: true, default: 0 },
    start_time_ms: { type: 'int8' },
    start_time: { type: 'timestamptz' },
    items_out_count: { type: 'int4' },
    items_out_total_all_runs: { type: 'int4' },
    inserted_at: { type: 'timestamptz', default: pgm.func('now()') },
  }, {
    constraints: {
      primaryKey: ['instance_id', 'execution_id', 'node_name', 'run_index'],
    },
  });

  pgm.createIndex('execution_nodes', 'execution_id', { name: 'idx_execution_nodes_execution_id' });
};

export const down = (pgm) => {
  pgm.dropTable('execution_nodes');
  pgm.dropTable('user_scopes');
  pgm.dropTable('group_scopes');
  pgm.dropTable('user_groups');
  pgm.dropTable('role_permissions');
  pgm.dropTable('group_roles');
  pgm.dropTable('executions');
  pgm.dropTable('workflows_index');
  pgm.dropTable('roles');
  pgm.dropTable('permissions');
  pgm.dropTable('groups');
  pgm.dropTable('app_users');

};
