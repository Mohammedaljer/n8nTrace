const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const {
  TRUST_PROXY,
  LOG_FORMAT,
  CORS_ORIGIN,
} = require('./config');

const { csrfOriginRefererCheck } = require('./middleware/csrf');

const {
  getStableIp,
  authLimiter,
  sensitiveAuthLimiter,
  adminCreateLimiter,
  setupLimiter,
  metricsLimiter,
  loginLimiter,
  adminApiLimiter,
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

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

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
  app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin, credentials: true }));

  app.use(csrfOriginRefererCheck);

  const deps = {
    pool,
    state,

    // misc
    getStableIp,

    // limiters
    authLimiter,
    sensitiveAuthLimiter,
    adminCreateLimiter,
    setupLimiter,
    metricsLimiter,
    loginLimiter,
    adminApiLimiter,

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

  // ERROR HANDLER (unchanged)
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
