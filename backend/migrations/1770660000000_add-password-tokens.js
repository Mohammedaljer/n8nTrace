/**
 * Migration: Add user_password_tokens table for secure invite/reset flows
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  // Create user_password_tokens table
  pgm.createTable('user_password_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: '"app_users"(id)',
      onDelete: 'CASCADE',
    },
    token_hash: { type: 'text', notNull: true, unique: true },
    type: { type: 'text', notNull: true }, // 'invite_set_password' | 'reset_password'
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz', default: null },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Indexes for efficient lookups
  pgm.createIndex('user_password_tokens', 'user_id', { name: 'idx_password_tokens_user_id' });
  pgm.createIndex('user_password_tokens', 'token_hash', { name: 'idx_password_tokens_hash' });
  pgm.createIndex('user_password_tokens', 'expires_at', { name: 'idx_password_tokens_expires' });
  pgm.createIndex('user_password_tokens', 'used_at', { name: 'idx_password_tokens_used' });

  // Add check constraint for type values
  pgm.addConstraint('user_password_tokens', 'check_token_type', {
    check: "type IN ('invite_set_password', 'reset_password')",
  });

  // Optionally add password_set_at to app_users for tracking
  pgm.addColumn('app_users', {
    password_set_at: { type: 'timestamptz', default: null },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('app_users', 'password_set_at');
  pgm.dropTable('user_password_tokens');
};
