// Shared password strength validation
// Single source of truth for all password creation / reset flows.

const { PASSWORD_MIN_LENGTH } = require('../config');

// Expanded common-password denylist (lowercased).
// Covers original setup.js list + NCSC top-20 + keyboard walks.
const WEAK_PASSWORDS = new Set([
  // Original denylist from setup route
  'password', 'password123', 'admin', '12345678', '1234567890',
  'qwerty', 'letmein', 'welcome', 'monkey', 'abc123',
  'admin123', 'changeme', 'secret',
  // NCSC / HaveIBeenPwned top-20 additions
  '123456789', '12345678901', '123456789012', 'qwerty123',
  'password1', '1234567891', '000000000000', 'iloveyou',
  'princess', 'sunshine', 'football', 'charlie', 'shadow',
  'michael', 'master', 'dragon', 'trustno1', 'baseball',
  'superman', 'batman', 'access', 'letmein123', 'login',
  'passw0rd', 'starwars', 'hello123', 'whatever',
  // Keyboard walks
  'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1q2w3e4r',
  'qwerty12345', 'qazwsx', '1qaz2wsx', 'abcd1234',
  // n8n-trace-specific (prevent trivial project-related passwords)
  'n8ntrace', 'n8ntrace123', 'trace123', 'dashboard',
  'dashboard123', 'adminadmin', 'administrator',
  // Seasons / patterns
  'summer2025', 'winter2025', 'spring2025', 'summer2026',
  'winter2026', 'spring2026', 'test1234', 'test12345',
  'p@ssw0rd', 'p@ssword', 'p@ssword1', 'pa$$word',
]);

/**
 * Validate password strength.
 * @param {string} password  — candidate password
 * @param {{ email?: string }} [opts] — optional context for additional checks
 * @returns {{ valid: boolean, reason?: string }}
 */
function validatePasswordStrength(password, opts = {}) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }

  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, reason: 'This password is too common. Please choose a stronger password' };
  }

  // Reject passwords that match or contain the user's email / local-part
  if (opts.email) {
    const lowerPw = password.toLowerCase();
    const lowerEmail = opts.email.toLowerCase().trim();
    const localPart = lowerEmail.split('@')[0];

    if (lowerPw === lowerEmail) {
      return { valid: false, reason: 'Password must not be the same as your email address' };
    }
    // Only check containment if the local-part is 4+ chars to avoid false positives
    if (localPart.length >= 4 && lowerPw.includes(localPart)) {
      return { valid: false, reason: 'Password must not contain your email address or username' };
    }
  }

  return { valid: true };
}

module.exports = { validatePasswordStrength, WEAK_PASSWORDS };
