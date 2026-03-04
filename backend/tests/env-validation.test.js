/**
 * Environment validation tests.
 *
 * Tests that env.js properly blocks unsafe configurations in production.
 * Uses jest.resetModules() to ensure each test gets a fresh module.
 */

const GOOD_SECRET = 'a'.repeat(32) + '-not-a-placeholder-safe-value';

// We need to capture process.exit calls without actually exiting.
// Strategy: use jest.spyOn and mock implementation.
let exitSpy;
let errorSpy;
let warnSpy;

beforeEach(() => {
  jest.resetModules();
  exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`EXIT_${code}`);
  });
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  exitSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

function loadAndRun() {
  const { validateEnv } = require('../src/config/env');
  validateEnv();
}

describe('env.js — validateEnv', () => {

  // ── Required vars ───────────────────────────────────────────────────────

  test('fails when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    process.env.APP_ENV = 'development';

    expect(() => loadAndRun()).toThrow('EXIT_1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL'));
  });

  // ── Production-required vars ────────────────────────────────────────────

  test('fails in production when JWT_SECRET is missing', () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.APP_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.APP_URL;
    delete process.env.CORS_ORIGIN;

    expect(() => loadAndRun()).toThrow('EXIT_1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET'));
  });

  test('fails in production when APP_URL is missing', () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.APP_ENV = 'production';
    process.env.JWT_SECRET = GOOD_SECRET;
    delete process.env.APP_URL;
    delete process.env.CORS_ORIGIN;

    expect(() => loadAndRun()).toThrow('EXIT_1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('APP_URL'));
  });

  test('fails in production when CORS_ORIGIN is missing', () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.APP_ENV = 'production';
    process.env.JWT_SECRET = GOOD_SECRET;
    process.env.APP_URL = 'https://trace.example.com';
    delete process.env.CORS_ORIGIN;

    expect(() => loadAndRun()).toThrow('EXIT_1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CORS_ORIGIN'));
  });

  // ── JWT_SECRET length ───────────────────────────────────────────────────

  test('fails in production when JWT_SECRET is shorter than 32 chars', () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.APP_ENV = 'production';
    process.env.JWT_SECRET = 'too-short';
    process.env.APP_URL = 'https://trace.example.com';
    process.env.CORS_ORIGIN = 'https://trace.example.com';

    expect(() => loadAndRun()).toThrow('EXIT_1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('32 characters'));
  });

  // ── Unsafe placeholders ─────────────────────────────────────────────────

  test('fails in production when JWT_SECRET contains "changeme"', () => {
    process.env.DATABASE_URL = 'postgres://x:safepassword@localhost/test';
    process.env.APP_ENV = 'production';
    process.env.JWT_SECRET = 'this-is-a-changeme-secret-that-is-long-enough';
    process.env.APP_URL = 'https://trace.example.com';
    process.env.CORS_ORIGIN = 'https://trace.example.com';

    expect(() => loadAndRun()).toThrow('EXIT_1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('placeholder'));
  });

  // ── CORS_ORIGIN=* ──────────────────────────────────────────────────────

  test('fails in production when CORS_ORIGIN is *', () => {
    process.env.DATABASE_URL = 'postgres://x:safepassword@localhost/test';
    process.env.APP_ENV = 'production';
    process.env.JWT_SECRET = GOOD_SECRET;
    process.env.APP_URL = 'https://trace.example.com';
    process.env.CORS_ORIGIN = '*';

    expect(() => loadAndRun()).toThrow('EXIT_1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CORS_ORIGIN'));
  });

  // ── COOKIE_SECURE=false ────────────────────────────────────────────────

  test('fails in production when COOKIE_SECURE is false', () => {
    process.env.DATABASE_URL = 'postgres://x:safepassword@localhost/test';
    process.env.APP_ENV = 'production';
    process.env.JWT_SECRET = GOOD_SECRET;
    process.env.APP_URL = 'https://trace.example.com';
    process.env.CORS_ORIGIN = 'https://trace.example.com';
    process.env.COOKIE_SECURE = 'false';

    expect(() => loadAndRun()).toThrow('EXIT_1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('COOKIE_SECURE'));
  });

  // ── Development mode allows weak config ─────────────────────────────────

  test('passes in development with minimal config', () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.APP_ENV = 'development';
    process.env.JWT_SECRET = 'short-dev-secret-ok!!!';

    expect(() => loadAndRun()).not.toThrow();
  });
});
