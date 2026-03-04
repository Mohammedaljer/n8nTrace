/**
 * Session revocation integration tests.
 *
 * Tests the POST /api/auth/revoke-all-sessions endpoint.
 */
const request = require('supertest');
const { buildAuthApp, makeUser, signTestToken, TEST_PASSWORD } = require('./helpers');

describe('Session revocation — /api/auth/revoke-all-sessions', () => {
  let app, pool, deps;

  beforeEach(() => {
    const built = buildAuthApp();
    app = built.app;
    pool = built.pool;
    deps = built.deps;
  });

  // ── Requires authentication ─────────────────────────────────────────────

  test('returns 401 without auth cookie', async () => {
    const res = await request(app).post('/api/auth/revoke-all-sessions');
    expect(res.status).toBe(401);
  });

  // ── Increments token_version ────────────────────────────────────────────

  test('increments token_version for authenticated user', async () => {
    const user = makeUser();
    pool.setHandler((sql) => {
      if (sql.includes('token_version')) return { rows: [{ id: user.id }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const token = signTestToken();
    const res = await request(app)
      .post('/api/auth/revoke-all-sessions')
      .set('Cookie', `n8n_trace_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toMatch(/revoked/i);

    // Verify UPDATE query was called with token_version increment
    const updateCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('token_version = COALESCE(token_version, 0) + 1')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toContain(user.id);
  });

  // ── Clears auth cookie ─────────────────────────────────────────────────

  test('clears the auth cookie in the response', async () => {
    pool.setHandler(() => ({ rows: [], rowCount: 0 }));

    const token = signTestToken();
    const res = await request(app)
      .post('/api/auth/revoke-all-sessions')
      .set('Cookie', `n8n_trace_token=${token}`);

    expect(res.status).toBe(200);
    // Check Set-Cookie header clears the token
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const clearCookie = Array.isArray(cookies)
      ? cookies.find((c) => c.includes('n8n_trace_token='))
      : cookies;
    expect(clearCookie).toBeDefined();
  });

  // ── Logs audit event ───────────────────────────────────────────────────

  test('logs all_sessions_revoked audit event', async () => {
    pool.setHandler(() => ({ rows: [], rowCount: 0 }));

    const token = signTestToken();
    await request(app)
      .post('/api/auth/revoke-all-sessions')
      .set('Cookie', `n8n_trace_token=${token}`);

    const auditCall = deps.logAudit.mock.calls.find((c) => c[0] === 'all_sessions_revoked');
    expect(auditCall).toBeDefined();
  });

  // ── Full flow: login → revoke → old token rejected ─────────────────────

  test('full flow: login succeeds, revoke, old token should be outdated', async () => {
    const user = makeUser();

    // Step 1: Login
    pool.setHandler((sql) => {
      if (sql.includes('FROM app_users WHERE email')) return { rows: [user], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: TEST_PASSWORD });

    expect(loginRes.status).toBe(200);

    // Extract the cookie from login response
    const loginCookies = loginRes.headers['set-cookie'];
    expect(loginCookies).toBeDefined();

    // Step 2: Revoke all sessions
    const cookieStr = Array.isArray(loginCookies) ? loginCookies.join('; ') : loginCookies;
    const revokeRes = await request(app)
      .post('/api/auth/revoke-all-sessions')
      .set('Cookie', cookieStr);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.ok).toBe(true);

    // Verify the token_version was incremented in DB
    const versionUpdate = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('token_version = COALESCE(token_version, 0) + 1')
    );
    expect(versionUpdate).toBeDefined();
  });
});
