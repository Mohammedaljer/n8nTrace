# Changelog

All notable changes to n8n-trace will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - Unreleased

### Breaking Changes
- **Single container architecture** — merged `n8n-trace-backend` + `n8n-trace-frontend` into one unified image (`mohammedaljer/n8n-trace:v2.0.0`); separate per-service images are removed
- **Container renamed** — `n8n-trace-backend` + `n8n-trace-frontend` → single `n8n_trace_app`; the `frontend` compose service is removed
- **Port mapping changed** — host port now maps to container port `8001` (was `80` via nginx)
- **`TRUST_PROXY` default changed** — `1` → `false`; set to `1` when behind a reverse proxy
- **`COOKIE_SECURE` default changed** — `false` → `true`; set to `false` only for plain HTTP dev
- **Admin group renamed** — `Admins` → `Admin`; an auto-migration merges existing memberships on startup
- **Password minimum length** — 8 → 12 characters (configurable via `PASSWORD_MIN_LENGTH`)
- **New required production env vars** — `APP_URL` and `CORS_ORIGIN` are now validated at startup (fail-fast)
- **3 new database migrations** — auto-applied on startup: `add-executions-instance-started-index`, `add-account-lockout`, `performance-indexes`

### Added
- **Content Security Policy (CSP)** — strict CSP via Helmet on all responses; `CSP_REPORT_ONLY` and `CSP_REPORT_URI` env vars for testing / violation reporting
- **Account lockout** — brute-force protection with configurable threshold (`ACCOUNT_LOCKOUT_THRESHOLD`) and duration (`ACCOUNT_LOCKOUT_DURATION_MINUTES`); timing-safe dummy bcrypt on unknown users; generic error messages; `account_locked` / `account_unlocked` audit events; admin unlock endpoint (`POST /api/admin/users/:userId/unlock`)
- **Password policy** — 12-char minimum, ~60-entry common-password denylist (NCSC top-20, keyboard walks, project terms), email/username containment check; shared `backend/src/utils/password.js` used by setup, set-password, and reset-password routes
- **Session revocation** — `token_version` checked per request; `POST /api/auth/revoke-all-sessions` (self-service) and `POST /api/admin/users/:userId/revoke-sessions` (admin); "Log out all devices" dropdown in AuthStatus component; `all_sessions_revoked` / `admin_revoked_sessions` audit events
- **Response compression** — gzip / brotli via `compression` middleware
- **SPA static-asset serving** — Express serves React SPA; immutable 1-year cache for hashed Vite assets, 1-hour cache for other static files, SPA fallback for client-side routes
- **`ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars** — headless first-admin creation at startup
- **Configurable login rate limit** — `LOGIN_RATE_LIMIT_MAX` (default 20 per 15-min window)
- **Skeleton loading states** — `SkeletonCard`, `SkeletonChart`, `SkeletonTable` components
- **`ErrorState` component** — standardized error display for failed data loads
- **Login return-to redirect** — preserves intended URL after authentication
- **Metrics instance prompt** — widgets show "Select a single instance" when no instance is selected (replaces misleading "Restricted" badge)
- **Backend test suite** — 80 tests covering account lockout, CSRF, env validation, password policy, session revocation, metrics RBAC, and time-range utilities
- **Frontend test setup** — Vitest configuration with test helpers
- **Documentation** — new `docs/architecture.md`, complete root README rewrite, new `CONTRIBUTING.md`, new `CHANGELOG.md`; updated security, environment, deployment, and getting-started docs; updated `.env.example` with all new env vars

### Changed
- CSRF protection expanded to all `/api/` paths (was only `/api/admin/` and `/api/setup/`)
- Cookie `maxAge` now derived from `JWT_EXPIRY` (was hardcoded to 30 minutes)
- `DB_CONNECT_TIMEOUT` default reduced from 10 000 ms to 5 000 ms
- Migrations converted from ESM (`export`) to CommonJS (`exports`) for Node.js compatibility
- Fail-fast startup validation rejects additional unsafe placeholder secrets
- Trivy CI scans the unified image (was separate per-service scans) with weekly schedule added
- CodeQL workflow updated for unified repo structure
- `audit-ci` added for both frontend and backend dependency auditing
- Admin users list now shows lockout status (failed attempts, locked-until timestamp)

### Removed
- Separate `backend/Dockerfile` and `frontend/Dockerfile`
- `frontend/nginx.conf` and frontend `.dockerignore`
- `backend/.dockerignore` and `backend/docker-entrypoint.sh`
- Frontend client-side mock security modules (`UserContext`, `accessControl`, `roles`, `types`, `mockUsers`, `security/index`)
- Unused frontend components (`ApiErrorBanner`, `UserSelector`, `ExecutionsTimeSeriesChart`, `MetricsInstanceSelect`)
- Unused frontend utilities (`memoize.ts`, `mockDataStorage.ts`, `textUtils.ts`)
- Backend seed script `seedMetricsExplorer.js`

### Security
- Strict Content Security Policy on all responses (API + SPA)
- Account lockout with timing-safe login (prevents user enumeration)
- Password denylist and minimum length enforcement
- Container hardening: `read_only: true`, `no-new-privileges`, `tmpfs /tmp`, resource limits (512 MB / 1 CPU)
- Distroless base image (no shell, minimal attack surface, non-root user)

---

## [1.4.2] - 2026-02-28

### Added
- **Metrics Explorer** — new widget to query and chart Prometheus-style metrics with label filtering, time range selection, and aggregation options
- `metrics_series` + `metrics_samples` tables (`add-metrics-explorer` migration)
- Backend `metricsExplorer` service and `labels` utility for metric catalog, label values, and time-series queries
- Metrics config env vars: `METRICS_MAX_BREAKDOWN_ROWS`, `METRICS_MAX_CATALOG_SIZE`, `METRICS_MAX_LABEL_VALUES`
- Frontend data layer: `DataContext`, `MetricsContext`, `ApiDataSource`, `CsvDataSource`, aggregation modules (`kpiAggregations`, `timeSeries`, `workflowAggregations`), execution selectors, and filter helpers
- Frontend API modules: `authApi.ts`, `metricsApi.ts`, `setupApi.ts`, `config.ts`
- Cosign image signing public key (`cosign/cosign.pub`)
- `docs/environment.md` — dedicated environment variable reference
- Metrics Explorer seed data script (`seedMetricsExplorer.js`)

### Changed
- Backend Dockerfile: base image changed from `node:24-alpine` to `gcr.io/distroless/nodejs22-debian12:nonroot` (deps stage uses `node:22.14.0-alpine`)
- Frontend Dockerfile: builder stage pinned to `node:22.14.0-alpine`; added `ca-certificates` and `libpng` upgrade
- Healthchecks replaced `curl` with native `node fetch()` (backend) and `nginx -t` (frontend)
- Postgres image pinned from `17-alpine` to `17.2-alpine`
- Docker Compose: removed inline `build:` directives (uses pre-built images at `v1.4.1`), added `no-new-privileges` security opt to all services, made `TRUST_PROXY` configurable via env var
- `COOKIE_SECURE` default changed to `false` in compose (was `true`) for easier local development
- Dependency updates for security compliance (backend overrides, frontend build deps)
- Updated documentation across `docs/` (backend, configuration, deployment, security, troubleshooting, rbac, frontend, getting-started)

### Security
- GitHub Actions: Trivy container scanning and CodeQL code analysis workflows added
- `no-new-privileges` security opt on all Docker Compose services
- Distroless backend runtime image (no shell, non-root user)

---

## [1.4.1] - 2026-02-21

Tags the same commit as v1.4.0 (`ded38c4`). Published to align Docker Hub image tags; no functional changes from v1.4.0.

---

## [1.4.0] - 2026-02-21

### Changed
- **Backend modularization** — monolithic `backend/index.js` (~2 400 lines) refactored into `src/` module structure:
  - `src/app.js` — Express app factory
  - `src/server.js` — startup entry point
  - `src/config/` — centralized env parsing and validation (`env.js`, `index.js`)
  - `src/db/` — connection pool (`pool.js`) and auto-init / migration runner (`autoInit.js`)
  - `src/middleware/` — `auth.js`, `csrf.js`, `rateLimiters.js`
  - `src/routes/` — `admin.js`, `auth.js`, `data.js`, `health.js`, `metrics.js`, `setup.js`
  - `src/services/` — `audit.js`, `authz.js`, `passwordTokens.js`, `retention.js`
  - `src/utils/` — `sql.js`
- Postgres image upgraded from `16-alpine` to `17-alpine` in `docker-compose.prod.yml`
- Docker Compose image tags bumped from `v1.3.0` to `v1.3.2`
- Repository links updated to `n8n-trace` across documentation and frontend footer

### Added
- `.env.example` — comprehensive environment variable template with inline documentation
- `Workflows/` directory with n8n workflow JSON files:
  - `n8n-trace-Execution-Collector.json` — execution data ingestion workflow
  - `metrics-snapshot.json` — instance metrics collection workflow
  - `Workflows/README.md` — setup and configuration guide
- Documentation updates: expanded backend API reference, deployment and troubleshooting sections

### Fixed
- Repository directory name in getting-started guide
- Image path for n8n-trace logo in README

---

## [1.3.2] - 2026-02-19

### Changed
- **RBAC authorization rewrite** — replaced ad-hoc scope-WHERE builder with centralized `getAuthorizationContext()` helper:
  - Single source of truth for permission resolution (admin detection, workflow/tag/instance scope evaluation)
  - Per-request caching (`req._authzCache`) to avoid redundant DB queries
  - JSONB `?|` operator for tag-based scope resolution against `workflows_index.tags`
  - Explicit default-deny for non-admin users with no scope rows
  - Dedicated instance-level metrics access control (`userHasInstanceAccessForMetrics`, `getUserAllowedInstancesForMetrics`)
- Dashboard "Customize" button available to all authenticated users (was admin-only)

---

## [1.3.1] - 2026-02-16

### Added
- Initial public release of n8n-trace
- **Backend** — Express.js REST API with JWT authentication (HttpOnly/Secure/SameSite cookies), PostgreSQL database, auto-applied migrations (`node-pg-migrate`), RBAC (Admin / Analyst / Viewer), audit logging, data retention with scheduled cleanup, rate limiting, CSRF protection, health/readiness endpoints
- **Frontend** — React 18 SPA with TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts; execution analytics dashboard, instance monitoring, workflow views, admin pages (users, groups, audit log), dark/light theme
- **Docker** — separate `backend/Dockerfile` and `frontend/Dockerfile` (Node.js + nginx), `docker-compose.prod.yml` with PostgreSQL
- **Documentation** — `docs/` with backend API, deployment, security, RBAC, configuration, troubleshooting, getting-started guides
- **Migrations** — init schema, password tokens, token versioning, retention and audit, multi-tenant executions, metrics snapshot, retention indexes
- MIT License
