/**
 * Account lockout integration tests.
 *
 * Uses a mock pool injected into the auth router via supertest.
 * ACCOUNT_LOCKOUT_THRESHOLD is set to 5 for faster testing.
 */
const request = require('supertest');
const { buildAuthApp, makeUser, TEST_PASSWORD, createMockPool } = require('./helpers');

describe('Account lockout', () => {
  let app, pool, deps;

  beforeEach(() => {
    const built = buildAuthApp();
    app = built.app;
    pool = built.pool;
    deps = built.deps;
  });

  // ── Generic error for wrong password ────────────────────────────────────

  test('returns generic error on wrong password (no info leak)', async () => {
    const user = makeUser();
    pool.setHandler((sql) => {
      if (sql.includes('FROM app_users WHERE email')) return { rows: [user], rowCount: 1 };
      return { rows: [], rowCount: 0 }; // UPDATE
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword1' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  // ── Generic error for nonexistent user ──────────────────────────────────

  test('returns same generic error for nonexistent user', async () => {
    pool.setHandler(() => ({ rows: [], rowCount: 0 }));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'doesntmatter1' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  // ── Increments failed_login_attempts on wrong password ──────────────────

  test('increments failed_login_attempts on wrong password', async () => {
    const user = makeUser({ failed_login_attempts: 2 });
    pool.setHandler((sql) => {
      if (sql.includes('FROM app_users WHERE email')) return { rows: [user], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword1' });

    // Find the UPDATE call that increments failed_login_attempts
    const updateCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('failed_login_attempts = $2')
    );
    expect(updateCall).toBeDefined();
    // Params: [userId, newAttempts, lockUntil] — newAttempts should be 3 (was 2 + 1)
    expect(updateCall[1][1]).toBe(3);
  });

  // ── Locks account after threshold (5) reached ──────────────────────────

  test('locks account after threshold reached and logs audit event', async () => {
    const user = makeUser({ failed_login_attempts: 4 }); // one more = 5 = locked
    pool.setHandler((sql) => {
      if (sql.includes('FROM app_users WHERE email')) return { rows: [user], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword1' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');

    // Verify lockout UPDATE includes a locked_until timestamp
    const updateCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('locked_until')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1][2]).not.toBeNull(); // locked_until should be set

    // Verify audit event for account_locked
    const lockAudit = deps.logAudit.mock.calls.find((c) => c[0] === 'account_locked');
    expect(lockAudit).toBeDefined();
  });

  // ── Rejects login when account is locked (unexpired) ───────────────────

  test('rejects login when account is locked (same generic error)', async () => {
    const lockedUser = makeUser({
      failed_login_attempts: 5,
      locked_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // locked for 10 more min
    });
    pool.setHandler((sql) => {
      if (sql.includes('FROM app_users WHERE email')) return { rows: [lockedUser], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: TEST_PASSWORD }); // correct password!

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  // ── Successful login resets counters ────────────────────────────────────

  test('successful login resets failed_login_attempts and locked_until', async () => {
    const user = makeUser({ failed_login_attempts: 3 });
    pool.setHandler((sql) => {
      if (sql.includes('FROM app_users WHERE email')) return { rows: [user], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify reset UPDATE
    const resetCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('failed_login_attempts = 0')
    );
    expect(resetCall).toBeDefined();
  });

  // ── Allows login after lockout expires ─────────────────────────────────

  test('allows login after lockout has expired and logs account_unlocked', async () => {
    const user = makeUser({
      failed_login_attempts: 5,
      locked_until: new Date(Date.now() - 1000).toISOString(), // expired 1 second ago
    });
    pool.setHandler((sql) => {
      if (sql.includes('FROM app_users WHERE email')) return { rows: [user], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify account_unlocked audit event
    const unlockAudit = deps.logAudit.mock.calls.find((c) => c[0] === 'account_unlocked');
    expect(unlockAudit).toBeDefined();
  });
});
