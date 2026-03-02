/**
 * Add account-lockout columns to app_users.
 *
 * Tracks failed login attempts and supports time-based account lockout
 * to mitigate brute-force / credential-stuffing attacks.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.up = (pgm) => {
  pgm.addColumns('app_users', {
    failed_login_attempts: {
      type: 'integer',
      notNull: true,
      default: 0,
      comment: 'Number of consecutive failed login attempts',
    },
    locked_until: {
      type: 'timestamptz',
      default: null,
      comment: 'Account locked until this timestamp (null = not locked)',
    },
    last_failed_login_at: {
      type: 'timestamptz',
      default: null,
      comment: 'Timestamp of last failed login attempt',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('app_users', [
    'failed_login_attempts',
    'locked_until',
    'last_failed_login_at',
  ]);
};
