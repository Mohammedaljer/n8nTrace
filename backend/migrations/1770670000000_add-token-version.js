/**
 * Migration: Add token_version to app_users for session invalidation
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumn('app_users', {
    token_version: { type: 'integer', notNull: true, default: 0 },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('app_users', 'token_version');
};
