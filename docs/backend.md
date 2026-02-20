# Backend Architecture

n8n Pulse backend is an Express.js REST API providing authentication, authorization, and data access for workflow execution analytics.

## Table of Contents

<!-- TOC -->

- [Backend Architecture](#backend-architecture)
  - [Table of Contents](#table-of-contents)
  - [Technology Stack](#technology-stack)
  - [Project Structure](#project-structure)
  - [Module Architecture](#module-architecture)
  - [Database Schema](#database-schema)
    - [Primary Keys Summary](#primary-keys-summary)
    - [Core Tables](#core-tables)
      - [`app_users` - User accounts](#app_users---user-accounts)
      - [`groups` - RBAC groups](#groups---rbac-groups)
      - [`roles` - Permission roles (admin, analyst, viewer)](#roles---permission-roles-admin-analyst-viewer)
      - [`permissions` - Granular permissions](#permissions---granular-permissions)
    - [n8n Data Tables (populated by PULSE\_INGEST\_USER)](#n8n-data-tables-populated-by-pulse_ingest_user)
      - [`workflows_index` - Workflow metadata](#workflows_index---workflow-metadata)
      - [`executions` - Workflow execution records](#executions---workflow-execution-records)
      - [`execution_nodes` - Node-level execution details](#execution_nodes---node-level-execution-details)
      - [`n8n_metrics_snapshot` - Instance health metrics](#n8n_metrics_snapshot---instance-health-metrics)
    - [RBAC Join Tables](#rbac-join-tables)
    - [Security Tables](#security-tables)
      - [`audit_log` - Security event log](#audit_log---security-event-log)
      - [`password_reset_tokens` - Password reset flow](#password_reset_tokens---password-reset-flow)
  - [Migrations](#migrations)
    - [Migration Files](#migration-files)
    - [Manual Migration Commands](#manual-migration-commands)
  - [Migrations](#migrations-1)
    - [Migration Files](#migration-files-1)
    - [Manual Migration Commands](#manual-migration-commands-1)
  - [API Endpoints](#api-endpoints)
    - [Health](#health)
    - [Setup (First Run)](#setup-first-run)
    - [Authentication](#authentication)
    - [Data (Scope-filtered)](#data-scope-filtered)
    - [Metrics](#metrics)
    - [Admin (Admin role required)](#admin-admin-role-required)
  - [RBAC (Role-Based Access Control)](#rbac-role-based-access-control)
    - [Scope Types](#scope-types)
    - [Tag Matching](#tag-matching)
    - [Authorization Flow](#authorization-flow)
    - [Per-Request Caching](#per-request-caching)
  - [Authentication Flow](#authentication-flow)
    - [Token Invalidation](#token-invalidation)
  - [n8n Data Ingestion](#n8n-data-ingestion)
    - [PULSE\_INGEST\_USER](#pulse_ingest_user)
    - [How n8n Sends Data](#how-n8n-sends-data)
    - [Environment Variables for Ingestion](#environment-variables-for-ingestion)
  - [Building \& Running](#building--running)
    - [Local Development](#local-development)
    - [Docker Build](#docker-build)
    - [Docker Compose](#docker-compose)
    - [Health Check](#health-check)
  - [Environment Variables](#environment-variables)
    - [Required](#required)
    - [Optional](#optional)

<!-- /TOC -->
---

## Technology Stack

| Component | Technology | Version |
|-----------|------------|--------|
| Runtime | Node.js | 20+ |
| Framework | Express.js | 5.x |
| Database | PostgreSQL | 16+ |
| Auth | JWT + HttpOnly Cookies | - |
| Migrations | node-pg-migrate | 8.x |
| Password Hashing | bcryptjs | 3.x |
| Rate Limiting | express-rate-limit | 8.x |
| Security | helmet | 8.x |
| Scheduler | node-cron | 4.x |

---

## Project Structure

```
backend/
├── index.js                    # Entry point (loads src/server.js)
├── package.json                # Dependencies and scripts
├── Dockerfile                  # Production Docker image
├── .dockerignore               # Docker build exclusions
│
├── src/                        # Application source code
│   ├── app.js                  # Express app factory
│   ├── server.js               # Server startup & initialization
│   │
│   ├── config/                 # Configuration
│   │   ├── index.js            # Main config exports
│   │   └── env.js              # Environment variable parsing
│   │
│   ├── db/                     # Database
│   │   ├── pool.js             # PostgreSQL connection pool
│   │   └── autoInit.js         # Auto-migration & seeding
│   │
│   ├── middleware/             # Express middleware
│   │   ├── auth.js             # JWT auth, permissions, session mgmt
│   │   ├── csrf.js             # CSRF protection
│   │   └── rateLimiters.js     # Rate limiting configs
│   │
│   ├── services/               # Business logic
│   │   ├── audit.js            # Audit logging
│   │   ├── authz.js            # RBAC authorization & scopes
│   │   ├── retention.js        # Data retention cleanup
│   │   └── passwordTokens.js   # Password reset tokens
│   │
│   ├── routes/                 # API route handlers
│   │   ├── health.js           # Health check endpoints
│   │   ├── setup.js            # Initial setup flow
│   │   ├── auth.js             # Authentication endpoints
│   │   ├── data.js             # Workflows, executions, nodes
│   │   ├── admin.js            # Admin user/group management
│   │   └── metrics.js          # Instance metrics endpoints
│   │
│   └── utils/                  # Utilities
│       └── sql.js              # SQL query helpers
│
├── migrations/                 # Database migrations
│   ├── 1770649871121_init-schema.js
│   ├── 1770660000000_add-password-tokens.js
│   ├── 1770670000000_add-token-version.js
│   ├── 1770680000000_retention-and-audit.js
│   ├── 1770690000000_multi-tenant-executions.js
│   └── 1770700000000_add-metrics-snapshot.js
│
└── tests/                      # Test files
    └── rbac-regression.test.js # RBAC security tests
```


---
## Module Architecture

The backend uses a **dependency injection** pattern for clean separation and testability.

---

## Database Schema

### Primary Keys Summary

| Table | Primary Key | Type |
|-------|-------------|------|
| `app_users` | `id` (UUID) | Single |
| `workflows_index` | `workflow_id` | Single (globally unique) |
| `executions` | `(instance_id, execution_id)` | Composite (multi-tenant) |
| `execution_nodes` | `(instance_id, execution_id, node_name, run_index)` | Composite |
| `n8n_metrics_snapshot` | `id` (UUID) | Single |
| `audit_log` | `id` (UUID) | Single |
| `groups` | `id` (UUID) | Single |
| `roles` | `id` (UUID) | Single |
| `permissions` | `id` (UUID) | Single |

### Core Tables

#### `app_users` - User accounts
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
email           TEXT NOT NULL UNIQUE
password_hash   TEXT NOT NULL
is_active       BOOLEAN DEFAULT true
token_version   INTEGER DEFAULT 0  -- Incremented to invalidate sessions
created_at      TIMESTAMPTZ DEFAULT now()
updated_at      TIMESTAMPTZ DEFAULT now()
```

#### `groups` - RBAC groups
```sql
id              UUID PRIMARY KEY
name            TEXT NOT NULL UNIQUE
description     TEXT
created_at      TIMESTAMPTZ DEFAULT now()
```

#### `roles` - Permission roles (admin, analyst, viewer)
```sql
id              UUID PRIMARY KEY
key             TEXT NOT NULL UNIQUE  -- 'admin', 'analyst', 'viewer'
name            TEXT NOT NULL
created_at      TIMESTAMPTZ DEFAULT now()
```

#### `permissions` - Granular permissions
```sql
id              UUID PRIMARY KEY
key             TEXT NOT NULL UNIQUE  -- e.g., 'metrics.read.full'
description     TEXT
created_at      TIMESTAMPTZ DEFAULT now()
```

### n8n Data Tables (populated by PULSE_INGEST_USER)

#### `workflows_index` - Workflow metadata
```sql
workflow_id           TEXT PRIMARY KEY        -- Globally unique
instance_id           TEXT NOT NULL
name                  TEXT NOT NULL
active                BOOLEAN DEFAULT false
is_archived           BOOLEAN DEFAULT false
tags                  TEXT          -- JSON array as text: '[\"backup\",\"prod\"]'
nodes_count           INT4
node_types            TEXT          -- JSON array of node types
distinct_node_names   TEXT
created_at            TIMESTAMPTZ
updated_at            TIMESTAMPTZ
distinct_inserted_at  TIMESTAMPTZ

INDEX idx_workflows_instance_id ON (instance_id)
```

#### `executions` - Workflow execution records
```sql
PRIMARY KEY (instance_id, execution_id)       -- Composite key (multi-tenant)

instance_id           TEXT NOT NULL
execution_id          TEXT NOT NULL
workflow_id           TEXT REFERENCES workflows_index(workflow_id)
status                TEXT NOT NULL  -- 'success', 'error', 'running', 'waiting'
finished              BOOLEAN NOT NULL
mode                  TEXT NOT NULL  -- 'manual', 'trigger', 'webhook', etc.
started_at            TIMESTAMPTZ NOT NULL
stopped_at            TIMESTAMPTZ NOT NULL
duration_ms           BIGINT NOT NULL
wait_till             TIMESTAMPTZ
retry_of              TEXT
retry_success_id      TEXT
last_node_executed    TEXT
node_names_executed   TEXT
nodes_count           INT4
inserted_at           TIMESTAMPTZ DEFAULT now()

INDEX idx_executions_instance_id ON (instance_id)
INDEX idx_executions_status_started ON (status, started_at)
INDEX idx_executions_workflow_id ON (workflow_id)
```

#### `execution_nodes` - Node-level execution details
```sql
PRIMARY KEY (instance_id, execution_id, node_name, run_index)  -- Composite key

instance_id           TEXT NOT NULL
execution_id          TEXT NOT NULL
workflow_id           TEXT REFERENCES workflows_index(workflow_id)
node_name             TEXT NOT NULL
node_type             TEXT NOT NULL
run_index             INT4 DEFAULT 0
runs_count            INT4 DEFAULT 1
is_last_run           BOOLEAN DEFAULT false
execution_status      TEXT NOT NULL  -- 'success', 'error'
execution_time_ms     BIGINT DEFAULT 0
start_time_ms         BIGINT
start_time            TIMESTAMPTZ
items_out_count       INT4
items_out_total_all_runs INT4
inserted_at           TIMESTAMPTZ DEFAULT now()

FOREIGN KEY (instance_id, execution_id) REFERENCES executions(instance_id, execution_id) ON DELETE CASCADE
```

#### `n8n_metrics_snapshot` - Instance health metrics
```sql
id                    UUID PRIMARY KEY
instance_id           TEXT NOT NULL
ts                    TIMESTAMPTZ NOT NULL
n8n_version           TEXT
node_version          TEXT
process_start_time_seconds REAL
is_leader             BOOLEAN
active_workflows      INT4
cpu_total_seconds     REAL
memory_rss_bytes      BIGINT
heap_used_bytes       BIGINT
external_memory_bytes BIGINT
eventloop_lag_p99_s   REAL
open_fds              INT4
inserted_at           TIMESTAMPTZ DEFAULT now()
```

### RBAC Join Tables

```sql
-- User ↔ Group mapping
user_groups (user_id UUID, group_id UUID) PRIMARY KEY

-- Group ↔ Role mapping
group_roles (group_id UUID, role_id UUID) PRIMARY KEY

-- Role ↔ Permission mapping
role_permissions (role_id UUID, permission_id UUID) PRIMARY KEY

-- Group scopes (instance/workflow/tag filtering)
group_scopes (
  id UUID PRIMARY KEY,
  group_id UUID REFERENCES groups(id),
  instance_id TEXT,    -- NULL = all instances (if no tag/workflow)
  workflow_id TEXT,    -- Specific workflow access
  tag TEXT             -- Tag-based workflow filtering
)
```

### Security Tables

#### `audit_log` - Security event log
```sql
id                    UUID PRIMARY KEY
event_type            TEXT NOT NULL  -- 'login', 'logout', 'password_change', etc.
actor_id              UUID           -- User who performed action
target_id             UUID           -- User/resource affected
details               JSONB          -- Additional context
ip_address            TEXT           -- Client IP (hashed if AUDIT_LOG_IP_MODE=hashed)
created_at            TIMESTAMPTZ DEFAULT now()
```

#### `password_reset_tokens` - Password reset flow
```sql
id                    UUID PRIMARY KEY
user_id               UUID REFERENCES app_users(id)
token_hash            TEXT NOT NULL
token_type            TEXT NOT NULL  -- 'reset_password', 'invite_set_password'
expires_at            TIMESTAMPTZ NOT NULL
used                  BOOLEAN DEFAULT false
created_at            TIMESTAMPTZ DEFAULT now()
```

---

## Migrations

Migrations run automatically on backend startup via `src/db/autoInit.js`.

### Migration Files

| Migration | Purpose |
|-----------|--------|
| `init-schema` | Core tables: users, RBAC, executions, workflows, nodes |
| `add-password-tokens` | Password reset token table |
| `add-token-version` | Session invalidation support |
| `retention-and-audit` | Audit log + retention tracking tables |
| `multi-tenant-executions` | Composite PK `(instance_id, execution_id)` for multi-tenant support |
| `add-metrics-snapshot` | n8n instance metrics table |

### Manual Migration Commands

```bash
# Run pending migrations
npm run migrate up

# Rollback last migration
npm run migrate down

# Create new migration
npm run migrate:create -- my-migration-name
```

---

## Migrations

Migrations run automatically on backend startup.

### Migration Files

| Migration | Purpose |
|-----------|--------|
| `init-schema` | Core tables: users, RBAC, executions, workflows, nodes |
| `add-password-tokens` | Password reset token table |
| `add-token-version` | Session invalidation support |
| `retention-and-audit` | Audit log + retention tracking tables |
| `multi-tenant-executions` | Composite PK `(instance_id, execution_id)` for multi-tenant support |
| `add-metrics-snapshot` | n8n instance metrics table |
| `retention-indexes` | Indexes for retention job performance |

### Manual Migration Commands

```bash
# Run pending migrations
npm run migrate up

# Rollback last migration
npm run migrate down

# Create new migration
npm run migrate:create -- my-migration-name

# Mark migrations as run (without executing)
npm run migrate:up:fake
```

---

## API Endpoints

### Health

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/health` | Database connectivity check | No |

### Setup (First Run)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/setup/status` | Check if setup is required | No |
| POST | `/api/setup` | Create first admin user | No |

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Login with email/password | No |
| POST | `/api/auth/logout` | Logout (clears cookie) | Yes |
| GET | `/api/auth/me` | Get current user info | Yes |
| POST | `/api/auth/change-password` | Change own password | Yes |
| POST | `/api/auth/forgot-password` | Request password reset | No |
| POST | `/api/auth/reset-password` | Reset password with token | No |
| POST | `/api/auth/set-password` | Set password (invite flow) | No |

### Data (Scope-filtered)

| Method | Endpoint | Description | Auth | Permission |
|--------|----------|-------------|------|------------|
| GET | `/api/workflows` | List workflows | Yes | `read:workflows` |
| GET | `/api/workflows/status` | Workflow active/inactive counts | Yes | `read:workflows` |
| GET | `/api/executions` | List executions | Yes | `read:executions` |
| GET | `/api/execution-nodes` | Node execution details | Yes | `read:nodes` |

### Metrics

| Method | Endpoint | Description | Auth | Permission |
|--------|----------|-------------|------|------------|
| GET | `/api/metrics/config` | Metrics feature config | Yes | - |
| GET | `/api/metrics/instances` | List accessible instances | Yes | `metrics.read.*` |
| GET | `/api/metrics/latest` | Latest metrics snapshot | Yes | `metrics.read.*` + instance scope |
| GET | `/api/metrics/timeseries` | Time series for charts | Yes | `metrics.read.full` + instance scope |

### Admin (Admin role required)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/admin/users` | List users | Yes |
| POST | `/api/admin/users` | Create user | Yes |
| POST | `/api/admin/users/invite` | Invite user via email | Yes |
| PATCH | `/api/admin/users/:id` | Update user | Yes |
| DELETE | `/api/admin/users/:id` | Delete user | Yes |
| GET | `/api/admin/groups` | List groups | Yes |
| POST | `/api/admin/groups` | Create group | Yes |
| PATCH | `/api/admin/groups/:id` | Update group | Yes |
| DELETE | `/api/admin/groups/:id` | Delete group | Yes |
| GET | `/api/admin/roles` | List roles | Yes |
| GET | `/api/admin/audit` | View audit logs | Yes |
| GET | `/api/admin/retention` | Retention status | Yes |
| POST | `/api/admin/retention/run` | Trigger retention cleanup | Yes |

---

## RBAC (Role-Based Access Control)

### Scope Types

| Scope | Effect | Instance Metrics |
|-------|--------|------------------|
| **Tag** (`tag = 'backup'`) | See workflows with that tag (all instances) | ❌ No access |
| **Workflow ID** (`workflow_id = 'wf-123'`) | See specific workflow only | ❌ No access |
| **Instance** (`instance_id = 'prod'`) | See all workflows in instance | ✅ For that instance |
| **Global** (`instance_id = NULL, tag = NULL, workflow_id = NULL`) | See all workflows | ✅ All instances |
| **No scopes** | Default deny - see nothing | ❌ No access |

### Tag Matching

Tags are stored as JSON arrays: `'[\"backup\",\"prod\"]'`

Matching uses PostgreSQL JSONB operator for **exact membership**:
```sql
WHERE tags::jsonb ?| ARRAY['backup']::text[]
```

- `backup` matches `[\"backup\"]` ✅
- `backup` does NOT match `[\"backup2\"]` ✅ (no substring matching)

### Authorization Flow

```
Request → requireAuth → attachAuthz → getAuthorizationContext()
                                            │
                                            ├── Admin? → Return all data
                                            │
                                            ├── No scopes? → Return empty (default deny)
                                            │
                                            └── Has scopes? → Resolve allowedWorkflowIds
                                                              │
                                                              ├── Tag scopes → JSONB match
                                                              ├── Workflow ID scopes → Direct
                                                              └── Instance scopes → All in instance
```

### Per-Request Caching

Authorization context is cached on `req._authzCache` to avoid repeated DB queries within a single request.

---

## Authentication Flow

```
1. User POST /api/auth/login with {email, password}
2. Backend verifies credentials against app_users
3. Backend generates JWT with user ID, token_version
4. JWT stored in HttpOnly cookie (not accessible to JS)
5. Subsequent requests include cookie automatically
6. Backend validates JWT on each request
7. If token_version changed (password reset), JWT rejected
```


### Token Invalidation

When a user changes their password or an admin forces logout:
1. `token_version` column is incremented
2. All existing JWTs become invalid
3. User must re-authenticate

---

## n8n Data Ingestion

### PULSE_INGEST_USER

A restricted PostgreSQL user for n8n to write execution data directly.

**Permissions (least privilege):**
```sql
-- Can only modify these tables:
GRANT SELECT, INSERT, UPDATE ON workflows_index TO pulse_ingest;
GRANT SELECT, INSERT, UPDATE ON executions TO pulse_ingest;
GRANT SELECT, INSERT, UPDATE ON execution_nodes TO pulse_ingest;
GRANT SELECT, INSERT, UPDATE ON n8n_metrics_snapshot TO pulse_ingest;

-- CANNOT access:
-- app_users, audit_log, groups, roles, permissions, etc.
```

### How n8n Sends Data

1. Create a workflow in n8n with PostgreSQL node
2. Connect to Pulse database using `PULSE_INGEST_USER` credentials
3. Insert execution data after workflow runs
4. Optionally send metrics via scheduled workflow

**Example n8n workflow:**
```
[Trigger] → [Code: Format Data] → [PostgreSQL: INSERT INTO executions]
```

### Environment Variables for Ingestion

```bash
# Set in docker-compose or Portainer
PULSE_INGEST_USER=pulse_ingest
PULSE_INGEST_PASSWORD=<strong-random-password>
```

The backend creates this user automatically if credentials are provided.

---

## Building & Running

### Local Development

```bash
cd backend
npm install

# Set required environment variables
export DATABASE_URL="postgres://n8n_pulse:password@localhost:5432/n8n_pulse"
export JWT_SECRET="your-32-character-minimum-secret-key"

# Run with hot reload
npm run dev
```

### Docker Build

```bash
# Build image
docker build -t n8n_pulse_backend:local ./backend

# Build without cache (clean build)
docker build --no-cache -t n8n_pulse_backend:local ./backend

# Build with specific tag
docker build -t mohammedaljer/n8n_pulse_backend:v1.3.1 ./backend
```

### Docker Compose

```bash
# Development (with build)
docker compose up -d --build

# Production (with build)
docker compose -f docker-compose.prod.yml up -d --build

# Production (pre-built images)
docker compose -f docker-compose.prod.images.yml up -d

# Rebuild without cache
docker compose build --no-cache backend
docker compose up -d
```

### Health Check

```bash
curl http://localhost:8001/health
# {"ok":true,"db":"connected"}
```

---

## Environment Variables

See [Configuration Reference](./configuration.md) for complete list.

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Min 32 characters for signing |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8001` | HTTP port |
| `APP_ENV` | `development` | `production` enables fail-fast checks |
| `TRUST_PROXY` | `1` | Proxy hops for client IP |
| `LOG_FORMAT` | `combined` | Morgan log format |
