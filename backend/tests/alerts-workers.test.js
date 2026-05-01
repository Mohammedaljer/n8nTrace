/**
 * Alerts worker behavior tests.
 *
 * Focuses on scheduler loop primitives (evaluator/delivery/maintenance)
 * using in-memory DB mocks.
 */

function makeConnectClient(handler) {
  return {
    query: jest.fn(async (...args) => handler(...args)),
    release: jest.fn(),
  };
}

describe('Alerts workers', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.APP_ENV = 'development';
    process.env.ALERTS_ENABLED = 'true';
    process.env.ALERTS_SECRET_KEY = '';
  });

  test('runMaintenanceOnce executes maintenance SQL passes', async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const pool = { query };

    const { runMaintenanceOnce } = require('../src/services/alertsWorkers');
    await runMaintenanceOnce(pool);

    expect(query).toHaveBeenCalled();

    const sqlCalls = query.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls.some((s) => s.includes('INSERT INTO workflow_alert_profile'))).toBe(true);
    expect(sqlCalls.some((s) => s.includes('UPDATE alert_rules'))).toBe(true);
    expect(sqlCalls.some((s) => s.includes('UPDATE alert_notification_outbox'))).toBe(true);
  });

  test('runEvaluatorOnce claims due rules safely when none are due', async () => {
    const pool = {
      query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
      connect: jest.fn(async () => {
        const client = makeConnectClient(async (sql) => {
          if (String(sql).includes('WITH due AS')) return { rows: [] };
          return { rows: [], rowCount: 0 };
        });
        return client;
      }),
    };

    const { runEvaluatorOnce } = require('../src/services/alertsWorkers');
    await runEvaluatorOnce(pool, 'worker-test-1');

    expect(pool.connect).toHaveBeenCalledTimes(1);
  });

  test('runDeliveryOnce claims due outbox jobs safely when queue is empty', async () => {
    const pool = {
      query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
      connect: jest.fn(async () => {
        const client = makeConnectClient(async (sql) => {
          if (String(sql).includes('WITH due AS')) return { rows: [] };
          return { rows: [], rowCount: 0 };
        });
        return client;
      }),
    };

    const { runDeliveryOnce } = require('../src/services/alertsWorkers');
    await runDeliveryOnce(pool, 'worker-test-2');

    expect(pool.connect).toHaveBeenCalledTimes(1);
  });
});
