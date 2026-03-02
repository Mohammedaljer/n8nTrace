# Configuration Reference

All configuration is via environment variables. Never commit real secrets.

<!-- TOC -->

- [Required Variables](#required-variables)
- [Application](#application)
- [Security](#security)
- [Privacy / GDPR](#privacy--gdpr)
- [Authentication](#authentication)
- [n8n Ingestion](#n8n-ingestion-optional)
- [Metrics Feature](#metrics-feature-optional)
- [Data Retention](#data-retention-optional)
- [Database](#database)
- [Example .env File](#example-env-file)

<!-- /TOC -->

## Required Variables

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Database password |
| `JWT_SECRET` | Session signing key (**min 32 characters**) |
| `DATABASE_URL` | PostgreSQL connection string |

> Generate secrets: `openssl rand -base64 32`

## Application

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_ENV` | `production` | `production` enables fail-fast security checks |
| `APP_URL` | `http://localhost:3000` (dev) | Public URL for links |
| `PORT` | `8001` | Application HTTP port (internal) |
| `HTTP_PORT` | `8899` | Published port (Docker host mapping) |

> **Important**: In production, `APP_ENV=production` enforces security requirements.

## Security

| Variable | Default | Description |
|----------|---------|-------------|
| `COOKIE_SECURE` | `true` (prod) / `false` (dev) | **Must be `true` with HTTPS** |
| `COOKIE_SAMESITE` | `lax` | Cookie SameSite policy |
| `COOKIE_DOMAIN` | (empty) | Cookie domain |
| `CORS_ORIGIN` | (required in prod) | Frontend origin URL |
| `TRUST_PROXY` | `false` | Proxy hops to trust (see [Proxy Trust Model](./architecture.md#proxy-trust-model)) |
| `PASSWORD_MIN_LENGTH` | `12` | Minimum password length |
| `ACCOUNT_LOCKOUT_THRESHOLD` | `10` | Failed login attempts before lockout |
| `ACCOUNT_LOCKOUT_DURATION_MINUTES` | `15` | Lockout duration in minutes |
| `CSP_REPORT_ONLY` | `false` | CSP report-only mode (for testing) |
| `CSP_REPORT_URI` | (empty) | URL for CSP violation reports |
| `LOG_FORMAT` | `json` (prod) / `dev` (dev) | HTTP request log format (Morgan) |

> **Warning**: In production, backend refuses to start if `COOKIE_SECURE=false`.

> **Note**: Set `TRUST_PROXY=1` when behind a reverse proxy (Traefik, Caddy, NGINX, ALB). Leave as `false` for direct access. See [Architecture → Proxy Trust Model](./architecture.md#proxy-trust-model).

## Privacy / GDPR

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIT_LOG_IP_MODE` | `raw` | `raw`, `hashed`, or `none` |
| `AUDIT_LOG_IP_SALT` | — | Required if mode is `hashed` (recommended min 32 chars) |

## Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_EXPIRY` | `30m` | Session token lifetime |

### First Admin Creation

Two options:

1. **Interactive (Recommended)**: Navigate to `/setup` on first run
2. **Environment**: Set **both** `ADMIN_EMAIL` and `ADMIN_PASSWORD`

## n8n Ingestion (Optional)

| Variable | Description |
|----------|-------------|
| `PULSE_INGEST_USER` | Ingest DB username |
| `PULSE_INGEST_PASSWORD` | Ingest DB password |

The ingest user has least-privilege access to execution tables only.

## Metrics Feature (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_ENABLED` | `false` | Enable metrics dashboard |
| `METRICS_MAX_TIME_RANGE_DAYS` | `30` | Max queryable range |
| `METRICS_MAX_DATAPOINTS` | `1000` | Max points per query |
| `METRICS_MAX_BREAKDOWN_ROWS` | `50` | Max breakdown rows |
| `METRICS_MAX_CATALOG_SIZE` | `200` | Max catalog entries |
| `METRICS_MAX_LABEL_VALUES` | `100` | Max label values |

## Data Retention (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `RETENTION_ENABLED` | `false` | Enable automatic cleanup |
| `RETENTION_DAYS` | `90` | Days to keep data |
| `RETENTION_RUN_AT` | `03:30` | Daily cleanup time (HH:MM) |
| `RETENTION_TZ` | `UTC` | Timezone for schedule |

### What Retention Deletes

| Table | Rule |
|-------|---------|
| `executions` | Finished executions older than cutoff |
| `execution_nodes` | Orphaned nodes |
| `workflows_index` | Orphaned workflows |
| `n8n_metrics_snapshot` | Snapshots older than cutoff |
| `metrics_samples` | Samples older than cutoff |
| `metrics_series` | Orphan series (no samples) |
| `audit_log` | Entries older than cutoff |

### Never Touched

- `app_users`
- `groups`, `roles`, `permissions`
- `user_groups`, `group_roles`, `role_permissions`
- `user_password_tokens`

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | (required) | `postgres://user:pass@host:5432/db` |
| `POSTGRES_USER` | `n8n_pulse` | Database user |
| `POSTGRES_DB` | `n8n_pulse` | Database name |
| `DB_POOL_MAX` | `20` | Connection pool max |
| `DB_IDLE_TIMEOUT` | `30000` | Idle timeout (ms) |
| `DB_CONNECT_TIMEOUT` | `5000` | Connect timeout (ms) |

## Example .env File

```bash
# Required
POSTGRES_PASSWORD=<strong-random-password>
JWT_SECRET=<min-32-character-secret>

# Production
APP_ENV=production
APP_URL=https://pulse.example.com
CORS_ORIGIN=https://pulse.example.com
COOKIE_SECURE=true

# Privacy
AUDIT_LOG_IP_MODE=hashed
AUDIT_LOG_IP_SALT=<32-char-salt>

# Optional features
METRICS_ENABLED=true
RETENTION_ENABLED=true
RETENTION_DAYS=90
```
