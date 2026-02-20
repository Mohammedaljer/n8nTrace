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

const authLimiter = createRateLimiter(60 * 1000, 20);
const sensitiveAuthLimiter = createRateLimiter(15 * 60 * 1000, 5);
const adminCreateLimiter = createRateLimiter(60 * 1000, 10);
const setupLimiter = createRateLimiter(15 * 60 * 1000, 5); // same as sensitive auth
const metricsLimiter = createRateLimiter(60 * 1000, 60);

// Strict login limiter: 5 attempts per 15 minutes per IP (brute-force protection)
const loginLimiter = createRateLimiter(15 * 60 * 1000, 5);

// Admin API rate limiter: 100 requests per minute per IP
const adminApiLimiter = createRateLimiter(60 * 1000, 100);

module.exports = {
  getStableIp,
  createRateLimiter,
  authLimiter,
  sensitiveAuthLimiter,
  adminCreateLimiter,
  setupLimiter,
  metricsLimiter,
  loginLimiter,
  adminApiLimiter,
};
