/**
 * Add composite index for the primary dashboard query pattern:
 *
 *   SELECT ... FROM executions
 *   WHERE instance_id = ?
 *   ORDER BY started_at DESC
 *   LIMIT ?
 *
 * Without this index PostgreSQL must fetch ALL rows matching instance_id
 * from the PK (instance_id, execution_id) and then sort them by started_at.
 * At 90–365 day retention with moderate execution volume the sort spills
 * to disk and query time degrades significantly.
 *
 * The index stores rows in (instance_id ASC, started_at DESC) order so
 * PostgreSQL can satisfy the WHERE + ORDER BY + LIMIT with an index-only
 * backward scan — no sort step required.
 *
 * Runs as a regular CREATE INDEX (not CONCURRENTLY) because migrations
 * execute on startup before the app accepts traffic. Table locking is
 * acceptable at this stage.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.up = (pgm) => {
  pgm.createIndex('executions', [
    'instance_id',
    { name: 'started_at', sort: 'DESC' }
  ], {
    name: 'idx_executions_instance_started',
    ifNotExists: true,
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('executions', [
    'instance_id',
    { name: 'started_at', sort: 'DESC' }
  ], {
    name: 'idx_executions_instance_started',
    ifExists: true,
  });
};
