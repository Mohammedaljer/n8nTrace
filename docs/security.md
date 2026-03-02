# Security Guide

<!-- TOC -->

- [Security Guide](#security-guide)
    - [Secrets Management](#secrets-management)
        - [Never Commit](#never-commit)
        - [Runtime Injection](#runtime-injection)
    - [Startup Enforcement Fail-fast](#startup-enforcement-fail-fast)
    - [Content Security Policy CSP](#content-security-policy-csp)
        - [Directives](#directives)
        - [Configuration](#configuration)
    - [Account Lockout](#account-lockout)
        - [How It Works](#how-it-works)
        - [Configuration](#configuration)
        - [Security Details](#security-details)
    - [Password Policy](#password-policy)
        - [Rules](#rules)
        - [Configuration](#configuration)
        - [Denylist Examples](#denylist-examples)
    - [Session Revocation](#session-revocation)
        - [How It Works](#how-it-works)
        - [User Self-Service](#user-self-service)
        - [Admin Revocation](#admin-revocation)
    - [Audit Logging](#audit-logging)
        - [IP Modes](#ip-modes)
    - [TRUST_PROXY Setting](#trust_proxy-setting)
        - [Default: TRUST_PROXY=false](#default-trust_proxyfalse)
        - [Behind a Reverse Proxy: TRUST_PROXY=1](#behind-a-reverse-proxy-trust_proxy1)
        - [When to Change](#when-to-change)
    - [Cookie Security](#cookie-security)
    - [CSRF Protection](#csrf-protection)
        - [How It Works](#how-it-works)
        - [Defense in Depth](#defense-in-depth)
    - [Database Security](#database-security)
        - [Ingest User Least Privilege](#ingest-user-least-privilege)
        - [Network Isolation](#network-isolation)
    - [Rate Limiting](#rate-limiting)
        - [Body Size Limit](#body-size-limit)
    - [Response when exceeded: HTTP 413 Payload Too Large.](#response-when-exceeded-http-413-payload-too-large)
    - [Production Security Checklist](#production-security-checklist)
        - [Required Enforced](#required-enforced)
        - [Required Manual](#required-manual)
        - [Recommended](#recommended)
    - [Security Assessment](#security-assessment)
        - [Authentication & Sessions](#authentication--sessions)
        - [Brute Force & Password Protection](#brute-force--password-protection)
        - [HTTP Security](#http-security)
        - [Data Protection](#data-protection)
        - [Infrastructure](#infrastructure)

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
| `POSTGRES_PASSWORD` / `DATABASE_URL` | No placeholder values (`changeme`, `password123`, etc.) |

---

## Content Security Policy (CSP)

n8n Pulse ships with a strict Content Security Policy enforced by Helmet. The CSP applies to **all responses** (API and static SPA files) because Express serves everything from a single process — there is no separate nginx layer.

### Directives

| Directive | Value | Purpose |
|-----------|-------|----------|
| `default-src` | `'self'` | Block all external resources by default |
| `script-src` | `'self'` | Only scripts from the same origin |
| `style-src` | `'self' 'unsafe-inline'` | Allow inline styles (required by Tailwind/shadcn) |
| `img-src` | `'self' data:` | Same-origin images + data URIs |
| `font-src` | `'self'` | Same-origin fonts only |
| `connect-src` | `'self'` | XHR/fetch to same origin only |
| `frame-src` | `'none'` | No iframes allowed |
| `object-src` | `'none'` | No plugins, Flash, etc. |
| `base-uri` | `'self'` | Prevent `<base>` tag hijacking |
| `form-action` | `'self'` | Forms can only submit to same origin |
| `frame-ancestors` | `'none'` | Prevent embedding in iframes (clickjacking) |
| `upgrade-insecure-requests` | — | Auto-upgrade HTTP to HTTPS |

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CSP_REPORT_ONLY` | `false` | Set `true` to log violations without blocking (testing mode) |
| `CSP_REPORT_URI` | — | URL to receive CSP violation reports |

> **Tip**: Enable `CSP_REPORT_ONLY=true` first when deploying to production to catch any violations before enforcing.

---

## Account Lockout

Brute-force protection on the login endpoint. After repeated failed attempts, the account is temporarily locked.

### How It Works

1. Each failed login increments `failed_login_attempts` on the user record
2. After **threshold** failures, the account is locked for the configured duration
3. On successful login, the counter resets to zero
4. Locked accounts reject login even with the correct password
5. The lock expires automatically after the duration elapses

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ACCOUNT_LOCKOUT_THRESHOLD` | `10` | Failed attempts before lockout |
| `ACCOUNT_LOCKOUT_DURATION_MINUTES` | `15` | How long the lock lasts |

### Security Details

- **Timing-safe**: Non-existent user emails still run a dummy bcrypt compare to prevent timing-based user enumeration
- **Generic errors**: All failure modes return `"Invalid email or password"` — never reveals whether the email exists or the account is locked
- **Audit events**: `account_locked` and `account_unlocked` events are logged to the audit table
- **Complements rate limiting**: Account lockout protects _per-user_, while IP rate limiting (20 req / 15 min) protects _per-IP_

---

## Password Policy

All password-setting operations (initial setup, set-password, reset-password) enforce a shared validation policy.

### Rules

| Rule | Details |
|------|---------|
| **Minimum length** | 12 characters (configurable via `PASSWORD_MIN_LENGTH`) |
| **Denylist** | ~60 common passwords rejected (NCSC top-20, keyboard walks, project-specific terms) |

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PASSWORD_MIN_LENGTH` | `12` | Minimum password length |

### Denylist Examples

The denylist includes:
- NCSC top-20 (`password`, `123456`, `qwerty`, etc.)
- Keyboard walks (`qwerty123`, `1q2w3e4r`, etc.)
- Project-specific (`n8npulse`, `n8n_pulse`, `pulseadmin`)
- Seasonal patterns (`summer2024`, `winter2025`)

> The validation logic lives in `backend/src/utils/password.js` as a single source of truth used by all routes.

---

## Session Revocation

n8n Pulse supports global session revocation via token versioning.

### How It Works

1. Each user has a `token_version` column (integer, default 0)
2. Every JWT includes the user's current `token_version` at signing time
3. The `requireAuth` middleware checks the token's version against the database on every request
4. Incrementing `token_version` invalidates **all** existing JWTs for that user

### User Self-Service

- **"Log out all devices"** button in the UI (AuthStatus dropdown)
- Calls `POST /api/auth/revoke-all-sessions`
- Increments `token_version`, clears the current cookie, logs `all_sessions_revoked` audit event

### Admin Revocation

- `POST /api/admin/users/:userId/revoke-sessions`
- Requires `admin:users` permission
- Logs `admin_revoked_sessions` audit event with the target user ID

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

`TRUST_PROXY` controls how Express resolves the client IP from `X-Forwarded-For`.

| Value | Meaning |
|-------|---------|
| `false` | Disable proxy trust (default — use raw TCP connection IP) |
| `1` | Trust one proxy hop (behind Traefik, Caddy, NGINX, ALB) |
| `2` | Trust two proxy hops (behind CDN + LB) |

### Default: `TRUST_PROXY=false`

When accessed directly (no reverse proxy), Express uses the raw TCP connection IP. This is safe and correct.

### Behind a Reverse Proxy: `TRUST_PROXY=1`

When you place your own reverse proxy (Traefik, Caddy, NGINX, ALB) in front of n8n Pulse for TLS termination, set `TRUST_PROXY=1`. Express reads the real client IP from the rightmost entry in `X-Forwarded-For`.

### When to Change

| Deployment | Value |
|-----------|-------|
| Direct Docker Compose, no proxy | `false` (default) |
| Behind one proxy | `1` |
| Behind CDN + proxy | `2` |

Incorrect values cause:
- Audit logs recording proxy IPs instead of client IPs.
- Rate limiting keying on a single proxy IP (ineffective).
- All users appearing to originate from the same address.

See [Architecture → Proxy Trust Model](./architecture.md#proxy-trust-model) for the full explanation.

---

## Cookie Security

| Attribute | Production Value |
|-----------|------------------|
| `HttpOnly` | `true` |
| `Secure` | `true` |
| `SameSite` | `Lax` |
| `Path` | `/` |

---

## CSRF Protection

n8n Pulse validates the `Origin` (or `Referer`) header on **all mutating requests** (`POST`, `PUT`, `PATCH`, `DELETE`) to any `/api/` endpoint.

### How It Works

1. The middleware computes the expected origin from `APP_URL` (or falls back to the `Host` header).
2. For every mutation to `/api/*`, it extracts the `Origin` header (falling back to `Referer`).
3. If the origin does not match, the request is rejected with `403 Forbidden`.
4. `GET` / `HEAD` / `OPTIONS` requests are exempt (safe methods).

### Defense in Depth

CSRF protection works alongside:
- **`SameSite=Lax` cookies** — browsers block cross-site cookie sending on most requests
- **No CORS wildcard** — `CORS_ORIGIN` must be an exact URL in production
- **Content Security Policy** — `form-action 'self'` prevents form submissions to external origins

---

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

n8n Pulse uses `express-rate-limit` middleware for per-IP rate limiting on sensitive endpoints.

| Limiter | Rate | Window | Applied To |
|---------|------|--------|------------|
| `loginLimiter` | 20 req | 15 min | `POST /api/auth/login` |
| `sensitiveAuthLimiter` | 5 req | 15 min | Password reset/set endpoints |
| `adminCreateLimiter` | 10 req | 1 min | User creation, invite, password link |
| `setupLimiter` | 5 req | 15 min | `/api/setup/*` |
| `metricsLimiter` | 60 req | 1 min | `/api/metrics/*` |
| `adminApiLimiter` | 100 req | 1 min | `/api/admin/*` |

Express rate limiters return HTTP `429` with a JSON body containing `retryAfter` seconds.

Rate limiters key on the client IP derived from `TRUST_PROXY`. When `TRUST_PROXY` is set correctly, each client is limited individually. If incorrect, all clients may appear as one IP.

### Body Size Limit

Express rejects request bodies larger than 1 MB via `express.json({ limit: '1mb' })`. n8n Pulse only accepts small JSON payloads (login credentials, query parameters, admin operations).

**Response when exceeded**: HTTP `413 Payload Too Large`.
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
- [ ] `PASSWORD_MIN_LENGTH` ≥ 12
- [ ] `ACCOUNT_LOCKOUT_THRESHOLD` ≤ 10
- [ ] `CSP_REPORT_ONLY=false` (enforcing mode)
- [ ] Database not exposed
- [ ] Backups configured

---

## Security Assessment

n8n Pulse includes the following defense-in-depth measures:

### Authentication & Sessions
- JWT auth with HttpOnly/Secure/SameSite cookies (30-min maxAge)
- bcrypt password hashing (10 rounds)
- Token versioning for global session revocation ("Log out all devices")
- Admin endpoint to revoke any user's sessions

### Brute Force & Password Protection
- Account lockout after configurable failed attempts (default: 10 / 15 min)
- IP-based rate limiting via `express-rate-limit` on all sensitive endpoints
- 12-character minimum password with common-password denylist (~60 entries)
- Timing-safe login (dummy bcrypt on nonexistent users)
- Generic error messages (no user enumeration)

### HTTP Security
- Strict Content Security Policy via Helmet (all directives locked to `'self'`)
- `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` headers
- `X-XSS-Protection: 0` (disables legacy filter, avoids XSS-via-filter attacks)
- CSRF protection via Origin/Referer validation on **all** mutating `/api/` endpoints
- SameSite=Lax cookies as additional CSRF defense
- `upgrade-insecure-requests` CSP directive
- `frame-ancestors 'none'` (clickjacking protection)

### Data Protection
- Parameterized SQL (injection prevention)
- Audit logging with configurable IP privacy (raw, hashed, none)
- Least-privilege database user for n8n data ingestion
- `express.json({ limit: '1mb' })` to reject oversized payloads

### Infrastructure
- Google Distroless container image (no shell, no package manager)
- Fail-fast startup checks in production (rejects insecure configs)
- No-cache headers on `index.html` to ensure fresh deploys
- Immutable cache headers on Vite-hashed assets (1 year)
- Standard Express `trust proxy` model — set `TRUST_PROXY` to match your infrastructure
- Gzip compression via `compression` middleware

**Production-ready** when configured with HTTPS, correct proxy trust, and strong secrets.
