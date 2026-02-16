# Backend Architecture

n8n Pulse backend is an Express.js REST API providing authentication, authorization, and data access for workflow execution analytics.

## Table of Contents

- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Migrations](#migrations)
- [API Endpoints](#api-endpoints)
- [Authentication Flow](#authentication-flow)
- [n8n Data Ingestion](#n8n-data-ingestion)
- [Building & Running](#building--running)

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
├── index.js              # Main application entry point
├── package.json          # Dependencies and scripts
├── Dockerfile            # Production Docker image
├── .dockerignore         # Docker build exclusions
├── migrations/           # Database migrations
│   ├── 1770649871121_init-schema.js
│   ├── 1770660000000_add-password-tokens.js
│   ├── 1770670000000_add-token-version.js
│   ├── 1770680000000_retention-and-audit.js
│   ├── 1770690000000_multi-tenant-executions.js
│   └── 1770700000000_add-metrics-snapshot.js
└── tests/                # Test files
```

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
tags                  TEXT          -- JSON array as text
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
snapshot_time         TIMESTAMPTZ NOT NULL
n8n_version           TEXT
cpu_usage_percent     REAL
memory_used_mb        REAL
memory_total_mb       REAL
event_loop_latency_ms REAL
active_workflows      INT4
queue_depth           INT4
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

-- Group instance/workflow scopes
group_scopes (id UUID, group_id UUID, instance_id TEXT, workflow_id TEXT, tag TEXT)

-- User instance/workflow scopes (legacy, prefer group_scopes)
user_scopes (id UUID, user_id UUID, instance_id TEXT, workflow_id TEXT)
```

### Security Tables

#### `audit_log` - Security event log
```sql
id                    UUID PRIMARY KEY
event_type            TEXT NOT NULL  -- 'login', 'logout', 'password_change', etc.
actor_id              UUID           -- User who performed action
target_id             UUID           -- User/resource affected
details               JSONB          -- Additional context
ip_address            TEXT           -- Client IP (if AUDIT_LOG_IP_MODE != 'none')
created_at            TIMESTAMPTZ DEFAULT now()
```

#### `password_reset_tokens` - Password reset flow
```sql
id                    UUID PRIMARY KEY
user_id               UUID REFERENCES app_users(id)
token_hash            TEXT NOT NULL
expires_at            TIMESTAMPTZ NOT NULL
used                  BOOLEAN DEFAULT false
created_at            TIMESTAMPTZ DEFAULT now()
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

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/logout` | Logout (clears cookie) |
| GET | `/api/auth/me` | Get current user info |
| POST | `/api/auth/refresh` | Refresh JWT token |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password with token |

### Setup (First Run)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/setup/status` | Check if setup is required |
| POST | `/api/setup` | Create first admin user |

### Executions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/executions` | List executions (filtered) |
| GET | `/api/executions/:id` | Get execution details |
| GET | `/api/executions/stats` | Execution statistics |

### Workflows

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workflows` | List workflows |
| GET | `/api/workflows/:id` | Get workflow details |

### Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/metrics/config` | Metrics feature config |
| GET | `/api/metrics/instances` | Instance list |
| GET | `/api/metrics/snapshots` | Metrics data |

### Admin (Admin role required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/users` | List users |
| POST | `/api/admin/users` | Create/invite user |
| PATCH | `/api/admin/users/:id` | Update user |
| DELETE | `/api/admin/users/:id` | Delete user |
| GET | `/api/admin/groups` | List groups |
| POST | `/api/admin/groups` | Create group |
| GET | `/api/admin/audit` | View audit logs |
| POST | `/api/admin/retention/run` | Trigger retention cleanup |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Database connectivity check |
| GET | `/ready` | Application readiness |

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
