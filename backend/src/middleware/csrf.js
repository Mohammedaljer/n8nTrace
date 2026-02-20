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

function csrfOriginRefererCheck(req, res, next) {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
  const path = req.path || '';
  const isProtected = path.startsWith('/api/admin/') || path.startsWith('/api/setup/');
  if (!isProtected) return next();
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
