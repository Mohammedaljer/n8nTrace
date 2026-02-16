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
| [Deployment](./deployment.md) | Production deployment, Docker, Portainer |
| [Configuration](./configuration.md) | Environment variables reference |
| [Backend Architecture](./backend.md) | API endpoints, database schema, migrations |
| [Frontend Architecture](./frontend.md) | React components, routing, styling |
| [Security](./security.md) | Secrets, proxy settings, audit logging |
| [RBAC](./rbac.md) | Roles and permissions |
| [Troubleshooting](./troubleshooting.md) | Common issues and solutions |


## Architecture Overview

<p align="center">
  <img src="./images/architecture-diagram.svg" alt="n8n Pulse Architecture" width="700">
</p>

### Components

- **Frontend**: React + Vite app served by nginx
- **Backend**: Express.js REST API with JWT authentication
- **Database**: PostgreSQL 16 with auto-migrations
- **Ingestion**: n8n writes execution data via restricted `pulse_ingest` user

## Key Concepts

### Data Flow

1. **n8n** executes workflows and writes data to PostgreSQL tables
2. **Backend** reads data and serves via REST API
3. **Frontend** displays dashboards and analytics

### Security Model

- JWT tokens stored in HttpOnly cookies
- RBAC with Admin/Analyst/Viewer roles
- Instance scoping for multi-tenant deployments
- Audit logging for security events
- Fail-fast checks prevent insecure production deployments

### Database Tables

| Table | Source | Purpose |
|-------|--------|---------|
| `executions` | n8n | Workflow execution records |
| `execution_nodes` | n8n | Node-level execution details |
| `workflows_index` | n8n | Workflow metadata |
| `n8n_metrics_snapshot` | n8n | Instance health metrics |
| `app_users` | Pulse | User accounts |
| `audit_log` | Pulse | Security events |

See [Backend Architecture](./backend.md) for full schema.
