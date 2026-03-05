# Environment Variables Reference

Complete reference for all environment variables required to deploy n8n-trace via Docker Compose or other container orchestration platforms.

---

## Table of Contents

- [Environment Variables Reference](#environment-variables-reference)
  - [Table of Contents](#table-of-contents)
  - [Required Variables](#required-variables)
  - [Application Settings](#application-settings)
  - [Security \& Authentication](#security--authentication)
  - [Cookie Settings](#cookie-settings)
  - [Privacy / GDPR](#privacy--gdpr)
  - [First Admin (Optional)](#first-admin-optional)
  - [n8n Data Ingestion (Optional)](#n8n-data-ingestion-optional)
  - [Metrics Feature](#metrics-feature)
  - [Data Retention](#data-retention)
  - [Database Settings](#database-settings)
  - [Logging](#logging)
  - [Example Docker Compose .env](#example-docker-compose-env)
  - [Production Checklist](#production-checklist)
    - [Required (Enforced by fail-fast)](#required-enforced-by-fail-fast)
    - [Required (Manual verification)](#required-manual-verification)
    - [Recommended](#recommended)
  - [Quick Reference: Generate Secrets](#quick-reference-generate-secrets)
  - [Frontend Environment Variables](#frontend-environment-variables)

---

## Required Variables

These variables **must** be set for the application to start.

| Variable | Description | Example | Notes |
|----------|-------------|---------|-------|
| `POSTGRES_PASSWORD` | Password for PostgreSQL database | `$(openssl rand -base64 24)` | Generate securely. Never use placeholders. |
| `JWT_SECRET` | Secret key for signing JWT tokens | `$(openssl rand -base64 32)` | **Minimum 32 characters.** Backend refuses to start if shorter in production. |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://n8n_trace:${POSTGRES_PASSWORD}@postgres:5432/n8n_trace` | Use container hostname `postgres` in Docker Compose. |

---

## Application Settings

| Variable | Default | Required | Description | Example |
|----------|---------|----------|-------------|---------|
| `APP_ENV` | `production` | No | Set to `production` to enable fail-fast security checks | `production` |
| `APP_URL` | `http://localhost:3000` (dev), empty (prod) | Yes (prod) | Public URL for the application. Used for CSRF validation and links. | `https://trace.example.com` |
| `CORS_ORIGIN` | `http://localhost:3000` (dev) | Yes (prod) | Allowed origin for CORS. Must match frontend URL exactly. | `https://trace.example.com` |
| `PORT` | `8001` | No | Backend internal HTTP port | `8001` |
| `HTTP_PORT` | `8899` | No | Published port (Docker host mapping) | `8899` |

**Notes:**
- `APP_ENV=production` enables fail-fast checks that prevent startup with insecure configuration
- `CORS_ORIGIN` must NOT have a trailing slash
- `CORS_ORIGIN=*` is blocked in production mode

---

## Security & Authentication

| Variable | Default | Required | Description | Example |
|----------|---------|----------|-------------|---------|
| `JWT_SECRET` | (none) | **Yes** | Signing key for JWT tokens. Min 32 chars in production. | `abcdef123456...` (32+ chars) |
| `JWT_EXPIRY` | `30m` | No | Session token lifetime | `30m`, `1h`, `7d` |
| `TRUST_PROXY` | `false` | No | Number of proxy hops to trust for client IP | `false` (direct), `1` (behind proxy) |
| `PASSWORD_MIN_LENGTH` | `12` | No | Minimum password length for user accounts | `12`, `16` |
| `ACCOUNT_LOCKOUT_THRESHOLD` | `10` | No | Failed login attempts before account lockout | `10`, `5` |
| `ACCOUNT_LOCKOUT_DURATION_MINUTES` | `15` | No | Minutes to lock account after threshold reached | `15`, `30` |
| `CSP_REPORT_ONLY` | `false` | No | Set `true` to log CSP violations without blocking | `false` |
| `CSP_REPORT_URI` | (empty) | No | URL to receive CSP violation reports | `https://example.com/csp-report` |

**Fail-fast checks (production mode):**
- `JWT_SECRET` < 32 characters → startup fails
- `JWT_SECRET` contains placeholder values (`changeme`, `password123`, `secret`, `dev-insecure-secret-change-me`, `dev-insecure`) → startup fails

> **Note — `DEBUG_IP`**: Development-only flag. Set `DEBUG_IP=true` (with `APP_ENV=development`) to expose a `GET /api/debug/ip` endpoint that shows the resolved client IP. Ignored in production.

> **Note — `TRUST_PROXY`**: Default is `false` (no proxy). Set to `1` when behind a reverse proxy (Traefik, Caddy, NGINX, ALB). Set to `2` when behind CDN + proxy. See [Architecture → Proxy Trust Model](./architecture.md#proxy-trust-model).

> **Note — Password Policy**: Passwords must also pass a common-password denylist check (~60 entries). See [Security Guide → Password Policy](./security.md#password-policy).

> **Note — Account Lockout**: Works alongside IP-based rate limiting. Lockout protects per-user, rate limiting protects per-IP. See [Security Guide → Account Lockout](./security.md#account-lockout).

---

## Cookie Settings

| Variable | Default | Required | Description | Example |
|----------|---------|----------|-------------|---------|
| `COOKIE_SECURE` | `true` (prod) / `false` (dev) | No | Set `true` when using HTTPS | `true` |
| `COOKIE_SAMESITE` | `lax` | No | Cookie SameSite policy | `lax`, `strict`, `none` |
| `COOKIE_DOMAIN` | (empty) | No | Cookie domain. Usually not needed. | `.example.com` |

**Warning:**
- `COOKIE_SECURE=false` in production mode causes startup to fail
- Trailing spaces in value (e.g., `COOKIE_SECURE=false `) can cause issues

---

## Privacy / GDPR

| Variable | Default | Required | Description | Example |
|----------|---------|----------|-------------|---------|
| `AUDIT_LOG_IP_MODE` | `raw` | No | How to store client IPs in audit log | `raw`, `hashed`, `none` |
| `AUDIT_LOG_IP_SALT` | (none) | If `hashed` | Salt for hashing IPs. Recommended min 32 chars. | `$(openssl rand -base64 32)` |

**IP Modes:**
| Mode | Stored Value | GDPR Compliant |
|------|--------------|----------------|
| `raw` | `192.168.1.100` | ❌ No |
| `hashed` | `a1b2c3d4...` (SHA-256) | ✅ Yes |
| `none` | Not stored | ✅ Yes |

---

## First Admin (Optional)

Create the initial admin user automatically at startup.

| Variable | Default | Required | Description | Example |
|----------|---------|----------|-------------|---------|
| `ADMIN_EMAIL` | (none) | No | Email for first admin | `admin@example.com` |
| `ADMIN_PASSWORD` | (none) | No | Password for first admin | `SecurePassword123!` |

**Notes:**
- Both must be set for auto-creation to work
- If not set, use `/setup` UI to create first admin
- Do not hardcode in docker-compose files committed to git

---

## n8n Data Ingestion (Optional)

Restricted database user for n8n workflows to write execution data.

| Variable | Default | Required | Description | Example |
|----------|---------|----------|-------------|---------|
| `TRACE_INGEST_USER` | (none) | No | PostgreSQL username for ingest | `trace_ingest` |
| `TRACE_INGEST_PASSWORD` | (none) | No | PostgreSQL password for ingest | `$(openssl rand -base64 24)` |

**Ingest user permissions (least privilege):**
- ✅ SELECT, INSERT, UPDATE on: `executions`, `execution_nodes`, `workflows_index`, `n8n_metrics_snapshot`, `metrics_series`, `metrics_samples`
- ❌ Cannot DELETE any data
- ❌ Cannot access: `app_users`, `audit_log`, RBAC tables

---

## Metrics Feature

| Variable | Default | Required | Description | Example |
|----------|---------|----------|-------------|---------|
| `METRICS_ENABLED` | `false` | No | Enable metrics dashboard and explorer | `true` |
| `METRICS_MAX_TIME_RANGE_DAYS` | `30` | No | Maximum queryable time range in days | `30` |
| `METRICS_MAX_DATAPOINTS` | `1000` | No | Maximum data points per query | `1000` |
| `METRICS_MAX_BREAKDOWN_ROWS` | `50` | No | Maximum rows in breakdown view | `50` |
| `METRICS_MAX_CATALOG_SIZE` | `200` | No | Maximum metrics in catalog dropdown | `200` |
| `METRICS_MAX_LABEL_VALUES` | `100` | No | Maximum values per label in filters | `100` |

**Metrics Semantics:**
- **Gauges**: Display last value (card) or avg-downsampled values (line)
- **Counters**: Always display as delta/rate (never raw cumulative values)
- **Histogram suffixes** (`_sum`, `_count`, `_bucket`): Treated as counters with delta semantics

---

## Data Retention

Automatic cleanup of old data.

| Variable | Default | Required | Description | Example |
|----------|---------|----------|-------------|---------|
| `RETENTION_ENABLED` | `false` | No | Enable automatic data cleanup | `true` |
| `RETENTION_DAYS` | `90` | No | Days to keep data | `90` |
| `RETENTION_RUN_AT` | `03:30` | No | Daily cleanup time (HH:MM, server time) | `03:30` |
| `RETENTION_TZ` | `UTC` | No | Timezone for retention schedule | `UTC`, `Europe/Berlin` |

**What gets cleaned:**
- `executions` (finished only)
- `execution_nodes` (orphans)
- `workflows_index` (orphans)
- `n8n_metrics_snapshot`, `metrics_samples`, `metrics_series` (orphans)
- `audit_log`

**Never touched:** `app_users`, RBAC tables

---

## Database Settings

| Variable | Default | Required | Description | Example |
|----------|---------|----------|-------------|---------|
| `DATABASE_URL` | (none) | **Yes** | PostgreSQL connection string | `postgres://user:pass@host:5432/db` |
| `POSTGRES_USER` | `n8n_trace` | No | Database username (compose) | `n8n_trace` |
| `POSTGRES_DB` | `n8n_trace` | No | Database name (compose) | `n8n_trace` |
| `DB_POOL_MAX` | `20` | No | Maximum connections in pool | `20` |
| `DB_IDLE_TIMEOUT` | `30000` | No | Idle connection timeout (ms) | `30000` |
| `DB_CONNECT_TIMEOUT` | `5000` | No | Connection timeout (ms) | `5000` |

---

## Logging

| Variable | Default | Required | Description | Example |
|----------|---------|----------|-------------|---------|
| `LOG_FORMAT` | `json` (prod) / `dev` (dev) | No | Morgan log format | `json`, `combined`, `dev` |
| `LOGIN_RATE_LIMIT_MAX` | `20` | No | Express-layer login rate limit (requests per 15 min window) | `20`, `100` (for testing) |

---

## Example Docker Compose .env

```bash
# ============================================
# n8n-trace - Production Environment
# ============================================
# Copy to .env and fill in values
# NEVER commit this file to version control
# ============================================

# --- Required Secrets ---
# Generate with: openssl rand -base64 24
POSTGRES_PASSWORD=CHANGE_ME_GENERATE_SECURE_PASSWORD

# Generate with: openssl rand -base64 32
# MUST be at least 32 characters
JWT_SECRET=CHANGE_ME_GENERATE_SECURE_SECRET_AT_LEAST_32_CHARS

# --- Application ---
APP_ENV=production
APP_URL=https://trace.example.com
CORS_ORIGIN=https://trace.example.com
HTTP_PORT=8899

# --- Security ---
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
TRUST_PROXY=false
JWT_EXPIRY=30m
PASSWORD_MIN_LENGTH=12
ACCOUNT_LOCKOUT_THRESHOLD=10
ACCOUNT_LOCKOUT_DURATION_MINUTES=15
CSP_REPORT_ONLY=false
# CSP_REPORT_URI=

# --- Privacy (recommended for GDPR) ---
AUDIT_LOG_IP_MODE=hashed
AUDIT_LOG_IP_SALT=CHANGE_ME_GENERATE_32_CHAR_SALT

# --- First Admin (optional - or use /setup UI) ---
# ADMIN_EMAIL=admin@example.com
# ADMIN_PASSWORD=SecurePassword123!

# --- n8n Ingestion (optional) ---
TRACE_INGEST_USER=trace_ingest
TRACE_INGEST_PASSWORD=CHANGE_ME_GENERATE_SECURE_PASSWORD

# --- Features ---
METRICS_ENABLED=true
RETENTION_ENABLED=true
RETENTION_DAYS=90
RETENTION_RUN_AT=03:30
RETENTION_TZ=UTC

# --- Database (usually unchanged) ---
# DATABASE_URL is constructed from POSTGRES_PASSWORD in compose
```

---

## Production Checklist

### Required (Enforced by fail-fast)
- [ ] `JWT_SECRET` is at least 32 characters
- [ ] `JWT_SECRET` does not contain placeholder values
- [ ] `COOKIE_SECURE=true` (when using HTTPS)
- [ ] `CORS_ORIGIN` is exact URL (not `*`)
- [ ] `AUDIT_LOG_IP_SALT` set if `AUDIT_LOG_IP_MODE=hashed`

### Required (Manual verification)
- [ ] TLS/HTTPS termination configured
- [ ] `APP_URL` matches actual public URL
- [ ] `CORS_ORIGIN` matches `APP_URL`
- [ ] `.env` file not committed to git
- [ ] Secrets generated securely (not copy-pasted examples)

### Recommended
- [ ] `AUDIT_LOG_IP_MODE=hashed` for GDPR compliance
- [ ] `PASSWORD_MIN_LENGTH` ≥ 12
- [ ] `ACCOUNT_LOCKOUT_THRESHOLD` ≤ 10
- [ ] `CSP_REPORT_ONLY=false` (enforcing mode)
- [ ] `RETENTION_ENABLED=true` to prevent unbounded growth
- [ ] `METRICS_ENABLED=true` if using metrics features
- [ ] Database backups configured

---

## Quick Reference: Generate Secrets

```bash
# JWT Secret (32+ chars)
openssl rand -base64 32

# Database password
openssl rand -base64 24

# Audit log IP salt
openssl rand -base64 32
```

---

## Frontend Environment Variables

The frontend is built at Docker image build time. These variables are baked into the image:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | (empty = relative `/api`) | Backend API URL. Usually not needed. |
| `VITE_DATA_MODE` | `api` | Data source mode. Keep as `api`. |

**Note:** Frontend env vars are set at build time, not runtime. The default configuration (empty `VITE_API_BASE_URL`) works correctly because the frontend is served by the same Express server.
