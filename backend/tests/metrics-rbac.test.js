/**
 * RBAC & Metrics access-control tests.
 *
 * Verifies:
 *   1. Permission enforcement on data routes (requirePermission)
 *   2. Admin vs scoped-user data filtering (attachAuthz)
 *   3. Metrics /config returns correct flags per role
 *   4. Metrics endpoints respect METRICS_ENABLED feature flag
 *   5. Default-deny for users with no scopes
 *
 * Uses in-memory mocks — no PostgreSQL required.
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const TEST_JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars-long!!';

// ── Helpers ───────────────────────────────────────────────────────────────

function signToken(payload = {}) {
  return jwt.sign(
    { sub: 'user-aaa', email: 'test@example.com', token_version: 0, ...payload },
    TEST_JWT_SECRET,
    { expiresIn: '10m' },
  );
}

function createMockPool() {
  const pool = {
    _handler: () => ({ rows: [], rowCount: 0 }),
    query: jest.fn(function (...args) { return Promise.resolve(pool._handler(...args)); }),
    setHandler(fn) {
      pool._handler = fn;
      pool.query.mockImplementation((...args) => Promise.resolve(fn(...args)));
    },
  };
  return pool;
}

const noopLimiter = (_req, _res, next) => next();

/**
 * requireAuth — validates JWT cookie.
 */
function mockRequireAuth() {
  return (req, res, next) => {
    const token = req.cookies?.n8n_trace_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
      req.user = jwt.verify(token, TEST_JWT_SECRET);
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid session' });
    }
  };
}

/**
 * requirePermission — returns middleware that checks the permission map.
 */
function makeRequirePermission(permissionsForUser) {
  return (permissionKey) => async (req, res, next) => {
    const perms = permissionsForUser.get(req.user.sub) || [];
    if (!perms.includes(permissionKey)) return res.status(403).json({ error: 'Forbidden' });
    req.permissions = perms;
    next();
  };
}

function makeGetUserPermissions(permissionsForUser) {
  return jest.fn(async (userId) => permissionsForUser.get(userId) || []);
}

function makeAttachAuthz(authzForUser) {
  return async (req, _res, next) => {
    const userId = req.user?.sub;
    req.authz = authzForUser.get(userId) || {
      isAdmin: false, allowedWorkflowIds: [], hasAnyScopeRows: false,
    };
    next();
  };
}

function makeGetAuthorizationContext(authzForUser) {
  return async (req) => {
    const userId = req.user?.sub;
    return authzForUser.get(userId) || {
      isAdmin: false, allowedWorkflowIds: [], hasAnyScopeRows: false,
      hasExplicitInstanceScope: false, hasGlobalInstanceScope: false,
      scopedInstanceIds: [],
    };
  };
}

// ── Build a test app with data + metrics routers ─────────────────────────

function buildTestApp({ permissionsForUser, authzForUser, pool: poolOverride, metricsEnabled = true } = {}) {
  // Set env BEFORE resetting modules so config picks up current values
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.APP_ENV = 'development';
  process.env.METRICS_ENABLED = metricsEnabled ? 'true' : 'false';
  process.env.METRICS_MAX_TIME_RANGE_DAYS = '30';
  process.env.METRICS_MAX_DATAPOINTS = '1000';

  // Force-reload config + routers so METRICS_ENABLED is re-evaluated
  jest.resetModules();

  const { createDataRouter } = require('../src/routes/data');
  const { createMetricsRouter } = require('../src/routes/metrics');

  const pool = poolOverride || createMockPool();
  const permsMap = permissionsForUser || new Map();
  const authzMap = authzForUser || new Map();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const deps = {
    pool,
    state: { dbReady: true },
    requireAuth: mockRequireAuth(),
    requirePermission: makeRequirePermission(permsMap),
    attachAuthz: makeAttachAuthz(authzMap),
    getUserPermissions: makeGetUserPermissions(permsMap),
    getAuthorizationContext: makeGetAuthorizationContext(authzMap),
    metricsLimiter: noopLimiter,
    loginLimiter: noopLimiter,
    adminApiLimiter: noopLimiter,
    authSessionLimiter: noopLimiter,
    logAudit: jest.fn(async () => {}),
    getAuditContext: jest.fn(() => ({ ip: '127.0.0.1' })),
  };

  app.use(createDataRouter(deps));
  app.use(createMetricsRouter(deps));

  return { app, pool, deps };
}

function authCookie(token) {
  return ['Cookie', `n8n_trace_token=${token}`];
}

// ═════════════════════════════════════════════════════════════════════════
//  TEST SUITES
// ═════════════════════════════════════════════════════════════════════════

describe('RBAC — permission enforcement', () => {
  const ADMIN_ID = 'admin-001';
  const VIEWER_ID = 'viewer-001';
  const NOPERM_ID = 'noperm-001';

  const permsMap = new Map([
    [ADMIN_ID, ['admin:users', 'admin:roles', 'admin:groups', 'read:workflows', 'read:executions', 'read:nodes', 'export:data', 'metrics.read.version', 'metrics.read.full', 'metrics.manage']],
    [VIEWER_ID, ['read:workflows', 'read:executions', 'read:nodes', 'metrics.read.version']],
    [NOPERM_ID, []],
  ]);

  const authzMap = new Map([
    [ADMIN_ID, { isAdmin: true, allowedWorkflowIds: null, hasAnyScopeRows: true }],
    [VIEWER_ID, { isAdmin: false, allowedWorkflowIds: ['wf-001', 'wf-002'], hasAnyScopeRows: true }],
    [NOPERM_ID, { isAdmin: false, allowedWorkflowIds: [], hasAnyScopeRows: false }],
  ]);

  let app, pool;

  beforeAll(() => {
    const built = buildTestApp({ permissionsForUser: permsMap, authzForUser: authzMap });
    app = built.app;
    pool = built.pool;
    // Default DB response: empty rows
    pool.setHandler(() => ({ rows: [], rowCount: 0 }));
  });

  // ── Unauthenticated ──────────────────────────────────────────────────

  test('returns 401 for unauthenticated request to /api/workflows', async () => {
    const res = await request(app).get('/api/workflows');
    expect(res.status).toBe(401);
  });

  test('returns 401 for unauthenticated request to /api/metrics/config', async () => {
    const res = await request(app).get('/api/metrics/config');
    expect(res.status).toBe(401);
  });

  // ── No-permission user ───────────────────────────────────────────────

  test('returns 403 for user without read:workflows permission', async () => {
    const token = signToken({ sub: NOPERM_ID });
    const res = await request(app)
      .get('/api/workflows')
      .set(...authCookie(token));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  test('returns 403 for user without read:executions permission', async () => {
    const token = signToken({ sub: NOPERM_ID });
    const res = await request(app)
      .get('/api/executions')
      .set(...authCookie(token));
    expect(res.status).toBe(403);
  });

  test('returns 403 for user without read:nodes permission', async () => {
    const token = signToken({ sub: NOPERM_ID });
    const res = await request(app)
      .get('/api/execution-nodes')
      .set(...authCookie(token));
    expect(res.status).toBe(403);
  });

  // ── Viewer can access data routes ────────────────────────────────────

  test('viewer can access /api/workflows (200)', async () => {
    const token = signToken({ sub: VIEWER_ID });
    const res = await request(app)
      .get('/api/workflows')
      .set(...authCookie(token));
    expect(res.status).toBe(200);
  });

  test('viewer can access /api/executions (200)', async () => {
    const token = signToken({ sub: VIEWER_ID });
    const res = await request(app)
      .get('/api/executions')
      .set(...authCookie(token));
    expect(res.status).toBe(200);
  });

  // ── Admin can access everything ──────────────────────────────────────

  test('admin can access /api/workflows (200)', async () => {
    const token = signToken({ sub: ADMIN_ID });
    const res = await request(app)
      .get('/api/workflows')
      .set(...authCookie(token));
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════

describe('RBAC — data scoping (admin vs scoped user)', () => {
  const ADMIN_ID = 'admin-001';
  const SCOPED_ID = 'scoped-001';
  const NOSCOPE_ID = 'noscope-001';

  const permsMap = new Map([
    [ADMIN_ID, ['admin:users', 'read:workflows', 'read:executions', 'read:nodes']],
    [SCOPED_ID, ['read:workflows', 'read:executions', 'read:nodes']],
    [NOSCOPE_ID, ['read:workflows', 'read:executions', 'read:nodes']],
  ]);

  const authzMap = new Map([
    [ADMIN_ID, { isAdmin: true, allowedWorkflowIds: null, hasAnyScopeRows: true }],
    [SCOPED_ID, { isAdmin: false, allowedWorkflowIds: ['wf-001', 'wf-002'], hasAnyScopeRows: true }],
    [NOSCOPE_ID, { isAdmin: false, allowedWorkflowIds: [], hasAnyScopeRows: false }],
  ]);

  let app, pool;

  beforeAll(() => {
    const built = buildTestApp({ permissionsForUser: permsMap, authzForUser: authzMap });
    app = built.app;
    pool = built.pool;
  });

  // ── Default deny ─────────────────────────────────────────────────────

  test('user with no scopes gets empty array for /api/workflows (default deny)', async () => {
    pool.setHandler(() => ({ rows: [{ workflow_id: 'wf-999' }], rowCount: 1 }));
    const token = signToken({ sub: NOSCOPE_ID });
    const res = await request(app)
      .get('/api/workflows')
      .set(...authCookie(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('user with no scopes gets empty array for /api/executions (default deny)', async () => {
    const token = signToken({ sub: NOSCOPE_ID });
    const res = await request(app)
      .get('/api/executions')
      .set(...authCookie(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('user with no scopes gets empty array for /api/execution-nodes (default deny)', async () => {
    const token = signToken({ sub: NOSCOPE_ID });
    const res = await request(app)
      .get('/api/execution-nodes')
      .set(...authCookie(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // ── Scoped user gets filtered results ────────────────────────────────

  test('scoped user query includes workflow_id = ANY filter', async () => {
    pool.setHandler(() => ({ rows: [], rowCount: 0 }));
    const token = signToken({ sub: SCOPED_ID });
    await request(app)
      .get('/api/workflows')
      .set(...authCookie(token));

    // Find the SQL query that includes the ANY filter
    const scopedCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('ANY')
    );
    expect(scopedCall).toBeDefined();
    // The workflow IDs parameter should contain the scoped list
    const wfParam = scopedCall[1].find((p) => Array.isArray(p));
    expect(wfParam).toEqual(['wf-001', 'wf-002']);
  });

  // ── Admin gets unscoped query ────────────────────────────────────────

  test('admin query does NOT include workflow_id = ANY filter', async () => {
    pool.query.mockClear();
    pool.setHandler(() => ({ rows: [], rowCount: 0 }));
    const token = signToken({ sub: ADMIN_ID });
    await request(app)
      .get('/api/workflows')
      .set(...authCookie(token));

    const adminCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('workflows_index')
    );
    expect(adminCall).toBeDefined();
    // Admin query should NOT have ANY() for workflow scoping
    expect(adminCall[0]).not.toContain('ANY');
  });
});

// ═════════════════════════════════════════════════════════════════════════

describe('Metrics — /api/metrics/config', () => {
  const ADMIN_ID = 'admin-001';
  const VIEWER_ID = 'viewer-001';
  const ANALYST_ID = 'analyst-001';

  const permsMap = new Map([
    [ADMIN_ID, ['admin:users', 'metrics.read.version', 'metrics.read.full', 'metrics.manage']],
    [ANALYST_ID, ['read:workflows', 'metrics.read.version', 'metrics.read.full']],
    [VIEWER_ID, ['read:workflows', 'metrics.read.version']],
  ]);

  test('admin gets all metric flags true', async () => {
    const { app } = buildTestApp({ permissionsForUser: permsMap, metricsEnabled: true });
    const token = signToken({ sub: ADMIN_ID });
    const res = await request(app)
      .get('/api/metrics/config')
      .set(...authCookie(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      hasVersionPermission: true,
      hasFullPermission: true,
      hasManagePermission: true,
      canCustomizeDashboard: true,
      maxTimeRangeDays: 30,
      maxDatapoints: 1000,
    });
  });

  test('analyst gets version + full but NOT manage', async () => {
    const { app } = buildTestApp({ permissionsForUser: permsMap, metricsEnabled: true });
    const token = signToken({ sub: ANALYST_ID });
    const res = await request(app)
      .get('/api/metrics/config')
      .set(...authCookie(token));

    expect(res.status).toBe(200);
    expect(res.body.hasVersionPermission).toBe(true);
    expect(res.body.hasFullPermission).toBe(true);
    expect(res.body.hasManagePermission).toBe(false);
  });

  test('viewer gets version only', async () => {
    const { app } = buildTestApp({ permissionsForUser: permsMap, metricsEnabled: true });
    const token = signToken({ sub: VIEWER_ID });
    const res = await request(app)
      .get('/api/metrics/config')
      .set(...authCookie(token));

    expect(res.status).toBe(200);
    expect(res.body.hasVersionPermission).toBe(true);
    expect(res.body.hasFullPermission).toBe(false);
    expect(res.body.hasManagePermission).toBe(false);
    expect(res.body.canCustomizeDashboard).toBe(true);
  });

  test('returns enabled=false when METRICS_ENABLED is off', async () => {
    const { app } = buildTestApp({ permissionsForUser: permsMap, metricsEnabled: false });
    const token = signToken({ sub: ADMIN_ID });
    const res = await request(app)
      .get('/api/metrics/config')
      .set(...authCookie(token));

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════

describe('Metrics — feature flag gate', () => {
  const ADMIN_ID = 'admin-001';

  const permsMap = new Map([
    [ADMIN_ID, ['admin:users', 'metrics.read.version', 'metrics.read.full', 'metrics.manage']],
  ]);

  const authzMap = new Map([
    [ADMIN_ID, {
      isAdmin: true, allowedWorkflowIds: null, hasAnyScopeRows: true,
      hasExplicitInstanceScope: true, hasGlobalInstanceScope: true,
      scopedInstanceIds: [],
    }],
  ]);

  test('metrics catalog returns 403 when METRICS_ENABLED=false', async () => {
    const { app } = buildTestApp({
      permissionsForUser: permsMap,
      authzForUser: authzMap,
      metricsEnabled: false,
    });
    const token = signToken({ sub: ADMIN_ID });
    const res = await request(app)
      .get('/api/metrics/catalog?instanceId=prod')
      .set(...authCookie(token));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('disabled');
  });

  test('metrics instances returns empty when no data and METRICS_ENABLED=true', async () => {
    const pool = createMockPool();
    pool.setHandler(() => ({ rows: [], rowCount: 0 }));
    const { app } = buildTestApp({
      permissionsForUser: permsMap,
      authzForUser: authzMap,
      metricsEnabled: true,
      pool,
    });
    const token = signToken({ sub: ADMIN_ID });
    const res = await request(app)
      .get('/api/metrics/instances')
      .set(...authCookie(token));

    expect(res.status).toBe(200);
    expect(res.body.instances).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════

describe('Metrics — permission-gated endpoints', () => {
  const VIEWER_ID = 'viewer-001';

  const permsMap = new Map([
    [VIEWER_ID, ['read:workflows', 'metrics.read.version']],
  ]);

  const authzMap = new Map([
    [VIEWER_ID, {
      isAdmin: false, allowedWorkflowIds: [], hasAnyScopeRows: false,
      hasExplicitInstanceScope: false, hasGlobalInstanceScope: false,
      scopedInstanceIds: [],
    }],
  ]);

  let app;

  beforeAll(() => {
    const built = buildTestApp({
      permissionsForUser: permsMap,
      authzForUser: authzMap,
      metricsEnabled: true,
    });
    app = built.app;
    built.pool.setHandler(() => ({ rows: [], rowCount: 0 }));
  });

  test('viewer without metrics.read.full gets 403 on /api/metrics/catalog', async () => {
    const token = signToken({ sub: VIEWER_ID });
    const res = await request(app)
      .get('/api/metrics/catalog?instanceId=prod')
      .set(...authCookie(token));

    expect(res.status).toBe(403);
  });

  test('viewer without metrics.read.full gets 403 on /api/metrics/query', async () => {
    const token = signToken({ sub: VIEWER_ID });
    const res = await request(app)
      .post('/api/metrics/query')
      .send({ instanceId: 'prod', metricName: 'test', from: '2024-01-01', to: '2024-01-02' })
      .set(...authCookie(token));

    expect(res.status).toBe(403);
  });
});
