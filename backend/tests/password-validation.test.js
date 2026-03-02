/**
 * Password strength validation tests.
 *
 * Pure unit tests — no DB, no Express, no mocking required.
 */

// Set env before requiring the module
process.env.PASSWORD_MIN_LENGTH = '12';

const { validatePasswordStrength } = require('../src/utils/password');

describe('validatePasswordStrength', () => {
  // ── Length checks ──────────────────────────────────────────────────────────

  test('rejects empty string', () => {
    const r = validatePasswordStrength('');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/at least 12/);
  });

  test('rejects password shorter than minimum (11 chars)', () => {
    const r = validatePasswordStrength('abcdefghijk'); // 11 chars
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/at least 12/);
  });

  test('accepts password at exactly the minimum (12 chars)', () => {
    const r = validatePasswordStrength('abcdefghijkl'); // 12 chars
    expect(r.valid).toBe(true);
  });

  test('accepts long password (50 chars)', () => {
    const r = validatePasswordStrength('a'.repeat(50));
    expect(r.valid).toBe(true);
  });

  test('rejects non-string input (null)', () => {
    const r = validatePasswordStrength(null);
    expect(r.valid).toBe(false);
  });

  test('rejects non-string input (number)', () => {
    const r = validatePasswordStrength(12345678901234);
    expect(r.valid).toBe(false);
  });

  // ── Denylist checks ───────────────────────────────────────────────────────

  test('rejects "password" (common password)', () => {
    const r = validatePasswordStrength('password');
    expect(r.valid).toBe(false);
    // Short AND common — length error takes precedence
  });

  test('rejects "password123" (common, case-insensitive)', () => {
    const r = validatePasswordStrength('PASSWORD123');
    expect(r.valid).toBe(false);
  });

  test('rejects "qwertyuiop" (keyboard walk)', () => {
    const r = validatePasswordStrength('qwertyuiop');
    expect(r.valid).toBe(false);
  });

  test('rejects "administrator" (project-related common)', () => {
    const r = validatePasswordStrength('administrator');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/too common/i);
  });

  test('rejects "dashboard123" (project-related)', () => {
    // "dashboard123" is 12 chars — meets length but in denylist
    const r = validatePasswordStrength('dashboard123');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/too common/i);
  });

  // ── Valid passwords ───────────────────────────────────────────────────────

  test('accepts a strong 12-char password', () => {
    const r = validatePasswordStrength('MyS3cur3Pa$$');
    expect(r.valid).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  test('accepts a passphrase', () => {
    const r = validatePasswordStrength('correct horse battery staple');
    expect(r.valid).toBe(true);
  });

  // ── Email-in-password checks ──────────────────────────────────────────────

  test('rejects password that exactly matches the email', () => {
    const r = validatePasswordStrength('admin@example.com', { email: 'admin@example.com' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/same as your email/i);
  });

  test('rejects password that matches email case-insensitively', () => {
    const r = validatePasswordStrength('Admin@Example.COM', { email: 'admin@example.com' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/same as your email/i);
  });

  test('rejects password containing the email local-part (>= 4 chars)', () => {
    const r = validatePasswordStrength('my-admin-password', { email: 'admin@example.com' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/contain your email/i);
  });

  test('allows password when local-part is short (< 4 chars)', () => {
    // "jo" is too short to be a meaningful substring check
    const r = validatePasswordStrength('secure-password-jo', { email: 'jo@example.com' });
    expect(r.valid).toBe(true);
  });

  test('allows strong password unrelated to email', () => {
    const r = validatePasswordStrength('MyS3cur3Pa$$word!', { email: 'john@example.com' });
    expect(r.valid).toBe(true);
  });

  test('works fine when email option is not provided', () => {
    const r = validatePasswordStrength('MyS3cur3Pa$$');
    expect(r.valid).toBe(true);
  });
});
