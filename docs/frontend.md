# Frontend Architecture

n8n-trace frontend is a React SPA with TypeScript, providing dashboards and admin interfaces. In production, the built SPA is served by the Express backend as static files.

## Technology Stack

| Component | Technology | Version |
|-----------|------------|--------|
| Framework | React | 18.x |
| Language | TypeScript | 5.x |
| Build Tool | Vite | 7.x |
| Styling | Tailwind CSS | 3.x |
| UI Components | shadcn/ui | - |
| State | TanStack Query | 5.x |
| Routing | React Router | 6.x |
| Charts | Recharts | 2.x |

## Project Structure

```
frontend/
├── src/
│   ├── App.tsx                 # Main app with routes
│   ├── main.tsx                # Entry point
│   │
│   ├── pages/                  # Page components
│   │   ├── DashboardPage.tsx
│   │   ├── WorkflowsPage.tsx
│   │   ├── ExecutionsPage.tsx
│   │   ├── ExecutionDetailPage.tsx
│   │   ├── HelpPage.tsx
│   │   ├── Login.tsx
│   │   ├── Setup.tsx
│   │   ├── ForgotPassword.tsx
│   │   ├── SetPassword.tsx
│   │   ├── ResetPassword.tsx
│   │   └── NotFound.tsx
│   │
│   ├── admin/                  # Admin pages
│   │   └── pages/
│   │       ├── AdminUsersPage.tsx
│   │       ├── AdminGroupsPage.tsx
│   │       ├── AdminRolesPage.tsx
│   │       └── AdminAuditLogPage.tsx
│   │
│   ├── components/             # Reusable components
│   │   ├── ui/                 # shadcn/ui components
│   │   ├── charts/             # Chart components
│   │   ├── dashboard/          # Dashboard widgets
│   │   ├── widgets/            # Metrics widgets
│   │   ├── AppLayout.tsx
│   │   ├── AppHeader.tsx
│   │   ├── AppSidebar.tsx
│   │   └── ...
│   │
│   ├── security/               # Auth & RBAC
│   │   ├── AuthContext.tsx
│   │   ├── RequireAuth.tsx
│   │   ├── RequirePerm.tsx
│   │   └── accessControl.ts
│   │
│   ├── data/                   # API & data layer
│   │   ├── DataContext.tsx
│   │   ├── ApiDataSource.ts
│   │   ├── setupApi.ts
│   │   └── config.ts
│   │
│   ├── hooks/                  # Custom hooks
│   │   ├── useFilters.ts
│   │   ├── useTheme.tsx
│   │   └── use-toast.ts
│   │
│   └── lib/                    # Utilities
│       ├── utils.ts
│       ├── datePresets.ts
│       └── metricsFormat.ts
│
├── public/                     # Static assets
└── package.json
```

## Routes

### Public Routes (no auth)

| Route | Component | Description |
|-------|-----------|-------------|
| `/setup` | Setup | Initial admin creation |
| `/login` | Login | User login |
| `/forgot-password` | ForgotPassword | Request reset |
| `/set-password` | SetPassword | Set password (invite) |
| `/reset-password` | ResetPassword | Reset password |

### Protected Routes (require auth)

| Route | Component | Permission |
|-------|-----------|------------|
| `/` | Redirect to /dashboard | - |
| `/dashboard` | DashboardPage | - |
| `/workflows` | WorkflowsPage | `read:workflows` |
| `/executions` | ExecutionsPage | `read:executions` |
| `/executions/:executionId` | ExecutionDetailPage | `read:executions` |
| `/help` | HelpPage | - |

### Admin Routes (require `admin:*` permissions)

| Route | Component | Permission |
|-------|-----------|------------|
| `/admin/users` | AdminUsersPage | `admin:users` |
| `/admin/groups` | AdminGroupsPage | `admin:roles` |
| `/admin/roles` | AdminRolesPage | `admin:roles` |
| `/admin/audit-log` | AdminAuditLogPage | `admin:users` |

## Authentication

Auth state managed via `AuthContext`:

```tsx
const { user, permissions, isAuthenticated, logout } = useAuth();
```

### Route Protection

```tsx
// Require authentication (redirects to /login?returnTo=<current-path>)
<RequireAuth>
  <AppLayout />
</RequireAuth>

// Require specific permission (redirects to /login or /dashboard)
<RequirePerm perm=\"admin:users\">
  <AdminUsersPage />
</RequirePerm>
```

After login, the user is redirected to the original URL from the `returnTo` query parameter (or `/dashboard` by default).

## API Integration

API calls use `fetch` with credentials:

```typescript
const response = await fetch(`${API_BASE_URL}/api/endpoint`, {
  credentials: 'include',  // Include cookies
  headers: { 'Content-Type': 'application/json' },
});
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE_URL` | Backend URL (empty = relative `/api`) |
| `VITE_DATA_MODE` | `api` (default) or `mock` |

## Building

### Development

```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

### Production

```bash
npm run build
# Output in dist/
```

### Docker

The frontend is built during the unified Docker image build (3-stage Dockerfile at repo root):

```bash
# Build the unified image (from repo root)
docker build -t n8n_trace:local .
```

The Vite build output (`dist/`) is copied to `/app/public` inside the container. Express serves these files with appropriate cache headers:

| Path | Cache | Description |
|------|-------|-------------|
| `/assets/*` | `max-age=1y, immutable` | Vite-hashed JS/CSS bundles |
| `/` (other static) | `max-age=1h` | Favicon, robots.txt, etc. |
| `index.html` (SPA fallback) | `no-cache, no-store` | Always fresh |

See [Architecture](./architecture.md) for the full request flow.
