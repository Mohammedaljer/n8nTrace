# Contributing to n8n-trace

Thank you for your interest in contributing to n8n-trace. This guide covers the development workflow, project conventions, and pull request expectations.

---

## Table of Contents

- [Contributing to n8n-trace](#contributing-to-n8n-trace)
  - [Table of Contents](#table-of-contents)
  - [Quick Start](#quick-start)
  - [Development Setup](#development-setup)
    - [Prerequisites](#prerequisites)
    - [Option A — Docker (Recommended)](#option-a--docker-recommended)
    - [Option B — Local Node.js](#option-b--local-nodejs)
  - [Project Architecture](#project-architecture)
  - [Backend Guidelines](#backend-guidelines)
    - [Language \& Modules](#language--modules)
    - [Code Conventions](#code-conventions)
    - [RBAC-Aware Development](#rbac-aware-development)
    - [Security Expectations](#security-expectations)
  - [Frontend Guidelines](#frontend-guidelines)
  - [Database Migrations](#database-migrations)
    - [Creating a Migration](#creating-a-migration)
  - [Testing](#testing)
    - [Backend (Jest)](#backend-jest)
    - [Frontend (Vitest)](#frontend-vitest)
  - [Commit Message Format](#commit-message-format)
  - [Pull Request Checklist](#pull-request-checklist)
    - [PR Description](#pr-description)
  - [Reporting Issues](#reporting-issues)
  - [Security](#security)
  - [License](#license)

---

## Quick Start

```bash
# 1. Fork and clone
git clone https://github.com/<your-username>/n8nTrace.git
cd n8nTrace

# 2. Create a branch
git checkout -b feature/my-change

# 3. Copy env template and set development values
cp .env.example .env

# 4. Start the dev environment
docker compose -f docker-compose.local.yml up -d

# 5. Make your changes, then push
git push origin feature/my-change
```

Then open a Pull Request at https://github.com/Mohammedaljer/n8nTrace/compare.

---

## Development Setup

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22+ |
| PostgreSQL | 17+ (or use the Docker Compose setup) |
| Docker + Compose | v2+ (for containerized development) |

### Option A — Docker (Recommended)

```bash
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD, JWT_SECRET, APP_ENV=development
docker compose -f docker-compose.local.yml up -d
```

The app will be available at **http://localhost:8899** (configurable via `HTTP_PORT`).

The local compose file builds the unified image from the root `Dockerfile`, which compiles the React frontend and bundles it into the Express backend. A single container (`n8n_trace_app`) serves both the API and the SPA on port 8001 (mapped to the host port above).

### Option B — Local Node.js

```bash
# Backend
cd backend
npm install
npm run dev          # nodemon, auto-restarts on changes

# Frontend (separate terminal)
cd frontend
npm install
npm run dev          # Vite dev server with HMR
```

> [!NOTE]
> When running locally without Docker, you need a PostgreSQL 17+ instance accessible via `DATABASE_URL`. See [Getting Started](./docs/getting-started.md) for detailed setup instructions.

---

## Project Architecture

n8n-trace ships as a **single Docker image** (`mohammedaljer/n8n-trace`). The multi-stage `Dockerfile` at the repo root builds the React SPA, installs backend dependencies, and produces a [Distroless](https://github.com/GoogleContainerTools/distroless) production image (`gcr.io/distroless/nodejs22-debian12:nonroot`) with no shell and a non-root user.

```
n8n-trace/
├── Dockerfile                # Unified multi-stage build (frontend + backend → distroless)
├── docker-compose.prod.yml   # Production compose (pre-built image + Postgres)
├── docker-compose.local.yml  # Development compose (builds from Dockerfile)
├── .env.example              # Environment variable template
│
├── backend/                  # Express.js 5 API (CommonJS)
│   ├── index.js              # Entry point
│   ├── src/
│   │   ├── app.js            # Express app factory
│   │   ├── server.js         # Startup bootstrap
│   │   ├── config/           # Env parsing & validation
│   │   ├── db/               # Connection pool & auto-init / migration runner
│   │   ├── middleware/        # auth, csrf, rateLimiters
│   │   ├── routes/           # admin, auth, data, health, metrics, setup
│   │   ├── services/         # audit, authz, metricsExplorer, passwordTokens, retention
│   │   └── utils/            # labels, password, sql, timeRange
│   ├── migrations/           # node-pg-migrate migrations (CommonJS)
│   ├── seed/                 # Dashboard seed data scripts
│   └── tests/                # Jest + supertest test suite
│
├── frontend/                 # React 18 SPA (TypeScript, Vite, Tailwind CSS, shadcn/ui)
│   └── src/
│       ├── components/       # Shared UI components & widgets
│       ├── pages/            # Route pages (Dashboard, Executions, Workflows, …)
│       ├── admin/            # Admin panel (users, groups, audit log)
│       ├── data/             # API clients, data sources, contexts, aggregations
│       ├── hooks/            # React hooks (useFilters, useTheme, useMobile, …)
│       ├── lib/              # Utility helpers (date presets, export, formatting)
│       └── types/            # TypeScript type definitions
│
├── Workflows/                # n8n workflow JSON files for data collection
├── docs/                     # Project documentation
└── cosign/                   # Image signing public key
```

---

## Backend Guidelines

### Language & Modules

- **CommonJS** — use `require()` / `module.exports` throughout, including migrations.
- **No ESM** — the backend does not use `import` / `export` syntax.

### Code Conventions

- **Parameterized SQL** — never interpolate user input into queries. Use `$1, $2, …` placeholders with `pg`.
- **Error handling** — return appropriate HTTP status codes with JSON response bodies (`{ error: "..." }`).
- **Configuration** — all environment variables flow through `backend/src/config/index.js`. Do not read `process.env` directly in route handlers or services.
- **Middleware** — authentication (`auth.js`), CSRF (`csrf.js`), and rate limiting (`rateLimiters.js`) are centralized in `backend/src/middleware/`.

### RBAC-Aware Development

n8n-trace enforces role-based access control (Admin / Analyst / Viewer) at the API layer. When adding or modifying data endpoints:

1. Use the centralized `getAuthorizationContext()` helper from `backend/src/services/authz.js` to resolve the caller's permissions.
2. Apply scope filters (workflow, tag, instance) to all data queries for non-admin users.
3. Never expose unfiltered query results — default-deny for users without explicit scope rows.
4. Test permission boundaries (see `backend/tests/` for examples).

See [RBAC documentation](./docs/rbac.md) for the full permission model.

### Security Expectations

- Do not commit secrets, `.env` files, or credentials.
- Passwords must pass the shared validation in `backend/src/utils/password.js` (12-char minimum, denylist, no email/username containment).
- New routes that modify state must be covered by CSRF protection (all `/api/` paths are protected by default).
- Use timing-safe comparisons for any security-sensitive string checks.

---

## Frontend Guidelines

- **TypeScript** — all new components must be `.tsx` / `.ts`. No plain `.js` files in `frontend/src/`.
- **Tailwind CSS + shadcn/ui** — use existing design tokens and component patterns from `frontend/src/components/ui/`.
- **Data fetching** — use `@tanstack/react-query` via the data layer in `frontend/src/data/`. API calls go through `authApi.ts`, `metricsApi.ts`, or `setupApi.ts`.
- **Linting** — run `npm run lint` before committing (ESLint with `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`).
- **Routing** — `react-router-dom` v6. Route pages live in `frontend/src/pages/`, admin pages in `frontend/src/admin/pages/`.

---

## Database Migrations

Migrations use [`node-pg-migrate`](https://github.com/salsita/node-pg-migrate) and run **automatically on startup** (via `backend/src/db/autoInit.js`). No manual migration step is required.

### Creating a Migration

1. Generate or manually create a file in `backend/migrations/` with a timestamp prefix:

   ```bash
   cd backend
   npm run migrate:create -- my-migration-name
   ```

   Or create manually:
   ```
   backend/migrations/1770760000000_my-migration.js
   ```

2. Use **CommonJS** export syntax:

   ```js
   exports.up = (pgm) => {
     pgm.addColumn('my_table', {
       new_column: { type: 'text', notNull: false }
     });
   };

   exports.down = (pgm) => {
     pgm.dropColumn('my_table', 'new_column');
   };
   ```

3. Always include a `down` function for rollback support.

4. Migrations run in filename order. Use a timestamp prefix higher than the latest existing migration (`1770750000000`).

> [!IMPORTANT]
> Every migration must be idempotent-safe. Use `ifNotExists: true` for index and table creation where possible.

---

## Testing

### Backend (Jest)

```bash
cd backend

# Run all tests
npm test

# Security tests only (password, lockout, session revocation)
npm run test:security

# RBAC tests only
npm run test:rbac
```

- **Jest 30** + **supertest 7** in Node.js environment.
- Test files: `backend/tests/*.test.js`.
- Shared helpers: `backend/tests/helpers.js` (mock pool, mock request/response factories).
- Test timeout: 30 000 ms (configured in `jest.config.js`).

### Frontend (Vitest)

```bash
cd frontend

# Run all tests
npm test

# Watch mode
npm run test:watch

# Specific test with verbose output
npm run test:ui
```

- **Vitest** with `jsdom` environment and `@testing-library/react`.
- Test files: `frontend/src/**/*.{test,spec}.{ts,tsx}`.
- Setup file: `frontend/src/test/setup.ts`.

---

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/) style:

```
<type>: <short summary>
```

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Build, CI, dependency updates |
| `security` | Security hardening or vulnerability fix |

Examples:
```
feat: add workflow tag filtering to dashboard
fix: rate limiter not resetting after lockout expiry
docs: update deployment guide for unified image
refactor: extract password validation to shared utility
security: add CSP headers to all responses
```

---

## Pull Request Checklist

Before submitting, confirm:

- [ ] Branch is up to date with `main`
- [ ] Code follows project conventions (CommonJS backend, TypeScript frontend)
- [ ] `npm run lint` passes in `frontend/` (no ESLint errors)
- [ ] Backend tests pass (`cd backend && npm test`)
- [ ] Frontend tests pass (`cd frontend && npm test`)
- [ ] New features include tests where applicable
- [ ] New/changed env vars are documented in `.env.example`
- [ ] Migrations include a `down` function
- [ ] Documentation updated if behavior changes
- [ ] No secrets, `.env` files, or credentials in the diff

### PR Description

Include:
- **What** changed and **why**
- **How to test** the change
- **Screenshots** for UI changes

---

## Reporting Issues

Use [GitHub Issues](https://github.com/Mohammedaljer/n8nTrace/issues/new/choose):

- **Bug reports** — include steps to reproduce, expected vs. actual behavior, and your environment (Docker version, OS, browser).
- **Feature requests** — describe the use case and proposed solution.
- **Security vulnerabilities** — do **not** open a public issue. See [Security](#security) below.

---

## Security

If you discover a security vulnerability, please do not open a public issue. Refer to the [Security Guide](./docs/security.md) for responsible disclosure information.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
