# Backend Architecture

n8n-trace backend is an Express.js REST API providing authentication, authorization, and data access for workflow execution / metrics analytics.

## Table of Contents

<!-- TOC -->

- [Backend Architecture](#backend-architecture)
  - [Table of Contents](#table-of-contents)
  - [Technology Stack](#technology-stack)
  - [Project Structure](#project-structure)
  - [Database Schema](#database-schema)
    - [Tables Overview](#tables-overview)
    - [Primary Keys](#primary-keys)
    - [Core Tables](#core-tables)
      - [`app_users`](#app_users)
      - [`user_password_tokens`](#user_password_tokens)
      - [`executions` (multi-tenant)](#executions-multi-tenant)
      - [Metrics Explorer Tables](#metrics-explorer-tables)
  - [Migrations](#migrations)
  - [API Endpoints](#api-endpoints)
    - [Health](#health)
    - [Setup (First Run)](#setup-first-run)
    - [Authentication](#authentication)
    - [Data (Scope-filtered)](#data-scope-filtered)
    - [Metrics](#metrics)
      - [Metrics Catalog Behavior](#metrics-catalog-behavior)
      - [Aggregation Parameter](#aggregation-parameter)
      - [Metric Type Semantics](#metric-type-semantics)
    - [Admin (requires `admin:users` permission)](#admin-requires-adminusers-permission)
    - [Debug (development only)](#debug-development-only)
  - [RBAC (Role-Based Access Control)](#rbac-role-based-access-control)
    - [Default Roles](#default-roles)
    - [Default Permissions](#default-permissions)
    - [Role → Permission Mapping](#role--permission-mapping)
    - [Scope Types](#scope-types)
  - [Authentication Flow](#authentication-flow)
    - [Token Invalidation](#token-invalidation)
  - [n8n Data Ingestion](#n8n-data-ingestion)
    - [TRACE\_INGEST\_USER](#trace_ingest_user)
  - [Building \& Running](#building--running)
    - [Local Development](#local-development)
    - [Docker](#docker)
    - [Health Check](#health-check)
  - [Environment Variables](#environment-variables)
    - [Required](#required)
    - [Optional](#optional)

<!-- /TOC -->

---

## Technology Stack

| Component | Technology | Version |
|-----------|------------|--------|
| Runtime | Node.js | 22+ |
| Framework | Express.js | 5.x |
| Database | PostgreSQL | 17+ |
| Auth | JWT + HttpOnly Cookies | - |
| Migrations | node-pg-migrate | 8.x |
| Password Hashing | bcryptjs | 3.x (BCRYPT_ROUNDS=10) |
| Rate Limiting | express-rate-limit | 8.x |
| Security | helmet | 8.x |
| Scheduler | node-cron | 4.x |
| Database Client | pg | 8.x |

---

## Project Structure

```
backend/
├── index.js                    # Entry point
├── package.json                # Dependencies and scripts
│
├── src/
│   ├── app.js                  # Express app factory (API + static serving)
│   ├── server.js               # Server startup
│   │
│   ├── config/
│   │   ├── index.js            # Config exports (BCRYPT_ROUNDS, etc.)
│   │   └── env.js              # Environment validation (fail-fast)
│   │
│   ├── db/
│   │   ├── pool.js             # PostgreSQL connection pool
│   │   └── autoInit.js         # Auto-migration & seeding
│   │
│   ├── middleware/
│   │   ├── auth.js             # JWT auth, permissions
│   │   ├── csrf.js             # CSRF protection
│   │   └── rateLimiters.js     # Rate limiting
│   │
│   ├── services/
│   │   ├── audit.js            # Audit logging
│   │   ├── authz.js            # RBAC authorization
│   │   ├── metricsExplorer.js  # Metrics Explorer queries
│   │   ├── retention.js        # Data retention cleanup
│   │   └── passwordTokens.js   # Password reset tokens
│   │
│   ├── routes/
│   │   ├── health.js           # Health endpoints
│   │   ├── setup.js            # Initial setup
│   │   ├── auth.js             # Authentication
│   │   ├── data.js             # Workflows, executions
│   │   ├── admin.js            # Admin management
│   │   └── metrics.js          # Instance metrics
│   │
│   └── utils/
│       ├── labels.js           # Label utilities
│       ├── password.js         # Password strength validation & denylist
│       └── sql.js              # SQL helpers
│
├── migrations/                 # Database migrations

```

---

## Database Schema

### Tables Overview

| Table | Purpose |
|-------|--------|
| `app_users` | User accounts |
| `groups` | RBAC groups |
| `roles` | Permission roles (admin, analyst, viewer) |
| `permissions` | Granular permissions |
| `user_groups` | User ↔ Group mapping |
| `group_roles` | Group ↔ Role mapping |
| `role_permissions` | Role ↔ Permission mapping |
| `group_scopes` | Group instance/workflow/tag scopes |
| `user_scopes` | User-level scopes |
| `user_password_tokens` | Password reset/invite tokens |
| `audit_log` | Security event log |
| `workflows_index` | Workflow metadata (from n8n) |
| `executions` | Execution records (from n8n) |
| `execution_nodes` | Node execution details (from n8n) |
| `n8n_metrics_snapshot` | Instance health snapshots (from n8n) |
| `metrics_series` | Metrics Explorer series definitions |
| `metrics_samples` | Metrics Explorer time-series data |

### Primary Keys

| Table | Primary Key | Type |
|-------|-------------|------|
| `app_users` | `id` (UUID) | Single |
| `workflows_index` | `workflow_id` | Single |
| `executions` | `(instance_id, execution_id)` | Composite |
| `execution_nodes` | `(instance_id, execution_id, node_name, run_index)` | Composite |
| `n8n_metrics_snapshot` | `id` (UUID) | Single |
| `metrics_series` | `id` (BIGSERIAL) | Single |
| `metrics_samples` | `(series_id, ts)` | Composite |

### Core Tables

#### `app_users`
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
email           TEXT NOT NULL UNIQUE
password_hash   TEXT              -- NULL until password set
is_active       BOOLEAN DEFAULT true
token_version   INTEGER DEFAULT 0 -- Incremented to invalidate sessions
failed_login_attempts INTEGER DEFAULT 0
locked_until    TIMESTAMPTZ       -- NULL unless locked
password_set_at TIMESTAMPTZ
created_at      TIMESTAMPTZ DEFAULT now()
updated_at      TIMESTAMPTZ DEFAULT now()
```

#### `user_password_tokens`
```sql
id              UUID PRIMARY KEY
user_id         UUID REFERENCES app_users(id) ON DELETE CASCADE
token_hash      TEXT NOT NULL
type            TEXT NOT NULL     -- 'reset_password' | 'invite_set_password'
expires_at      TIMESTAMPTZ NOT NULL
used_at         TIMESTAMPTZ       -- NULL until used
created_at      TIMESTAMPTZ DEFAULT now()
```

#### `executions` (multi-tenant)
```sql
PRIMARY KEY (instance_id, execution_id)

instance_id     TEXT NOT NULL
execution_id    TEXT NOT NULL
workflow_id     TEXT REFERENCES workflows_index(workflow_id)
status          TEXT NOT NULL     -- 'success' | 'error' | 'running' | 'waiting'
finished        BOOLEAN NOT NULL
mode            TEXT NOT NULL
started_at      TIMESTAMPTZ NOT NULL
stopped_at      TIMESTAMPTZ
duration_ms     BIGINT
inserted_at     TIMESTAMPTZ DEFAULT now()
```

#### Metrics Explorer Tables
```sql
-- metrics_series: unique metric name + label combinations
metrics_series (
  id            BIGSERIAL PRIMARY KEY,
  instance_id   TEXT NOT NULL,
  metric_name   TEXT NOT NULL,
  labels        JSONB DEFAULT '{}',
  first_seen    TIMESTAMPTZ DEFAULT now(),
  last_seen     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(instance_id, metric_name, labels)
)

-- metrics_samples: time-series data points
metrics_samples (
  series_id     BIGINT REFERENCES metrics_series(id) ON DELETE CASCADE,
  ts            TIMESTAMPTZ NOT NULL,
  value         DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (series_id, ts)
)
```

---

## Migrations

Migrations run automatically on startup via `src/db/autoInit.js`.

| Migration | Purpose |
|-----------|--------|
| `init-schema` | Core tables |
| `add-password-tokens` | `user_password_tokens` table |
| `add-token-version` | Session invalidation |
| `retention-and-audit` | Audit log, retention tracking |
| `multi-tenant-executions` | Composite PK for multi-tenant |
| `add-metrics-snapshot` | n8n metrics table |
| `retention-indexes` | Indexes for retention batch DELETEs |
| `add-metrics-explorer` | Metrics Explorer tables |
| `add-executions-instance-started-index` | Composite index `(instance_id, started_at DESC)` — see [Deployment → Database Migrations](./deployment.md#database-migrations) |
| `performance-indexes` | Indexes on `execution_nodes(workflow_id)` and `audit_log(action, created_at)` |

```bash
# Manual commands
npm run migrate up
npm run migrate down
npm run migrate:create -- my-migration
```

---

## API Endpoints

### Health

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/health` | Database connectivity | No |
| GET | `/ready` | Application readiness | No |

### Setup (First Run)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/setup/status` | Check if setup required | No |
| POST | `/api/setup/initial-admin` | Create first admin | No |

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Login | No |
| POST | `/api/auth/logout` | Logout | Yes |
| GET | `/api/auth/me` | Current user info | Yes |
| POST | `/api/auth/forgot-password` | Request reset | No |
| POST | `/api/auth/reset-password` | Reset with token | No |
| POST | `/api/auth/set-password` | Set password (invite) | No |
| POST | `/api/auth/validate-token` | Validate reset/invite token | No |
| POST | `/api/auth/revoke-all-sessions` | Revoke all sessions for current user | Yes |

### Data (Scope-filtered)

| Method | Endpoint | Description | Auth | Permission |
|--------|----------|-------------|------|------------|
| GET | `/api/workflows` | List workflows | Yes | `read:workflows` |
| GET | `/api/workflows/status` | Active/inactive counts | Yes | `read:workflows` |
| GET | `/api/executions` | List executions | Yes | `read:executions` |
| GET | `/api/execution-nodes` | Node details | Yes | `read:nodes` |

### Metrics

| Method | Endpoint | Description | Auth | Permission |
|--------|----------|-------------|------|------------|
| GET | `/api/metrics/config` | Feature config | Yes | - |
| GET | `/api/metrics/instances` | Accessible instances | Yes | `metrics.read.*` |
| GET | `/api/metrics/latest` | Latest snapshot | Yes | `metrics.read.full` |
| GET | `/api/metrics/timeseries` | Time series | Yes | `metrics.read.full` |
| GET | `/api/metrics/catalog` | Available metrics | Yes | `metrics.read.full` |
| POST | `/api/metrics/query` | Query metrics | Yes | `metrics.read.full` |
| GET | `/api/metrics/explorer/catalog` | Explorer catalog | Yes | `metrics.read.full` |
| GET | `/api/metrics/explorer/labels` | Label values | Yes | `metrics.read.full` |
| POST | `/api/metrics/explorer/query` | Explorer query | Yes | `metrics.read.full` |

#### Metrics Catalog Behavior

The catalog endpoint returns one entry per `metric_name`, aggregating metadata across all series:
- Includes metrics with empty labels (`labels = '{}'`)
- `labelKeys`: Array of all distinct label keys across series
- `metricType` and `help`: Deterministically selected non-null value (or `null` if all are null)

#### Aggregation Parameter

The `/api/metrics/explorer/query` endpoint accepts an `aggregation` parameter:

| Value | Behavior |
|-------|----------|
| `avg` | Average of samples in each time bucket (default) |
| `sum` | Sum of samples in each time bucket |
| `max` | Maximum sample in each time bucket |
| `none` | Treated as `avg` to maintain datapoint limits |

Aggregation applies **within each time bucket per series** (downsampling), not across series.

#### Metric Type Semantics

**Gauges:**
- Card view: Returns `last` value
- Line view: Returns downsampled values using selected aggregation
- Response includes `meta.computedAs: 'last'` or `meta.computedAs: 'avg'`

**Counters:**
- Card view: Returns `rate` (increase per second over time range)
- Line view: Returns `delta` per bucket (handles counter resets)
- Response includes `meta.computedAs: 'rate'` or `meta.computedAs: 'delta'`
- Aggregation parameter is ignored for counters (always delta/rate)

**Histogram Suffix Metrics** (`_sum`, `_count`, `_bucket`):
- Treated as counters with delta/rate semantics (Recommendation C)
- `avg_latency` derivation not implemented in this release
- Response includes `meta.computedAs: 'delta'` or `meta.computedAs: 'rate'`

### Admin (requires `admin:users` permission)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/users` | List users |
| POST | `/api/admin/users` | Create/invite user |
| PATCH | `/api/admin/users/:userId` | Update user |
| DELETE | `/api/admin/users/:userId` | Delete user |
| PUT | `/api/admin/users/:userId/groups` | Update user groups |
| POST | `/api/admin/users/:userId/regenerate-invite` | Regenerate invite |
| POST | `/api/admin/users/:userId/reset-password-link` | Generate reset link |
| GET | `/api/admin/groups` | List groups |
| POST | `/api/admin/groups` | Create group |
| PUT | `/api/admin/groups/:groupId` | Update group |
| DELETE | `/api/admin/groups/:groupId` | Delete group |
| GET | `/api/admin/roles` | List roles |
| GET | `/api/admin/roles-with-permissions` | Roles with permissions |
| GET | `/api/admin/audit-logs` | View audit logs |
| GET | `/api/admin/audit-log-actions` | Available audit actions |
| GET | `/api/admin/retention/status` | Retention status |
| POST | `/api/admin/retention/run` | Trigger retention |
| POST | `/api/admin/users/:userId/revoke-sessions` | Revoke all user sessions |
| POST | `/api/admin/users/:userId/unlock` | Unlock a locked account |

### Debug (development only)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/debug/ip` | Show client IP | No (dev-only, gated by `DEBUG_IP` flag) |

---

## RBAC (Role-Based Access Control)

### Default Roles

| Role | Description |
|------|-------------|
| `admin` | Full access |
| `analyst` | Read + export + full metrics |
| `viewer` | Read-only, basic metrics |

### Default Permissions

| Permission | Description |
|------------|-------------|
| `admin:users` | Manage users |
| `admin:roles` | Manage roles |
| `admin:groups` | Manage groups |
| `read:workflows` | Read workflows |
| `read:executions` | Read executions |
| `read:nodes` | Read execution nodes |
| `export:data` | Export data |
| `metrics.read.version` | Read n8n version only |
| `metrics.read.full` | Read all metrics |
| `metrics.manage` | Manage metrics config |

### Role → Permission Mapping

| Role | Permissions |
|------|-------------|
| admin | All permissions |
| analyst | `read:*`, `export:data`, `metrics.read.version`, `metrics.read.full` |
| viewer | `read:*`, `metrics.read.version` |

### Scope Types

| Scope | Effect | Instance Metrics |
|-------|--------|------------------|
| Instance | See all data in instance | ✅ Yes |
| Workflow | See specific workflow | ❌ No |
| Tag | See workflows with tag | ❌ No |
| Global (no scope) | Admin: all; Others: nothing | Admin only |

---

## Authentication Flow

1. User POSTs `/api/auth/login` with `{email, password}`
2. Backend verifies against `app_users.password_hash`
3. JWT generated with `{userId, tokenVersion}`
4. JWT stored in HttpOnly cookie `n8n_trace_token`
5. Subsequent requests validated via cookie
6. If `token_version` changed, JWT rejected

### Token Invalidation

Password change increments `token_version`, invalidating all sessions.

---

## n8n Data Ingestion

### TRACE_INGEST_USER

Restricted PostgreSQL user for n8n to write data:

```sql
-- Allowed tables:
GRANT SELECT, INSERT, UPDATE ON workflows_index TO trace_ingest;
GRANT SELECT, INSERT, UPDATE ON executions TO trace_ingest;
GRANT SELECT, INSERT, UPDATE ON execution_nodes TO trace_ingest;
GRANT SELECT, INSERT, UPDATE ON n8n_metrics_snapshot TO trace_ingest;
GRANT SELECT, INSERT, UPDATE ON metrics_series TO trace_ingest;
GRANT SELECT, INSERT, UPDATE ON metrics_samples TO trace_ingest;

-- Cannot access: app_users, audit_log, RBAC tables
-- Cannot DELETE any data
```

---

## Building & Running

### Local Development

```bash
cd backend
npm install
export DATABASE_URL="postgres://user:pass@localhost:5432/n8n_trace"
export JWT_SECRET="your-32-char-secret"
npm run dev
```

### Docker

```bash
# Build unified image (from repo root)
docker build -t n8n_trace:local .
docker compose -f docker-compose.prod.yml up -d --build
```

### Health Check

```bash
curl http://localhost:8899/health
# {"ok":true,"db":"connected"}
```

---

## Environment Variables

See [Configuration Reference](./configuration.md) for complete list.

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Min 32 characters |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8001` | HTTP port |
| `APP_ENV` | `production` | `production` or `development` |
| `TRUST_PROXY` | `false` | Proxy hops |
| `LOG_FORMAT` | `json` (prod) / `dev` | Morgan format |
