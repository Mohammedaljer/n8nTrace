# n8n Pulse — Backend

Express.js 5 REST API that powers n8n Pulse. Handles authentication, authorization, data queries, metrics, audit logging, and database lifecycle.

> [!NOTE]
> The backend is not intended to run standalone. It is built and shipped as part of the [unified Docker image](../docs/deployment.md) alongside the React SPA.

## Responsibilities

- **Authentication** — JWT sessions in HttpOnly/Secure/SameSite cookies, bcrypt password hashing, account lockout
- **RBAC** — Role-based access control (Admin / Analyst / Viewer) with instance, workflow, and tag scoping
- **Analytics APIs** — Execution, workflow, and node-level data endpoints with scope-aware filtering
- **Metrics** — Instance health queries, Prometheus-style metrics explorer, timeseries aggregation
- **Audit logging** — Security event recording with configurable IP privacy (raw / hashed / none)
- **Data retention** — Scheduled cleanup of old execution data
- **Migrations** — Auto-applied on startup via `node-pg-migrate`
- **Health endpoints** — `/health` and `/ready` for container orchestration

## Documentation

Full reference: [`/docs/backend.md`](../docs/backend.md)

- [Database Schema](../docs/backend.md#database-schema)
- [Migrations](../docs/backend.md#migrations)
- [API Endpoints](../docs/backend.md#api-endpoints)
- [n8n Data Ingestion](../docs/backend.md#n8n-data-ingestion)
- [Configuration](../docs/configuration.md)
- [Security](../docs/security.md)

## Quick Commands

```bash
# Install dependencies
npm install

# Development (hot reload)
npm run dev

# Production
npm start

# Run migrations
npm run migrate up

# Rollback migration
npm run migrate down

# Run tests
npm test
```

> [!IMPORTANT]
> Always back up the database before running migrations in production. Rollbacks (`migrate down`) are destructive and may cause data loss.

## Docker Build

The backend is built as part of the unified image from the repo root:

```bash
docker build -t n8n_pulse:local .
```

## Health Check

```bash
curl http://localhost:8001/health
# {"ok":true,"db":"connected"}
```
