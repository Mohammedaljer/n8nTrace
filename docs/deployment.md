# Production Deployment

Deploy n8n Pulse securely in production.

<!-- TOC -->

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables-reference)
- [Portainer Deployment](#portainer-deployment)
- [Reverse Proxy Setup](#reverse-proxy-setup)
- [Docker Image Tags](#docker-image-tags)
- [Production Checklist](#production-checklist)
- [Health Checks](#health-checks)
- [Backup & Restore](#backup--restore)

<!-- /TOC -->

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│   nginx     │────▶│   Backend   │
│             │     │  (frontend) │     │  (Express)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           │                   ▼
                           │            ┌─────────────┐
                           │            │  PostgreSQL │
                           │            └─────────────┘
                           │                   ▲
                           │                   │
                    ┌─────────────┐            │
                    │     n8n     │────────────┘
                    │  (ingestion)│
                    └─────────────┘
```

---

## Quick Start

### Option 1: Build from Source

```bash
cp .env.example .env
nano .env  # Edit with your values
docker compose -f docker-compose.prod.yml up -d --build
```

### Option 2: Pre-built Images

```bash
docker compose -f docker-compose.prod.images.yml up -d
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

1. **Add Stack** → Upload `docker-compose.prod.images.yml`
2. **Environment Variables**:

```
POSTGRES_PASSWORD=<generated>
JWT_SECRET=<generated-32-chars>
APP_ENV=production
APP_URL=https://pulse.example.com
CORS_ORIGIN=https://pulse.example.com
COOKIE_SECURE=true
```

3. **Deploy**

---

## Reverse Proxy Setup

### nginx Example

```nginx
server {
    listen 443 ssl http2;
    server_name pulse.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://localhost:8899;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Traefik Labels

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.pulse.rule=Host(`pulse.example.com`)"
  - "traefik.http.routers.pulse.tls.certresolver=letsencrypt"
```

---

## Docker Image Tags

| Tag | Use Case |
|-----|----------|
| `v1.3.3` | **Production** - Stable, includes fixes |
| `latest` | Development only |

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

```bash
curl https://pulse.example.com/health
# {"ok":true,"db":"connected"}
```

---

## Backup & Restore

### Backup

```bash
docker exec n8n_pulse_postgres pg_dump -U n8n_pulse n8n_pulse > backup.sql
```

### Restore

```bash
docker exec -i n8n_pulse_postgres psql -U n8n_pulse n8n_pulse < backup.sql
```

### Automated

```bash
0 2 * * * docker exec n8n_pulse_postgres pg_dump -U n8n_pulse n8n_pulse | gzip > /backups/pulse_$(date +\%Y\%m\%d).sql.gz
```
