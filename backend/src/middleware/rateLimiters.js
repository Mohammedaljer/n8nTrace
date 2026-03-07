const rateLimit = require('express-rate-limit');

function getStableIp(req) {
  let ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const portMatch = ip.match(/^(.+):(\d+)$/);
  if (portMatch && !ip.includes('::')) ip = portMatch[1];
  return ip;
}

function createRateLimiter(windowMs, max) {
  return rateLimit({
    windowMs, max, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => getStableIp(req),
    handler: (req, res, next, options) => {
      res.set('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil(options.windowMs / 1000) });
    },
  });
}

const sensitiveAuthLimiter = createRateLimiter(15 * 60 * 1000, 5);
const adminCreateLimiter = createRateLimiter(60 * 1000, 10);
const setupLimiter = createRateLimiter(15 * 60 * 1000, 5); // same as sensitive auth
const metricsLimiter = createRateLimiter(60 * 1000, 60);

// Login limiter: configurable via env, defaults to 20/15min for production safety
// Set LOGIN_RATE_LIMIT_MAX to adjust (e.g., 100 for dev/testing)
const loginLimitMax = parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 20;
const loginLimiter = createRateLimiter(15 * 60 * 1000, loginLimitMax);

// Admin API rate limiter: 100 requests per minute per IP
const adminApiLimiter = createRateLimiter(60 * 1000, 100);

// Auth session limiter (logout, etc.): 30 requests per minute per IP
const authSessionLimiter = createRateLimiter(60 * 1000, 30);

// General authenticated-read limiter: 120 requests per minute per IP
const apiReadLimiter = createRateLimiter(60 * 1000, 120);

// Heavy / expensive DB query limiter: 30 requests per minute per IP
const heavyQueryLimiter = createRateLimiter(60 * 1000, 30);

// Health endpoint limiter: 60 requests per minute per IP (protects against probe abuse)
const healthLimiter = createRateLimiter(60 * 1000, 60);

module.exports = {
  getStableIp,
  sensitiveAuthLimiter,
  adminCreateLimiter,
  setupLimiter,
  metricsLimiter,
  loginLimiter,
  adminApiLimiter,
  authSessionLimiter,
  apiReadLimiter,
  heavyQueryLimiter,
  healthLimiter,
};
