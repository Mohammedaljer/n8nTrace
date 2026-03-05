# Production Deployment

Deploy n8n-trace securely in production.

<!-- TOC -->

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables-reference)
- [Portainer Deployment](#portainer-deployment)
- [Reverse Proxy Integration](#reverse-proxy-integration)
- [Docker Image Tags](#docker-image-tags)
- [Production Checklist](#production-checklist)
- [Health Checks](#health-checks)
- [Database Migrations](#database-migrations)
- [Backup & Restore](#backup--restore)

<!-- /TOC -->

## Architecture

```
┌─────────────┐     ┌──────────────────┐
│   Browser   │────▶│   Express + SPA  │
│             │     │   (:8899 host)   │
└─────────────┘     └──────┬───────────┘
                           │ SELECT
                    ┌──────▼───────┐
                    │  PostgreSQL  │
                    │    17.2      │
                    └──────▲───────┘
                           │ INSERT/UPDATE
                    ┌──────┴───────┐
                    │     n8n      │
                    │  (ingestion) │
                    └──────────────┘
```

- **Application**: Single container — Express.js serves the React SPA and REST API (Google Distroless image, Node.js 22).
- **Database**: PostgreSQL 17.2 with auto-migrations on startup.
- **Ingestion**: n8n workflows write directly to PostgreSQL via the `trace_ingest` DB user. n8n-trace does not poll n8n.

See [Architecture](./architecture.md) for the full request flow, trust model, and security layers.

---

## Quick Start

### Option 1: Build from Source

```bash
cp .env.example .env
nano .env  # Edit with your values
docker compose -f docker-compose.prod.yml up -d --build
```

### Option 2: Pre-built Image

```bash
# Pull the pre-built image and start
docker compose -f docker-compose.prod.yml up -d
```

---

## Environment Variables Reference

### Required Secrets

| Variable | Description | Generate |
|----------|-------------|----------|
| `POSTGRES_PASSWORD` | Database password | `openssl rand -base64 24` |
| `JWT_SECRET` | JWT key (min 32 chars) | `openssl rand -base64 32` |

### Application Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_ENV` | `production` | **Must be `production`** for security |
| `APP_URL` | — | Public URL |
| `CORS_ORIGIN` | — | Must match `APP_URL` exactly |
| `HTTP_PORT` | `8899` | Frontend port |

### Cookie & Session

| Variable | Default | Description |
|----------|---------|-------------|
| `COOKIE_SECURE` | `true` | **Must be `true`** with HTTPS |
| `COOKIE_SAMESITE` | `lax` | SameSite policy |
| `JWT_EXPIRY` | `30m` | Token lifetime |

### Brute Force & Password Protection

| Variable | Default | Description |
|----------|---------|-------------|
| `PASSWORD_MIN_LENGTH` | `12` | Minimum password length |
| `ACCOUNT_LOCKOUT_THRESHOLD` | `10` | Failed attempts before lockout |
| `ACCOUNT_LOCKOUT_DURATION_MINUTES` | `15` | Lockout duration in minutes |

### Content Security Policy

| Variable | Default | Description |
|----------|---------|-------------|
| `CSP_REPORT_ONLY` | `false` | Log violations without blocking |
| `CSP_REPORT_URI` | — | URL for CSP violation reports |

### Privacy

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIT_LOG_IP_MODE` | `raw` | `raw`, `hashed`, `none` |
| `AUDIT_LOG_IP_SALT` | — | Required if `hashed` |

### Features

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_ENABLED` | `false` | Enable metrics |
| `RETENTION_ENABLED` | `false` | Enable cleanup |
| `RETENTION_DAYS` | `90` | Days to keep |

---

## Portainer Deployment

1. **Add Stack** → Upload `docker-compose.prod.yml`
2. **Environment Variables**:

```
POSTGRES_PASSWORD=<generated>
JWT_SECRET=<generated-32-chars>
APP_ENV=production
APP_URL=https://trace.example.com
CORS_ORIGIN=https://trace.example.com
COOKIE_SECURE=true
```

3. **Deploy**

---

## Reverse Proxy Integration

n8n-trace listens on port 8001 inside the container (published as 8899 by default). You can expose it directly or place your own reverse proxy in front for TLS termination.

### Direct Access (Default)

```
Client ──▶ n8n-trace (:8899)
```

No proxy needed. `TRUST_PROXY=false` (default).

### Behind a Reverse Proxy (TLS Termination)

```
Client ──▶ Traefik / Caddy / NGINX / ALB ──▶ n8n-trace (:8899)
```

Set `TRUST_PROXY=1` so Express reads the real client IP from the proxy's `X-Forwarded-For` header.

#### NGINX Example

```nginx
server {
    listen 443 ssl http2;
    server_name trace.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://localhost:8899;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Traefik Labels

```yaml
labels:
    - "traefik.enable=true"
    - "traefik.http.routers.trace.rule=Host(`trace.example.com`)"
    - "traefik.http.routers.trace.tls.certresolver=letsencrypt"
```

#### Caddy

```
trace.example.com {
    reverse_proxy localhost:8899
}
```

### Behind a CDN + Proxy

```
Client ──▶ Cloudflare ──▶ ALB ──▶ n8n-trace (:8899)
```

Set `TRUST_PROXY=2` (two trusted hops).

See [Architecture → Proxy Trust Model](./architecture.md#proxy-trust-model) for the full trust model.

---

## Docker Image Tags

| Tag | Use Case |
|-----|----------|
| `v2.0.0` | **Production** — current stable release (single container) |
| `latest` | Development only |

> **Upgrading from v1.x**: v2.0.0 merges frontend and backend into a single image. See the [root README](../README.md#docker-hub) for the DockerHub transition.

---

## Production Checklist

### Secrets

- [ ] `POSTGRES_PASSWORD` - Strong random
- [ ] `JWT_SECRET` - Min 32 chars
- [ ] `AUDIT_LOG_IP_SALT` - If using hashed mode

### Security

- [ ] `APP_ENV=production`
- [ ] `COOKIE_SECURE=true` (no trailing spaces!)
- [ ] `CORS_ORIGIN` exact URL (not `*`)
- [ ] `CSP_REPORT_ONLY=false` (enforcing mode)
- [ ] TLS/HTTPS enabled

### Infrastructure

- [ ] First admin via `/setup`
- [ ] No `.env` in Git
- [ ] Backups configured

---

## Health Checks

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Database connectivity |
| `GET /ready` | Application ready |

Health and readiness endpoints are not rate-limited so orchestrators can poll freely.

```bash
curl http://localhost:8899/health
# {"ok":true,"db":"connected"}
```

---

## Database Migrations

Migrations run automatically on backend startup via `node-pg-migrate`.

| Migration | Purpose |
|-----------|--------|
| `init-schema` | Core tables (users, RBAC, executions, workflows) |
| `add-password-tokens` | `user_password_tokens` table |
| `add-token-version` | Session invalidation via `token_version` |
| `retention-and-audit` | Audit log, retention tracking |
| `multi-tenant-executions` | Composite PK `(instance_id, execution_id)` |
| `add-metrics-snapshot` | `n8n_metrics_snapshot` table |
| `retention-indexes` | Indexes for retention batch DELETEs |
| `add-metrics-explorer` | `metrics_series` + `metrics_samples` tables |
| `add-executions-instance-started-index` | Composite index `(instance_id, started_at DESC)` |
| `add-account-lockout` | Account lockout columns (`failed_login_attempts`, `locked_until`) |
| `performance-indexes` | Indexes on `execution_nodes(workflow_id)` and `audit_log(action, created_at)` |

### The Composite Index Migration

The final migration creates a composite index on `executions (instance_id, started_at DESC)` to optimize the primary dashboard query:

```sql
SELECT ... FROM executions
WHERE instance_id = ?
ORDER BY started_at DESC
LIMIT ?
```

**Key behavior:**

- Uses `CREATE INDEX` (standard, not concurrent) — runs within a transaction.
- Executes on startup before the app accepts traffic, so table locking is acceptable.
- Uses `ifNotExists: true` — safe to re-run.

**Duration**: depends on table size. For most deployments (< 1M rows), completes in under a second.

---

## Backup & Restore

### Backup

```bash
docker exec n8n_trace_postgres pg_dump -U n8n_trace n8n_trace > backup.sql
```

### Restore

```bash
docker exec -i n8n_trace_postgres psql -U n8n_trace n8n_trace < backup.sql
```

### Automated

```bash
0 2 * * * docker exec n8n_trace_postgres pg_dump -U n8n_trace n8n_trace | gzip > /backups/n8n_trace_$(date +\%Y\%m\%d).sql.gz
```
