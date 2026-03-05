/**
 * Shared test helpers: mock pool, mock dependencies, auth router factory.
 *
 * Uses in-memory mocks so tests run instantly without PostgreSQL.
 * Each test can override pool.query behaviour per scenario.
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars-long!!';
const TEST_PASSWORD = 'SecureTestPass99';
let TEST_PASSWORD_HASH;

// Pre-hash once (low rounds for speed)
function getTestPasswordHash() {
  if (!TEST_PASSWORD_HASH) {
    TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);
  }
  return TEST_PASSWORD_HASH;
}

/** Build a mock user row as returned by the DB. */
function makeUser(overrides = {}) {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    email: 'test@example.com',
    password_hash: getTestPasswordHash(),
    is_active: true,
    token_version: 0,
    failed_login_attempts: 0,
    locked_until: null,
    last_failed_login_at: null,
    ...overrides,
  };
}

/** Create mock pool with overridable query handler. */
function createMockPool() {
  const pool = {
    _handler: () => ({ rows: [], rowCount: 0 }),
    query: jest.fn(function (...args) { return Promise.resolve(pool._handler(...args)); }),
    connect: jest.fn(() => Promise.resolve({
      query: jest.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
      release: jest.fn(),
    })),
    setHandler(fn) {
      pool._handler = fn;
      pool.query.mockImplementation((...args) => Promise.resolve(fn(...args)));
    },
  };
  return pool;
}

/**
 * Build a minimal Express app with ONLY the auth router mounted.
 * Avoids side-effects from the full app (retention cron, pool singleton, etc.).
 */
function buildAuthApp(poolOverride) {
  // Override env before requiring config
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.APP_ENV = 'development';
  process.env.PASSWORD_MIN_LENGTH = '12';
  process.env.ACCOUNT_LOCKOUT_THRESHOLD = '5';
  process.env.ACCOUNT_LOCKOUT_DURATION_MINUTES = '15';

  const pool = poolOverride || createMockPool();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // --- Build mock deps matching what createAuthRouter expects ---
  const signToken = (payload) => jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: '10m' });

  const setAuthCookie = (res, token) => {
    res.cookie('n8n_trace_token', token, { httpOnly: true, path: '/', maxAge: 30 * 60 * 1000 });
  };

  const clearAuthCookie = (res) => {
    res.clearCookie('n8n_trace_token', { path: '/' });
  };

  const requireAuth = (req, res, next) => {
    const token = req.cookies?.n8n_trace_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
      const payload = jwt.verify(token, TEST_JWT_SECRET);
      // Check token_version against DB synchronously via mock
      req.user = payload;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid session' });
    }
  };

  const deps = {
    pool,
    state: { dbReady: true },
    loginLimiter: (req, res, next) => next(),               // disable rate limit in tests
    sensitiveAuthLimiter: (req, res, next) => next(),
    authSessionLimiter: (req, res, next) => next(),
    signToken,
    setAuthCookie,
    clearAuthCookie,
    requireAuth,
    getUserPermissions: jest.fn(async () => []),
    createPasswordToken: jest.fn(async () => ({ rawToken: 'tok', expiresAt: new Date() })),
    validateAndConsumeToken: jest.fn(async () => ({ valid: true, userId: makeUser().id })),
    hashToken: jest.fn((t) => `hashed_${t}`),
    logAudit: jest.fn(async () => {}),
    getAuditContext: jest.fn((req) => ({ ip: '127.0.0.1' })),
  };

  const { createAuthRouter } = require('../src/routes/auth');
  app.use(createAuthRouter(deps));

  return { app, pool, deps };
}

/** Sign a test JWT for authenticated requests. */
function signTestToken(payload = {}) {
  return jwt.sign(
    { sub: makeUser().id, email: 'test@example.com', token_version: 0, ...payload },
    TEST_JWT_SECRET,
    { expiresIn: '10m' },
  );
}

module.exports = {
  TEST_JWT_SECRET,
  TEST_PASSWORD,
  getTestPasswordHash,
  makeUser,
  createMockPool,
  buildAuthApp,
  signTestToken,
};
