<p align="center">
  <img src="./images/n8n-pulse-logo.svg" alt="n8n Pulse" width="100" height="100">
</p>

<h1 align="center">n8n Pulse Documentation</h1>

<p align="center">
  <em>Self-hosted analytics dashboard for n8n workflow executions</em>
</p>

---

## Quick Links

| Guide | Description |
|-------|-------------|
| [Getting Started](./getting-started.md) | Local development quickstart |
| [Architecture](./architecture.md) | Request flow, trust model, deployment topologies |
| [Deployment](./deployment.md) | Production deployment, Docker, Portainer |
| [Configuration](./configuration.md) | Environment variables reference |
| [Backend Architecture](./backend.md) | API endpoints, database schema |
| [Frontend Architecture](./frontend.md) | React components, routing |
| [Security](./security.md) | CSP, account lockout, passwords, audit logging, GDPR |
| [RBAC](./rbac.md) | Roles, groups, and permissions |
| [Troubleshooting](./troubleshooting.md) | Common issues and solutions |
| [Environment](./environment.md) | Docker environment variables |
| [Workflows](../Workflows/README.md) | n8n workflow setup and details |
| [Contributing](../CONTRIBUTING.md) | How to contribute |
| [Changelog](../CHANGELOG.md) | Version history |

## Architecture Overview

### Components

- **Application**: Single container — Express.js serves the React SPA and REST API
- **Database**: PostgreSQL 17 with auto-migrations
- **Ingestion**: n8n writes data via restricted `pulse_ingest` user

## Key Concepts

### Data Flow

1. **n8n** executes workflows and writes to PostgreSQL
2. **Backend** serves data via REST API
3. **Frontend** displays dashboards and analytics

### Security Model

- JWT tokens in HttpOnly cookies
- RBAC with Admin/Analyst/Viewer roles
- Content Security Policy (CSP) via Helmet
- Account lockout after failed login attempts
- 12-character minimum passwords with denylist
- Token versioning for session revocation
- Instance scoping for multi-tenant
- Audit logging for security events
- Fail-fast checks prevent insecure deployments

### Database Tables

| Table | Source | Purpose |
|-------|--------|--------|
| `executions` | n8n | Workflow execution records |
| `execution_nodes` | n8n | Node-level details |
| `workflows_index` | n8n | Workflow metadata |
| `n8n_metrics_snapshot` | n8n | Instance health metrics |
| `metrics_series` | n8n | Metrics Explorer series |
| `metrics_samples` | n8n | Metrics Explorer data |
| `app_users` | Pulse | User accounts |
| `audit_log` | Pulse | Security events |

### API Endpoints Summary

| Category | Base Path | Auth |
|----------|-----------|------|
| Health | `/health`, `/ready` | No |
| Setup | `/api/setup/*` | No |
| Auth | `/api/auth/*` | Mixed |
| Data | `/api/workflows`, `/api/executions`, `/api/execution-nodes` | Yes |
| Metrics | `/api/metrics/*` | Yes |
| Admin | `/api/admin/*` | Yes + `admin:*` permission |

See [Backend Architecture](./backend.md) for complete endpoint list.
