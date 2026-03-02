# Architecture

How n8n Pulse is built, how requests flow, and how to configure proxy trust for different deployment topologies.

<!-- TOC -->

- [Component Overview](#component-overview)
- [Single-Container Architecture](#single-container-architecture)
- [Request Flow](#request-flow)
- [Data Ingestion Model](#data-ingestion-model)
- [Proxy Trust Model](#proxy-trust-model)
  - [Direct Access (Default)](#direct-access-default)
  - [Behind a Reverse Proxy](#behind-a-reverse-proxy)
  - [Behind a CDN + Proxy](#behind-a-cdn--proxy)
  - [Do Not Guess TRUST_PROXY](#do-not-guess-trust_proxy)
- [Security Layers](#security-layers)
- [Health and Readiness](#health-and-readiness)
- [Database Architecture](#database-architecture)

<!-- /TOC -->

---

## Component Overview

| Component | Technology | Image |
|-----------|-----------|-------|
| **Application** | Express.js 5 (API) + React 18 (SPA) | `gcr.io/distroless/nodejs22-debian12:nonroot` |
| **Database** | PostgreSQL 17 | `postgres:17.2-alpine` |

n8n Pulse runs as **two containers**: the application and PostgreSQL. The Express backend serves both the REST API and the React frontend as static files. No NGINX or separate proxy is needed.

---

## Single-Container Architecture

The unified Docker image is built in three stages:

1. **Frontend build** — `node:22-alpine` compiles the React SPA via Vite.
2. **Backend deps** — `node:22-alpine` installs production Node.js dependencies.
3. **Production** — Google Distroless (no shell, minimal attack surface) copies the backend code, dependencies, and the frontend `dist/` into `/app/public`.

At runtime, Express:
- Serves the React SPA from `/app/public` (static files)
- Handles all `/api/*` routes (REST API)
- Handles `/health` and `/ready` (health checks)
- Falls back to `index.html` for any unmatched `GET` request (SPA routing)

```
Single container (:8001 inside, :8899 published)
├── GET /assets/*.js     → Static file (immutable, cached 1 year)
├── GET /api/*           → Express API routes
├── GET /health          → Health check
├── GET /ready           → Readiness check
└── GET /anything-else   → index.html (React Router handles it)
```

---

## Request Flow

### Direct access (default Docker Compose)

```
Browser ──▶ Express (:8001 inside container, :8899 on host)
              ├── /api/*      → API routes (auth, data, metrics, admin)
              ├── /health     → DB connectivity check
              ├── /ready      → Readiness check
              ├── /assets/*   → Static JS/CSS (Vite hashed, cached 1y)
              └── /*          → index.html (SPA fallback)
```

### Behind a reverse proxy (Traefik, Caddy, NGINX, LB)

```
Browser ──▶ Your Proxy (TLS termination) ──▶ Express (:8899)
```

Set `TRUST_PROXY=1` so Express reads the real client IP from your proxy's `X-Forwarded-For` header.

---

## Data Ingestion Model

n8n Pulse uses **push-based ingestion**. It does not poll n8n instances.

1. An **n8n workflow** runs on a schedule inside your n8n instance.
2. That workflow collects execution data from the n8n internal API.
3. It writes directly to PostgreSQL using a **restricted database user** (`pulse_ingest`).

```
┌─────────────┐                    ┌─────────────┐
│     n8n     │ ── INSERT/UPSERT ─▶│  PostgreSQL  │
│  (workflow) │    via pulse_ingest │             │
└─────────────┘                    └──────┬──────┘
                                          │ SELECT
                                   ┌──────┴──────┐
                                   │   Express   │
                                   │  (backend)  │
                                   └─────────────┘
```

The `pulse_ingest` user has least-privilege access:
- **Allowed**: `SELECT`, `INSERT`, `UPDATE` on `executions`, `execution_nodes`, `workflows_index`, `n8n_metrics_snapshot`, `metrics_series`, `metrics_samples`
- **Denied**: `DELETE` on any table; any access to `app_users`, `audit_log`, RBAC tables

The backend never writes to ingestion tables. It only reads them.

---

## Proxy Trust Model

Express uses the `trust proxy` setting to determine the real client IP from the `X-Forwarded-For` header. This affects:
- **Audit logs** — which IP is recorded
- **Rate limiting** — which IP is counted
- **Security** — correct IP identification

### Direct Access (Default)

```
Browser ──▶ Express (port 8899)
```

`TRUST_PROXY=false` (default). Express uses the raw TCP connection IP. No headers are trusted.

### Behind a Reverse Proxy

```
Browser ──▶ Traefik / Caddy / NGINX / ALB ──▶ Express
```

`TRUST_PROXY=1`. Express trusts the **rightmost** IP in `X-Forwarded-For` (set by your proxy). Client-injected left-side entries are ignored.

```yaml
environment:
  TRUST_PROXY: "1"
```

### Behind a CDN + Proxy

```
Browser ──▶ Cloudflare ──▶ ALB ──▶ Express
```

`TRUST_PROXY=2`. Express skips two rightmost entries to find the client IP.

```yaml
environment:
  TRUST_PROXY: "2"
```

### Do Not Guess TRUST_PROXY

If `TRUST_PROXY` is too high, Express trusts client-supplied IPs (spoofable).
If `TRUST_PROXY` is too low, Express records a proxy IP instead of the client.

**Rule**: set it to the exact number of trusted proxies between the client and Express. If unsure, leave it as `false` (safe default).

| Deployment | Value |
|-----------|-------|
| Docker Compose, direct access | `false` (default) |
| Behind one proxy (Traefik, Caddy, NGINX, ALB) | `1` |
| Behind two proxies (CDN + LB) | `2` |
| Behind three proxies (CDN + LB + sidecar) | `3` |

This is the same model used by n8n, Gitea, Uptime Kuma, and most self-hosted Node.js apps.

---

## Security Layers

All security is handled by Express middleware. No external proxy required.

| Layer | Middleware | Purpose |
|-------|-----------|---------|
| Helmet | `helmet()` | Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) |
| Compression | `compression()` | Gzip responses |
| Body limit | `express.json({ limit: '1mb' })` | Reject oversized payloads |
| CORS | `cors({ credentials: true })` | Origin validation |
| CSRF | Origin/Referer check | Protects all mutating `/api/` endpoints |
| Rate limiting | `express-rate-limit` | Per-IP limits on auth, admin, metrics, setup |
| JWT auth | HttpOnly cookies | Session management |
| RBAC | Permission middleware | Endpoint-level access control |
| Audit | `logAudit()` | Security event logging |

---

## Health and Readiness

| Endpoint | Path | Auth | Rate Limit |
|----------|------|------|------------|
| Health | `GET /health` | No | None |
| Readiness | `GET /ready` | No | None |

```bash
curl http://localhost:8899/health
# {"ok":true,"db":"connected"}

curl http://localhost:8899/ready
# {"ok":true}
```

Use these endpoints for Docker health checks, Kubernetes probes, or uptime monitoring.

---

## Database Architecture

PostgreSQL 17 with auto-migrations on startup via `node-pg-migrate`.

### Two database users

| User | Purpose | Privileges |
|------|---------|------------|
| `n8n_pulse` | Application user | Full owner of all tables |
| `pulse_ingest` | n8n workflow ingestion | SELECT/INSERT/UPDATE on 6 ingestion tables only |

### Key indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| Primary key | `executions` | `(instance_id, execution_id)` | Multi-tenant primary key |
| Primary key | `execution_nodes` | `(instance_id, execution_id, node_name, run_index)` | Node-level lookup |
| Composite | `executions` | `(instance_id, started_at DESC)` | Dashboard query optimization |
| Primary key | `metrics_samples` | `(series_id, ts)` | Time-series range scans |
| Unique | `metrics_series` | `(instance_id, metric_name, labels)` | Metric deduplication |

See [Backend Architecture](./backend.md) for the complete schema.
