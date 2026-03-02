# Roles & Permissions (RBAC)

n8n Pulse uses role-based access control to manage what users can see and do.

<!-- TOC -->

- [Roles Overview](#roles-overview)
- [Permissions by Role](#permissions-by-role)
- [Permission Keys](#permission-keys)
- [Instance Scoping](#instance-scoping)
- [Metrics Access](#metrics-access)
- [API Access by Role](#api-access-by-role)
- [Managing Users](#managing-users-admin)
- [Managing Groups](#managing-groups-admin)
- [First Admin](#first-admin)

<!-- /TOC -->

## Roles Overview

| Role | Description | Use Case |
|------|-------------|----------|
| **Admin** | Full access | System administrators |
| **Analyst** | Read + export + full metrics | Data analysts, team leads |
| **Viewer** | Read-only, basic metrics | General users |

## Permissions by Role

| Capability | Admin | Analyst | Viewer |
|------------|:-----:|:-------:|:------:|
| View dashboards | ✓ | ✓ | ✓ |
| View executions | ✓ | ✓ | ✓ |
| View workflows | ✓ | ✓ | ✓ |
| Export data | ✓ | ✓ | ✗ |
| **Full metrics widgets** | ✓ | ✓ | ✗ |
| Version info only | ✓ | ✓ | ✓ |
| Manage users | ✓ | ✗ | ✗ |
| Manage groups | ✓ | ✗ | ✗ |
| View audit logs | ✓ | ✗ | ✗ |
| Run retention | ✓ | ✗ | ✗ |
| Manage metrics | ✓ | ✗ | ✗ |

## Permission Keys

| Permission | Description |
|------------|-------------|
| `admin:users` | Manage users (invite, update, delete) |
| `admin:roles` | Manage roles and permissions |
| `admin:groups` | Manage groups |
| `read:workflows` | Read workflows |
| `read:executions` | Read executions |
| `read:nodes` | Read execution nodes |
| `export:data` | Export data |
| `metrics.read.version` | Read n8n version info only |
| `metrics.read.full` | Read all instance metrics (CPU, RAM, etc.) |
| `metrics.manage` | Manage metrics configuration |

## Instance Scoping

Non-admin users can be scoped to specific resources:

- **Instance scope**: See all data in that n8n instance + instance metrics
- **Workflow scope**: See specific workflow only (no instance metrics)
- **Tag scope**: See workflows with that tag (no instance metrics)
- **No scope**: Admin sees all; others see nothing

### Important: Metrics Require Instance Scope

Users with only tag or workflow scopes **cannot** access instance-level metrics (CPU, RAM). They need explicit instance scope.

## Metrics Access

| Endpoint | Admin | Analyst | Viewer | Unauthenticated |
|----------|:-----:|:-------:|:------:|:---------------:|
| `GET /api/metrics/config` | 200 | 200 | 200 | 401 |
| `GET /api/metrics/instances` | 200 | 200 | 200 (empty) | 401 |
| `GET /api/metrics/latest` | 200 | 200 | 403 | 401 |
| `GET /api/metrics/timeseries` | 200 | 200 | 403 | 401 |
| `GET /api/metrics/catalog` | 200 | 200 | 403 | 401 |
| `POST /api/metrics/query` | 200 | 200 | 403 | 401 |
| `GET /api/metrics/explorer/*` | 200 | 200 | 403 | 401 |
| `POST /api/metrics/explorer/query` | 200 | 200 | 403 | 401 |

## API Access by Role

### Admin Endpoints (`/api/admin/*`)

| Endpoint | Admin | Analyst | Viewer | Unauth |
|----------|:-----:|:-------:|:------:|:------:|
| `GET /api/admin/users` | 200 | 403 | 403 | 401 |
| `POST /api/admin/users` | 201 | 403 | 403 | 401 |
| `PATCH /api/admin/users/:userId` | 200 | 403 | 403 | 401 |
| `DELETE /api/admin/users/:userId` | 200 | 403 | 403 | 401 |
| `GET /api/admin/groups` | 200 | 403 | 403 | 401 |
| `GET /api/admin/roles` | 200 | 403 | 403 | 401 |
| `GET /api/admin/audit-logs` | 200 | 403 | 403 | 401 |
| `GET /api/admin/retention/status` | 200 | 403 | 403 | 401 |
| `POST /api/admin/users/:userId/revoke-sessions` | 200 | 403 | 403 | 401 |
| `POST /api/admin/users/:userId/unlock` | 200 | 403 | 403 | 401 |

### Data Endpoints

| Endpoint | Admin | Analyst | Viewer | Unauth |
|----------|:-----:|:-------:|:------:|:------:|
| `GET /api/workflows` | 200 | 200 | 200 | 401 |
| `GET /api/executions` | 200 | 200 | 200 | 401 |
| `GET /api/execution-nodes` | 200 | 200 | 200 | 401 |

### Auth Endpoints

| Endpoint | Any User | Unauth |
|----------|:--------:|:------:|
| `POST /api/auth/login` | 200 | 200/401 |
| `POST /api/auth/logout` | 200 | 200 |
| `GET /api/auth/me` | 200 | 401 |
| `POST /api/auth/set-password` | 200 | 200/400 |
| `POST /api/auth/reset-password` | 200 | 200/400 |

## Managing Users (Admin)

1. Navigate to **Admin → Users**
2. Click **Invite User**
3. Enter email, select groups
4. Share invite link

**Invite Flow:**
1. User receives link with token
2. Opens `/set-password?token=...`
3. Sets password
4. Can now login

## Managing Groups (Admin)

1. Navigate to **Admin → Groups**
2. Create group with:
   - **Name**: Descriptive name
   - **Role**: Viewer, Analyst, or Admin
   - **Scopes**: Instance IDs, workflow IDs, or tags

## First Admin

Create via:

1. **Setup page** (`/setup`) - Recommended
2. **Environment**: Set both `ADMIN_EMAIL` and `ADMIN_PASSWORD`

After first admin exists, invite additional users via Admin panel.
