const { APP_URL } = require('../config');

function getExpectedOrigin() {
  if (!APP_URL || APP_URL === '*') return null;
  try {
    const u = new URL(APP_URL);
    return u.origin;
  } catch {
    return null;
  }
}
const expectedOrigin = getExpectedOrigin();

/**
 * CSRF Origin / Referer check.
 * Protects ALL mutating requests (POST, PUT, PATCH, DELETE) on /api/ paths.
 * Read-only GET/HEAD/OPTIONS requests are exempt.
 * If APP_URL is not configured, the check is skipped (dev convenience).
 */
function csrfOriginRefererCheck(req, res, next) {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

  // Only protect /api/ paths (not static assets or SPA fallback)
  const path = req.path || '';
  if (!path.startsWith('/api/')) return next();

  // If APP_URL is not set we cannot validate origin — skip (dev only)
  if (!expectedOrigin) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  let allowed = false;
  if (origin) {
    allowed = (origin === expectedOrigin);
  } else if (referer) {
    try {
      const refUrl = new URL(referer);
      const expUrl = new URL(expectedOrigin);
      allowed = (refUrl.origin === expUrl.origin);
    } catch {
      allowed = false;
    }
  }
  if (!allowed) {
    return res.status(403).json({ error: 'Invalid request origin' });
  }
  next();
}


module.exports = { csrfOriginRefererCheck };
