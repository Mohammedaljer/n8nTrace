# Security Guide

<!-- TOC -->

- [Secrets Management](#secrets-management)
- [Startup Enforcement](#startup-enforcement-fail-fast)
- [Audit Logging](#audit-logging)
- [TRUST_PROXY Setting](#trust_proxy-setting)
- [Cookie Security](#cookie-security)
- [CORS Configuration](#cors-configuration)
- [Database Security](#database-security)
- [Rate Limiting](#rate-limiting)
- [Production Checklist](#production-security-checklist)

<!-- /TOC -->

## Secrets Management

### Never Commit

- `.env` files with real values
- `JWT_SECRET`, `POSTGRES_PASSWORD`, `AUDIT_LOG_IP_SALT`
- Certificates (`*.pem`, `*.key`)

### Runtime Injection

**Docker Compose**: Use `${VAR}` syntax
**Portainer**: Add in stack UI
**Kubernetes**: ConfigMaps/Secrets

---

## Startup Enforcement (Fail-fast)

Backend **refuses to start** in production if:

| Check | Requirement |
|-------|-------------|
| `JWT_SECRET` length | ≥ 32 characters |
| `JWT_SECRET` value | No placeholders (`changeme`, etc.) |
| `COOKIE_SECURE` | Not `false` |
| `CORS_ORIGIN` | Not `*` |
| `AUDIT_LOG_IP_SALT` | Required if `hashed` mode |

---

## Audit Logging

Events logged to `audit_log` table (admin-only):

| Event | Logged Data |
|-------|-------------|
| Login success/failure | User, IP, timestamp |
| Password change | User, actor |
| User created/modified | Target, actor, changes |
| Retention job | Results, timestamp |

### IP Modes

| Mode | Behavior | GDPR |
|------|----------|------|
| `raw` | Store actual IP | ❌ |
| `hashed` | SHA-256 hash | ✅ |
| `none` | Don't store | ✅ |

**Hashed mode**: `AUDIT_LOG_IP_MODE=hashed` + `AUDIT_LOG_IP_SALT=<32-chars>`

---

## TRUST_PROXY Setting

| Value | Use Case |
|-------|----------|
| `1` | Single proxy (nginx) |
| `2` | Two proxies (CDN + nginx) |
| `false` | Direct connection |

Affects: Audit logs, rate limiting.

---

## Cookie Security

| Attribute | Production Value |
|-----------|------------------|
| `HttpOnly` | `true` |
| `Secure` | `true` |
| `SameSite` | `Lax` |
| `Path` | `/` |

---

## CORS Configuration

```bash
# Correct
CORS_ORIGIN=https://pulse.example.com

# Wrong
CORS_ORIGIN=https://pulse.example.com/  # trailing slash
CORS_ORIGIN=*                            # rejected in production
```

---

## Database Security

### Ingest User (Least Privilege)

`pulse_ingest` can only:
- SELECT, INSERT, UPDATE on: `executions`, `execution_nodes`, `workflows_index`, `n8n_metrics_snapshot`, `metrics_series`, `metrics_samples`

Cannot:
- DELETE any data
- Access `app_users`, `audit_log`, RBAC tables

### Network Isolation

PostgreSQL not exposed to host in production compose.

---

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /api/auth/login` | 5 | 15 min |
| `POST /api/auth/forgot-password` | 5 | 15 min |
| `POST /api/auth/set-password` | 5 | 15 min |
| `POST /api/auth/reset-password` | 5 | 15 min |
| `POST /api/setup/*` | 5 | 15 min |
| `ALL /api/admin/*` | 100 | 1 min |
| `GET /api/metrics/*` | 60 | 1 min |

**Response when exceeded**: 429 with `retryAfter` seconds.

---

## Production Security Checklist

### Required (Enforced)

- [ ] `JWT_SECRET` ≥ 32 chars, random
- [ ] `JWT_SECRET` no placeholders
- [ ] `COOKIE_SECURE=true`
- [ ] `CORS_ORIGIN` exact URL

### Required (Manual)

- [ ] TLS/HTTPS termination
- [ ] No secrets in Git
- [ ] `.env` gitignored

### Recommended

- [ ] `AUDIT_LOG_IP_MODE=hashed`
- [ ] `AUDIT_LOG_IP_SALT` set
- [ ] `TRUST_PROXY` correct
- [ ] Database not exposed
- [ ] Backups configured

---

## Security Assessment

n8n Pulse includes:

- JWT auth with HttpOnly cookies
- bcrypt password hashing (10 rounds)
- Parameterized SQL (injection prevention)
- CSRF protection
- Brute-force protection (rate limiting)
- Security headers (Helmet)
- Audit logging
- Fail-fast startup checks
- Least-privilege database user

**Production-ready** when configured with HTTPS, correct `TRUST_PROXY`, and strong secrets.
