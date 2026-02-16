# Roles & Permissions (RBAC)

n8n Pulse uses role-based access control to manage what users can see and do.

## Roles Overview

| Role | Description | Use Case |
|------|-------------|----------|
| **Admin** | Full access | System administrators |
| **Analyst** | Read + export | Data analysts, team leads |
| **Viewer** | Read-only | General users, stakeholders |

## Permissions by Role

| Capability | Admin | Analyst | Viewer |
|------------|:-----:|:-------:|:------:|
| View dashboards | ✓ | ✓ | ✓ |
| View executions | ✓ | ✓ | ✓ |
| View workflows | ✓ | ✓ | ✓ |
| Export data | ✓ | ✓ | ✗ |
| View full metrics | ✓ | ✓ | ✗ |
| Manage users | ✓ | ✗ | ✗ |
| Manage groups | ✓ | ✗ | ✗ |
| View audit logs | ✓ | ✗ | ✗ |
| Run retention | ✓ | ✗ | ✗ |

## Instance Scoping

Non-admin users can be scoped to specific n8n instances:

- **Scoped users** only see data from their assigned instances
- **Admins** see all data regardless of scope

### How Scoping Works

1. Create a **Group** with instance scopes
2. Assign a **Role** to the group
3. Add **Users** to the group

Users inherit the role's permissions filtered by the group's scopes.

## Metrics Permissions

| Permission | Description | Admin | Analyst | Viewer |
|------------|-------------|:-----:|:-------:|:------:|
| `metrics.read.version` | n8n version info only | ✓ | ✓ | ✓ |
| `metrics.read.full` | All metrics (CPU, RAM, etc.) | ✓ | ✓ | ✗ |
| `metrics.manage` | Manage metrics settings | ✓ | ✗ | ✗ |

## Managing Users (Admin)

1. Navigate to **Admin → Users**
2. Click **Invite User**
3. Enter email, select groups
4. Share the invite link (or copy from admin panel)

## Managing Groups (Admin)

1. Navigate to **Admin → Groups**
2. Create a group with:
   - **Name**: Descriptive name
   - **Role**: Viewer, Analyst, or Admin
   - **Scopes**: Instance IDs, workflow IDs, or tags

## First Admin

The first admin is created via:

1. **Setup page** (`/setup`) - Recommended for production
2. **Environment variables** - Set both `ADMIN_EMAIL` and `ADMIN_PASSWORD`

After the first admin exists, additional users are invited through the admin panel.
