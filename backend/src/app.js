const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const path = require('path');

const {
  TRUST_PROXY,
  LOG_FORMAT,
  CORS_ORIGIN,
  CSP_REPORT_ONLY,
  CSP_REPORT_URI,
} = require('./config');

const { csrfOriginRefererCheck } = require('./middleware/csrf');

const {
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
} = require('./middleware/rateLimiters');

const {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  getUserPermissions,
  requireAuth,
  requirePermission,
  countActiveAdmins,
  userIsActiveAdmin,
} = require('./middleware/auth');

const { logAudit, getAuditContext } = require('./services/audit');
const { createPasswordToken, validateAndConsumeToken, hashToken, getBaseUrl } = require('./services/passwordTokens');
const { getAuthorizationContext, attachAuthz } = require('./services/authz');

// Side-effect: schedules retention cron exactly like original (top-level schedule)
require('./services/retention');

const { createHealthRouter } = require('./routes/health');
const { createSetupRouter } = require('./routes/setup');
const { createAuthRouter } = require('./routes/auth');
const { createDataRouter } = require('./routes/data');
const { createAdminRouter } = require('./routes/admin');
const { createMetricsRouter } = require('./routes/metrics');

function createApp({ pool, state }) {
  const app = express();

  if (TRUST_PROXY !== '0' && TRUST_PROXY !== 'false') {
    const trustValue = TRUST_PROXY === '1' || TRUST_PROXY === 'true' ? 1 : TRUST_PROXY;
    app.set('trust proxy', trustValue);
    console.log(`Proxy trust enabled: ${trustValue}`);
  }

  // ---------------------------------------------------------------------------
  // Content Security Policy (CSP) via Helmet
  // Applies to BOTH API responses and served SPA static files (index.html, JS, CSS).
  // ---------------------------------------------------------------------------
  const cspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],   // Required by Tailwind / shadcn runtime styles
    imgSrc: ["'self'", 'data:'],               // data: URIs for inline SVGs/icons
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],                    // SPA fetch calls to /api/* on same origin
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],                // Clickjacking protection
    upgradeInsecureRequests: [],
  };

  // Optional: CSP violation report endpoint
  if (CSP_REPORT_URI) {
    cspDirectives.reportUri = CSP_REPORT_URI;
  }

  app.use(helmet({
    contentSecurityPolicy: {
      directives: cspDirectives,
      reportOnly: CSP_REPORT_ONLY,
    },
    crossOriginEmbedderPolicy: false,          // Disabled — not needed for same-origin SPA
  }));

  // Gzip/Brotli compression for all responses
  app.use(compression());

  if (LOG_FORMAT === 'json') {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration_ms: Date.now() - start,
          ip: req.ip,
        }));
      });
      next();
    });
  } else {
    const morgan = require('morgan');
    app.use(morgan('dev'));
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const corsOrigin = CORS_ORIGIN;
  if (corsOrigin === '*') {
    // Wildcard origin: allow any origin WITHOUT credentials (safe per CORS spec)
    app.use(cors({ origin: '*', credentials: false }));
  } else {
    app.use(cors({ origin: corsOrigin, credentials: true }));
  }

  app.use(csrfOriginRefererCheck);

  const deps = {
    pool,
    state,

    // misc
    getStableIp,

    // limiters
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

    // auth/token
    signToken,
    setAuthCookie,
    clearAuthCookie,
    requireAuth,
    requirePermission,
    getUserPermissions,

    // anti-lockout
    countActiveAdmins,
    userIsActiveAdmin,

    // audit
    logAudit,
    getAuditContext,

    // password tokens
    createPasswordToken,
    validateAndConsumeToken,
    hashToken,
    getBaseUrl,

    // authz
    getAuthorizationContext,
    attachAuthz,
  };

  app.use(createHealthRouter(deps));
  app.use(createSetupRouter(deps));
  app.use(createAuthRouter(deps));
  app.use(createDataRouter(deps));
  app.use(createAdminRouter(deps));
  app.use(createMetricsRouter(deps));

  // =========================================================================
  // Static frontend serving (React SPA)
  // =========================================================================
  const publicDir = path.join(__dirname, '..', 'public');

  // Hashed Vite assets — immutable, cache forever
  app.use('/assets', express.static(path.join(publicDir, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));

  // Other static files (favicon, robots.txt, etc.)
  app.use(express.static(publicDir, {
    maxAge: '1h',
    index: false, // Don't auto-serve index.html (SPA fallback handles it)
  }));

  // SPA fallback — any unmatched GET returns index.html
  // POST/PUT/DELETE to unknown paths correctly 404.
  app.get('{*path}', (req, res, next) => {
    // Don't serve index.html for API-like paths that weren't matched by routes
    if (req.path.startsWith('/api/')) return next();
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err) next(err);
    });
  });

  // ERROR HANDLER (unchanged)
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
