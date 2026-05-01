/**
 * Alerts RBAC and incident lifecycle tests.
 *
 * Uses in-memory mocks to validate permission gates and ack audit behavior
 * without a real PostgreSQL instance.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const TEST_JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars-long!!';

function signToken(payload = {}) {
  return jwt.sign(
    { sub: 'user-001', email: 'test@example.com', token_version: 0, ...payload },
    TEST_JWT_SECRET,
    { expiresIn: '10m' }
  );
}

function authCookie(token) {
  return ['Cookie', `n8n_trace_token=${token}`];
}

function createMockPool() {
  const pool = {
    _handler: () => ({ rows: [], rowCount: 0 }),
    query: jest.fn(function (...args) {
      return Promise.resolve(pool._handler(...args));
    }),
    setHandler(fn) {
      pool._handler = fn;
      pool.query.mockImplementation((...args) => Promise.resolve(fn(...args)));
    },
  };
  return pool;
}

function buildAlertsApp({ permissionsForUser, authzForUser, pool: poolOverride } = {}) {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.APP_ENV = 'development';
  process.env.ALERTS_ENABLED = 'true';

  jest.resetModules();

  const { createAlertsRouter } = require('../src/routes/alerts');

  const pool = poolOverride || createMockPool();
  const permsMap = permissionsForUser || new Map();
  const authzMap = authzForUser || new Map();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cookies = {};
    const hdr = req.headers.cookie;
    if (hdr) {
      hdr.split(';').forEach((c) => {
        const [n, ...v] = c.trim().split('=');
        req.cookies[n] = decodeURIComponent(v.join('='));
      });
    }
    next();
  });

  const requireAuth = (req, res, next) => {
    const token = req.cookies?.n8n_trace_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
      req.user = jwt.verify(token, TEST_JWT_SECRET);
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid session' });
    }
  };

  const getUserPermissions = jest.fn(async (userId) => permsMap.get(userId) || []);

  const requirePermission = (permissionKey) => async (req, res, next) => {
    const perms = permsMap.get(req.user.sub) || [];
    if (!perms.includes(permissionKey)) return res.status(403).json({ error: 'Forbidden' });
    req.permissions = perms;
    next();
  };

  const attachAuthz = async (req, _res, next) => {
    req.authz = authzMap.get(req.user.sub) || {
      isAdmin: false,
      hasAnyScopeRows: false,
      allowedWorkflowIds: [],
      hasGlobalInstanceScope: false,
      scopedInstanceIds: [],
    };
    next();
  };

  const noopLimiter = (_req, _res, next) => next();

  const deps = {
    pool,
    requireAuth,
    requirePermission,
    attachAuthz,
    getUserPermissions,
    alertsLimiter: noopLimiter,
    alertsTestLimiter: noopLimiter,
    logAudit: jest.fn(async () => {}),
    getAuditContext: jest.fn(() => ({ ip: '127.0.0.1' })),
  };

  app.use(createAlertsRouter(deps));

  return { app, pool, deps };
}

describe('Alerts RBAC', () => {
  const READER_ID = 'reader-001';
  const ACKER_ID = 'acker-001';
  const NOPERM_ID = 'noperm-001';

  const permsMap = new Map([
    [READER_ID, ['alerts.read']],
    [ACKER_ID, ['alerts.read', 'alerts.incidents.ack']],
    [NOPERM_ID, []],
  ]);

  const authzMap = new Map([
    [READER_ID, {
      isAdmin: false,
      hasAnyScopeRows: true,
      allowedWorkflowIds: ['prod-wf-001'],
      hasGlobalInstanceScope: false,
      scopedInstanceIds: ['prod'],
    }],
    [ACKER_ID, {
      isAdmin: true,
      hasAnyScopeRows: true,
      allowedWorkflowIds: [],
      hasGlobalInstanceScope: true,
      scopedInstanceIds: [],
    }],
    [NOPERM_ID, {
      isAdmin: false,
      hasAnyScopeRows: false,
      allowedWorkflowIds: [],
      hasGlobalInstanceScope: false,
      scopedInstanceIds: [],
    }],
  ]);

  let app;
  let pool;
  let deps;

  beforeEach(() => {
    const built = buildAlertsApp({ permissionsForUser: permsMap, authzForUser: authzMap });
    app = built.app;
    pool = built.pool;
    deps = built.deps;

    pool.setHandler((sql, params) => {
      if (sql.includes('COUNT(*)::int AS active_count')) {
        return {
          rows: [{ active_count: 1, info_count: 0, warning_count: 0, critical_count: 1 }],
          rowCount: 1,
        };
      }

      if (sql.includes('FROM alert_incidents i') && sql.includes('ORDER BY i.last_seen_at DESC')) {
        return {
          rows: [{
            id: 'inc-001',
            rule_id: 'rule-001',
            instance_id: 'prod',
            workflow_id: 'prod-wf-001',
            status: 'open',
            severity: 'critical',
            title: 'Workflow inactivity',
            summary: 'No execution for 7h',
            started_at: '2026-03-17T10:00:00.000Z',
            last_seen_at: '2026-03-17T11:00:00.000Z',
            resolved_at: null,
          }],
          rowCount: 1,
        };
      }

      if (sql.includes('FROM alert_notification_outbox o')) {
        return {
          rows: [{ sent_count: 4, pending_count: 1, dead_count: 0, retry_count: 1 }],
          rowCount: 1,
        };
      }

      if (sql.includes('FROM alert_incidents i') && sql.includes('WHERE i.id = $1')) {
        return {
          rows: [{
            id: params[0],
            rule_id: 'rule-001',
            status: 'open',
            severity: 'warning',
            title: 'Stuck execution',
            summary: 'Execution age 52m',
            started_at: '2026-03-17T09:10:00.000Z',
            last_seen_at: '2026-03-17T10:00:00.000Z',
            resolved_at: null,
            instance_id: 'prod',
            workflow_id: 'prod-wf-005',
          }],
          rowCount: 1,
        };
      }

      if (sql.includes('UPDATE alert_incidents') && sql.includes('RETURNING *')) {
        return {
          rows: [{
            id: params[0],
            rule_id: 'rule-001',
            status: 'acknowledged',
            severity: 'warning',
            title: 'Stuck execution',
            summary: 'Execution age 52m',
            started_at: '2026-03-17T09:10:00.000Z',
            last_seen_at: '2026-03-17T10:00:00.000Z',
            resolved_at: null,
            instance_id: 'prod',
            workflow_id: 'prod-wf-005',
          }],
          rowCount: 1,
        };
      }

      if (sql.includes('FROM alert_rule_destinations rd')) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    });
  });

  test('returns 401 for unauthenticated alerts overview', async () => {
    const res = await request(app).get('/api/alerts/overview');
    expect(res.status).toBe(401);
  });

  test('returns 403 for user without alerts.read', async () => {
    const token = signToken({ sub: NOPERM_ID });
    const res = await request(app).get('/api/alerts/overview').set(...authCookie(token));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  test('returns overview for user with alerts.read', async () => {
    const token = signToken({ sub: READER_ID });
    const res = await request(app).get('/api/alerts/overview').set(...authCookie(token));

    expect(res.status).toBe(200);
    expect(res.body.active.active_count).toBe(1);
    expect(Array.isArray(res.body.recentIncidents)).toBe(true);
    expect(res.body.deliveryHealth.sent_count).toBe(4);
  });

  test('returns 403 for acknowledge when user lacks alerts.incidents.ack', async () => {
    const token = signToken({ sub: READER_ID });
    const res = await request(app)
      .post('/api/alerts/incidents/inc-001/ack')
      .set(...authCookie(token))
      .send({ note: 'Investigating' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  test('acknowledges incident and writes audit event when user has permission', async () => {
    const token = signToken({ sub: ACKER_ID });
    const res = await request(app)
      .post('/api/alerts/incidents/inc-001/ack')
      .set(...authCookie(token))
      .send({ note: 'On-call acknowledged' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('acknowledged');

    const timelineInsert = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO alert_incident_events')
    );
    expect(timelineInsert).toBeDefined();

    const auditCall = deps.logAudit.mock.calls.find((c) => c[0] === 'alert_incident_acknowledged');
    expect(auditCall).toBeDefined();
  });
});
