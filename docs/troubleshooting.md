# Troubleshooting

Common issues and solutions.

<!-- TOC -->

- [Troubleshooting](#troubleshooting)
    - [Backend Won't Start Fail-fast](#backend-wont-start-fail-fast)
    - [Database Not Ready](#database-not-ready)
    - [Health Check Returns 503](#health-check-returns-503)
    - [Cannot Access /setup](#cannot-access-setup)
    - [Login Fails with 401](#login-fails-with-401)
    - [Set Password Returns 500 FIXED](#set-password-returns-500-fixed)
    - [Rate Limited 429](#rate-limited-429)
    - [Cookies Not Being Set](#cookies-not-being-set)
    - [CORS Errors](#cors-errors)
    - [Metrics Not Showing](#metrics-not-showing)
    - [Instance Metrics Access Denied](#instance-metrics-access-denied)
    - [Dashboard Layout Not Saving](#dashboard-layout-not-saving)
    - [Retention Job Not Running](#retention-job-not-running)
    - [Wrong IP in Audit Logs](#wrong-ip-in-audit-logs)
    - [Migration Failed: Invalid Index](#migration-failed-invalid-index)
    - [Verification Commands](#verification-commands)

<!-- /TOC -->

## Backend Won't Start (Fail-fast)
**
**Symptom**: Backend exits with `FATAL` error in production.

**Causes** (fail-fast checks):
- `JWT_SECRET` < 32 characters
- `JWT_SECRET` contains placeholder values
- `COOKIE_SECURE=false` in production
- `CORS_ORIGIN=*` in production
- `AUDIT_LOG_IP_SALT` missing when mode is `hashed`

**Solution**: Fix environment variables:

```bash
openssl rand -base64 32  # Generate JWT_SECRET
```

## Database Not Ready

**Symptom**: Connection errors on startup.

**Solutions**:

```bash
# Wait for PostgreSQL
docker compose logs postgres

# Check DATABASE_URL format
DATABASE_URL=postgres://user:pass@host:5432/dbname
```

## Health Check Returns 503

**Symptom**: `/health` returns 503.

**Causes**: Database not connected, migrations running.

```bash
docker compose logs n8n_trace_app
docker exec n8n_trace_app /nodejs/bin/node -e "fetch('http://localhost:8001/health').then(r=>r.json()).then(console.log)"
```

## Cannot Access /setup

**Symptom**: 403 or "Setup already completed".

**Cause**: Expected—`/setup` only works with zero users.

**Solution**: Use Admin panel to invite users after first admin exists.

## Login Fails with 401

**Symptom**: Correct credentials return 401.

**Causes**:
- Wrong password
- User deactivated
- Token version mismatch

```bash
# Check user exists
docker exec n8n_trace_postgres psql -U n8n_trace \
  -c "SELECT email, is_active FROM app_users;"
```

## Set Password Returns 500 (FIXED)

**Symptom**: `POST /api/auth/set-password` returns 500.

**Previous cause**: `BCRYPT_ROUNDS` was undefined in auth router.

**Status**: ✅ **FIXED** in v1.3.3+

The fix imports `BCRYPT_ROUNDS` directly from config:

```javascript
const { BCRYPT_ROUNDS: configBcryptRounds } = require('../config');
const BCRYPT_ROUNDS = (typeof configBcryptRounds === 'number' && configBcryptRounds > 0)
  ? configBcryptRounds
  : 10; // fallback
```

**If still seeing this**: Rebuild the container:

```bash
docker compose -f docker-compose.prod.yml up -d --build --force-recreate n8n_trace_app
```

## Rate Limited (429)

**Symptom**: 429 Too Many Requests.

**Rate limits**:
- Login: **20 per 15 min**
- Admin API: 100 per min
- Metrics API: 60 per min

**Solution**: Wait for `retryAfter` period.

## Cookies Not Being Set

**Symptom**: Login succeeds but subsequent requests fail.

**Causes**:
- `COOKIE_SECURE=true` without HTTPS
- CORS mismatch
- **Trailing space** in env var (e.g., `COOKIE_SECURE=false `)

**Solutions**:

```bash
# For local dev without HTTPS
COOKIE_SECURE=false
APP_ENV=development

# Check for trailing spaces in .env
```

## CORS Errors

**Symptom**: Browser shows CORS errors.

**Cause**: `CORS_ORIGIN` doesn't match request origin.

```bash
# Correct
CORS_ORIGIN=https://trace.example.com

# Wrong
CORS_ORIGIN=https://trace.example.com/  # trailing slash
CORS_ORIGIN=*                            # fails in production
```

## Metrics Not Showing

**Symptom**: Metrics dashboard empty.

**Causes**:
- `METRICS_ENABLED=false`
- No data in database
- User lacks `metrics.read.full` permission

**Solutions**:

```bash
# Enable metrics
METRICS_ENABLED=true

# Check data
docker exec n8n_trace_postgres psql -U n8n_trace \
  -c "SELECT COUNT(*) FROM n8n_metrics_snapshot;"

# Check user role (Viewer cannot see full metrics)
```

## Instance Metrics Access Denied

**Symptom**: User sees workflows but not instance metrics.

**Cause**: User has only tag/workflow scope, not instance scope.

**Solution**: Add instance scope to user's group.

## Dashboard Layout Not Saving

**Symptom**: Customizations reset on refresh.

**Cause**: localStorage issues.

```javascript
// In browser console
localStorage.getItem('n8n_trace_dashboard_layout')
localStorage.removeItem('n8n_trace_dashboard_layout')  // Reset
```

## Retention Job Not Running

**Symptom**: Old data not cleaned.

**Causes**:
- `RETENTION_ENABLED=false`
- Job hasn't run yet

```bash
RETENTION_ENABLED=true
RETENTION_DAYS=90
RETENTION_RUN_AT=03:30
```

## Wrong IP in Audit Logs

**Symptom**: Logs show `127.0.0.1` or a Docker network IP instead of real client IP.

**Cause**: `TRUST_PROXY` does not match your deployment topology.

**Solution** (depends on deployment):

- **Direct access** (no reverse proxy): `TRUST_PROXY=false` (default). Express uses the raw TCP connection IP.

- **Behind one proxy** (Traefik, Caddy, NGINX, ALB): `TRUST_PROXY=1`. Express reads the real IP from `X-Forwarded-For`.

- **Behind CDN + proxy**: `TRUST_PROXY=2`.

See [Architecture → Proxy Trust Model](./architecture.md#proxy-trust-model).

## Migration Failed

**Symptom**: Backend exits with `FATAL: Migration failed` on startup.

**Common causes**:
- Database schema conflicts from a previous failed migration
- Manually modified tables that conflict with migration expectations

**Solution**:

```bash
# Check migration status
docker exec n8n_trace_postgres psql -U n8n_trace -c \
  "SELECT * FROM pgmigrations ORDER BY run_on;"

# Check for invalid indexes
docker exec n8n_trace_postgres psql -U n8n_trace -c \
  "SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE NOT indisvalid;"

# Drop an invalid index if found
docker exec n8n_trace_postgres psql -U n8n_trace -c \
  "DROP INDEX IF EXISTS idx_executions_instance_started;"

# Restart the app to re-run the migration
docker compose restart n8n_trace_app
```

## Verification Commands

```bash
# Services status
docker compose ps

# Health check
curl https://trace.example.com/health

# Setup status
curl https://trace.example.com/api/setup/status

# Logs
docker compose logs -f n8n_trace_app

# Database
docker exec n8n_trace_postgres psql -U n8n_trace \
  -c "SELECT COUNT(*) FROM app_users;"
```
