# Security Guide
<!-- TOC -->

- [Security Guide](#security-guide)
  - [Secrets Management](#secrets-management)
    - [Never Commit Secrets](#never-commit-secrets)
    - [Providing Secrets at Runtime](#providing-secrets-at-runtime)
  - [Startup Enforcement (Fail-fast)](#startup-enforcement-fail-fast)
    - [Recommended Hardening (Not Enforced)](#recommended-hardening-not-enforced)
  - [Audit Logging](#audit-logging)
    - [What Audit Logs Contain](#what-audit-logs-contain)
    - [Audit Log Display](#audit-log-display)
    - [Audit Log IP Modes](#audit-log-ip-modes)
    - [Hashed Mode (Recommended for Production)](#hashed-mode-recommended-for-production)
  - [TRUST\_PROXY Setting](#trust_proxy-setting)
  - [Cookie Security](#cookie-security)
  - [CORS Configuration](#cors-configuration)
  - [Database Security](#database-security)
    - [Ingest User (Least Privilege)](#ingest-user-least-privilege)
    - [Network Isolation](#network-isolation)
  - [Rate Limiting](#rate-limiting)
    - [Implemented Limits](#implemented-limits)
    - [Rate Limit Response](#rate-limit-response)
    - [Key Generation](#key-generation)
  - [Production Security Checklist](#production-security-checklist)
    - [Required (Enforced at Startup)](#required-enforced-at-startup)
    - [Required (Manual Verification)](#required-manual-verification)
    - [Recommended (Privacy \& Hardening)](#recommended-privacy--hardening)
  - [Security Assessment](#security-assessment)

<!-- /TOC -->
## Secrets Management

### Never Commit Secrets

The following must **never** be in Git:
- `.env` files with real values
- `JWT_SECRET`, `POSTGRES_PASSWORD`, `AUDIT_LOG_IP_SALT`
- Certificates (`*.pem`, `*.key`, `*.crt`)

### Providing Secrets at Runtime

**Option 1: Environment Variables**
- Docker Compose: Use `${VAR}` syntax in compose files
- Portainer: Add variables in the stack UI
- Kubernetes: Use ConfigMaps/Secrets

**Option 2: Docker Secrets (Swarm)**

```yaml
services:
  backend:
    secrets:
      - jwt_secret
    environment:
      JWT_SECRET_FILE: /run/secrets/jwt_secret

secrets:
  jwt_secret:
    external: true
```

See: [Docker Secrets Best Practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/)

---

## Startup Enforcement (Fail-fast)

The backend **refuses to start** in production (`APP_ENV=production`) if:

| Check | Enforcement |
|-------|-------------|
| `JWT_SECRET` length | Must be ≥ 32 characters |
| `JWT_SECRET` value | Must not contain `changeme`, `password123`, `secret` |
| `COOKIE_SECURE` | Must not be `false` |
| `CORS_ORIGIN` | Must not be `*` |
| `AUDIT_LOG_IP_SALT` | Required if `AUDIT_LOG_IP_MODE=hashed` |

These checks prevent accidental deployment with insecure defaults.

### Recommended Hardening (Not Enforced)

The following are strongly recommended but not enforced at startup:

- [ ] Deploy behind HTTPS with TLS termination
- [ ] Set `TRUST_PROXY` correctly for your proxy chain
- [ ] Use `AUDIT_LOG_IP_MODE=hashed` for privacy compliance
- [ ] Enable database backups
- [ ] Monitor audit logs for suspicious activity
- [ ] Use strong, randomly generated passwords for all credentials

---

## Audit Logging

Security events are logged to the `audit_log` table (admin-only access):

| Event | Logged Data |
|-------|-------------|
| Login success/failure | User email, client identifier, timestamp |
| Password change | User, actor |
| User created/modified | User, actor, changes |
| Group/role changes | Target, actor |
| Retention job runs | Results, timestamp |

### What Audit Logs Contain

Each audit log entry stores:

| Field | Description | Privacy Notes |
|-------|-------------|---------------|
| `actor_user_id` | UUID of user who performed action | Resolved to email in UI (admin only) |
| `target_type` | Type of target (`user`, etc.) | Non-sensitive |
| `target_id` | ID of affected resource | Resolved to email for user targets |
| `ip` | Client identifier | Controlled by `AUDIT_LOG_IP_MODE` |
| `user_agent` | Browser/client string | Truncated to 500 chars |
| `metadata` | Action-specific details | Never contains passwords/tokens |

**Privacy safeguards applied:**
- Passwords, tokens, and secrets are automatically stripped from metadata
- IP addresses can be hashed or omitted via `AUDIT_LOG_IP_MODE`
- User agent strings are truncated to prevent excessive data storage
- Only admins with `admin:users` permission can access audit logs

### Audit Log Display

In the admin UI:
- **Actor** column shows the user's email (resolved from UUID)
- **Target** column shows target email for user-related actions (e.g., "user created")
- **IP** column shows raw IP, hashed identifier, or "—" based on `AUDIT_LOG_IP_MODE`

### Audit Log IP Modes

The `AUDIT_LOG_IP_MODE` setting controls how client identifiers are stored:

| Mode | Behavior | Use Case |
|------|----------|----------|
| `raw` | Store actual client IP | Development, trusted environments |
| `hashed` | Store SHA-256 hash of IP | **Production (recommended)** |
| `none` | Don't store IP | Maximum privacy |

### Hashed Mode (Recommended for Production)

When `AUDIT_LOG_IP_MODE=hashed`:

- Client IPs are one-way hashed using SHA-256
- The hash combines the IP with `AUDIT_LOG_IP_SALT`
- **Cannot be reversed** to recover the original IP
- **Can be compared** to verify if two events came from the same IP
- Compliant with GDPR/privacy requirements

**Configuration:**

```bash
AUDIT_LOG_IP_MODE=hashed
AUDIT_LOG_IP_SALT=<your-32-char-random-salt>
```

**Generate salt:** `openssl rand -base64 32`

**Important:** 
- `AUDIT_LOG_IP_SALT` is a runtime secret—never commit it to Git
- Store it via Portainer environment variables or Docker Secrets
- If the salt is lost or changed, historical hash comparisons will fail

---

## TRUST_PROXY Setting

When behind a reverse proxy, set `TRUST_PROXY` so the backend sees real client IPs.

| Value | Use Case |
|-------|----------|
| `1` | Single proxy (nginx in Docker stack) |
| `2` | Two proxies (CDN + nginx) |
| `false` | Direct connection (no proxy) |

**Why it matters:**
- Audit logs record client IP
- Rate limiting uses client IP
- Wrong setting = wrong IP in logs

See: [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html)

---

## Cookie Security

| Attribute | Production Value | Purpose |
|-----------|-----------------|--------|
| `HttpOnly` | `true` | Prevents JS access (XSS protection) |
| `Secure` | `true` | HTTPS only |
| `SameSite` | `Lax` | CSRF mitigation |
| `Path` | `/` | Scope to entire app |

---

## CORS Configuration

Set `CORS_ORIGIN` to your exact frontend URL:

```bash
# Correct
CORS_ORIGIN=https://pulse.example.com

# WRONG - never use in production
CORS_ORIGIN=*
```

---

## Database Security

### Ingest User (Least Privilege)

The optional `pulse_ingest` user can only:
- SELECT, INSERT, UPDATE on: `executions`, `execution_nodes`, `workflows_index`, `n8n_metrics_snapshot`

Cannot:
- DELETE any data
- Access `app_users`, `audit_log`, RBAC tables
- Create/modify schema

### Network Isolation

PostgreSQL is not exposed to the host in production compose files. Only containers on the internal Docker network can connect.

---

## Rate Limiting

Rate limiting protects against brute-force attacks and API abuse.

### Implemented Limits

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| `POST /api/auth/login` | 5 requests | 15 minutes | Brute-force protection |
| `POST /api/auth/forgot-password` | 5 requests | 15 minutes | Abuse prevention |
| `POST /api/auth/set-password` | 5 requests | 15 minutes | Token brute-force protection |
| `POST /api/auth/reset-password` | 5 requests | 15 minutes | Token brute-force protection |
| `POST /api/setup/*` | 5 requests | 15 minutes | Setup abuse prevention |
| `ALL /api/admin/*` | 100 requests | 1 minute | Admin API protection |
| `GET /api/metrics/*` | 60 requests | 1 minute | Metrics API protection |

### Rate Limit Response

When rate limit is exceeded:
- HTTP status: `429 Too Many Requests`
- Response body: `{"error": "Too many requests", "retryAfter": <seconds>}`
- Header: `Retry-After: <seconds>`

### Key Generation

Rate limits are tracked per client IP address. Ensure `TRUST_PROXY` is configured correctly so the real client IP is used (not the proxy IP).

---

## Production Security Checklist

### Required (Enforced at Startup)

- [ ] `JWT_SECRET` min 32 chars, randomly generated
- [ ] `JWT_SECRET` contains no placeholder values
- [ ] `COOKIE_SECURE=true`
- [ ] `CORS_ORIGIN` set to exact frontend URL (not `*`)

### Required (Manual Verification)

- [ ] TLS/HTTPS termination in front of the app
- [ ] No secrets committed to Git
- [ ] `.env` file is gitignored

### Recommended (Privacy & Hardening)

- [ ] `AUDIT_LOG_IP_MODE=hashed`
- [ ] `AUDIT_LOG_IP_SALT` set to strong random value (runtime secret)
- [ ] `TRUST_PROXY` set correctly for your infrastructure
- [ ] Database not exposed to host network
- [ ] Regular database backups configured
- [ ] Audit logs monitored for anomalies

---

## Security Assessment

n8n Pulse includes strong baseline security controls:

- JWT authentication with HttpOnly cookies
- bcrypt password hashing (10 rounds)
- Parameterized SQL queries (injection prevention)
- CSRF protection via Origin/Referer validation
- **Brute-force protection**: 5 login attempts per 15 minutes per IP
- **Admin API rate limiting**: 100 requests per minute per IP
- Security headers via Helmet
- Audit logging with configurable privacy modes
- Fail-fast startup checks for critical settings
- Least-privilege database user for n8n ingestion

**The application is suitable for production deployment** when configured with:
- HTTPS via reverse proxy
- Correct `TRUST_PROXY` setting
- Strong, randomly generated secrets
- Recommended hardening options enabled

No security implementation provides absolute guarantees. Regular security reviews, monitoring, and timely updates are essential components of a secure deployment.
