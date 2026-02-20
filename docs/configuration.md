# Configuration Reference

All configuration is via environment variables. Never commit real secrets.

<!-- TOC -->

- [Configuration Reference](#configuration-reference)
    - [Required Variables](#required-variables)
    - [Application](#application)
    - [Security](#security)
    - [Privacy / GDPR](#privacy--gdpr)
    - [Authentication](#authentication)
        - [First Admin Creation](#first-admin-creation)
    - [n8n Ingestion Optional](#n8n-ingestion-optional)
    - [Metrics Feature Optional](#metrics-feature-optional)
    - [Data Retention Optional](#data-retention-optional)
        - [What Retention Deletes](#what-retention-deletes)
        - [What Retention Does NOT Touch](#what-retention-does-not-touch)
        - [Safety Guarantees](#safety-guarantees)
    - [Database](#database)
    - [Example .env File](#example-env-file)

<!-- /TOC -->

## Required Variables

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Database password |
| `JWT_SECRET` | Session signing key (**min 32 characters**) |
| `DATABASE_URL` | PostgreSQL connection string |

> Generate a secure JWT_SECRET: `openssl rand -base64 32`

## Application

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_ENV` | `development` | `production` or `development` |
| `APP_URL` | `http://localhost:8899` | Public URL (used for links, CORS) |
| `PORT` | `8001` | Backend HTTP port (internal) |
| `HTTP_PORT` | `8899` | Frontend exposed port |

## Security

| Variable | Default | Description |
|----------|---------|-------------|
| `COOKIE_SECURE` | `true` (prod) | Must be `true` for HTTPS |
| `COOKIE_SAMESITE` | `lax` | Cookie SameSite policy |
| `COOKIE_DOMAIN` | (empty) | Cookie domain (usually not needed) |
| `CORS_ORIGIN` | (required) | Frontend origin URL |
| `TRUST_PROXY` | `1` | Proxy hops to trust for client IP |

## Privacy / GDPR

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIT_LOG_IP_MODE` | `raw` | `raw`, `hashed`, or `none` |
| `AUDIT_LOG_IP_SALT` | — | Required if mode is `hashed` (min 32 chars) |

> **GDPR Compliance**: Use `AUDIT_LOG_IP_MODE=hashed` or `none` to avoid storing raw IP addresses.

## Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_EXPIRY` | `30m` | Session token lifetime |

### First Admin Creation

Two options for creating the first admin:

1. **Interactive (Recommended)**: Navigate to `/setup` on first run
2. **Environment**: Set **both** variables below:

| Variable | Description |
|----------|-------------|
| `ADMIN_EMAIL` | Initial admin email |
| `ADMIN_PASSWORD` | Initial admin password |

> **Warning**: Do not hardcode admin credentials in compose files.

## n8n Ingestion (Optional)

Restricted database user for n8n to write execution data:

| Variable | Description |
|----------|-------------|
| `PULSE_INGEST_USER` | Ingest DB username |
| `PULSE_INGEST_PASSWORD` | Ingest DB password |

The ingest user can only SELECT/INSERT/UPDATE on execution tables. No access to auth, audit, or RBAC tables.

## Metrics Feature (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_ENABLED` | `false` | Enable instance metrics dashboard |
| `METRICS_MAX_TIME_RANGE_DAYS` | `30` | Max queryable range |
| `METRICS_MAX_DATAPOINTS` | `1000` | Max points per query |

## Data Retention (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `RETENTION_ENABLED` | `false` | Enable automatic cleanup |
| `RETENTION_DAYS` | `90` | Days to keep data |
| `RETENTION_RUN_AT` | `03:30` | Daily cleanup time (HH:MM, server time) |

### What Retention Deletes

When enabled, the retention job removes records older than `RETENTION_DAYS` from:

| Table | Primary Key | Deletion Rule |
|-------|-------------|---------------|
| `executions` | `(instance_id, execution_id)` | Finished executions only (running executions are never deleted) |
| `execution_nodes` | `(instance_id, execution_id, node_name, run_index)` | Orphaned nodes (parent execution deleted) |
| `workflows_index` | `workflow_id` | Orphaned workflows only (not referenced by any execution) |
| `n8n_metrics_snapshot` | `id` | Snapshots older than cutoff |
| `audit_log` | `id` | Log entries older than cutoff |

### What Retention Does NOT Touch

These tables are **never** affected by retention:

- `app_users` - User accounts
- `groups`, `roles`, `permissions` - RBAC configuration
- `user_groups`, `group_roles`, `role_permissions` - RBAC assignments
- `user_password_tokens` - Password reset tokens
- `pgmigrations` - Migration tracking

### Safety Guarantees

1. **Running executions preserved**: Only `finished = true` executions are deleted
2. **Batched deletions**: 10,000 records per batch with 50ms pauses (prevents table locks)
3. **Advisory lock**: Only one retention job runs at a time across all instances
4. **FK safety**: `execution_nodes` cleaned via orphan detection after parent deletion

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | (required) | `postgres://user:pass@host:5432/db` |
| `POSTGRES_USER` | `n8n_pulse` | Database user (compose) |
| `POSTGRES_DB` | `n8n_pulse` | Database name (compose) |
| `DB_POOL_MAX` | `20` | Connection pool max |
| `DB_IDLE_TIMEOUT` | `30000` | Idle timeout (ms) |
| `DB_CONNECT_TIMEOUT` | `10000` | Connect timeout (ms) |

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

# Optional features
METRICS_ENABLED=true
RETENTION_ENABLED=true
RETENTION_DAYS=90
```
