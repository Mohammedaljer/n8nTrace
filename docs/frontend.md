# Frontend Architecture

n8n Pulse frontend is a React single-page application built with Vite, providing the dashboard UI for workflow execution analytics.

## Table of Contents

- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Components Overview](#components-overview)
- [Routing](#routing)
- [State Management](#state-management)
- [API Communication](#api-communication)
- [Styling & Theming](#styling--theming)
- [Building & Running](#building--running)

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|--------|
| Framework | React 18 | UI library |
| Build Tool | Vite 5 | Fast dev server & bundler |
| Language | TypeScript | Type safety |
| Styling | Tailwind CSS | Utility-first CSS |
| UI Components | shadcn/ui | Accessible component library |
| Charts | Recharts | Data visualization |
| Icons | Lucide React | Icon library |
| HTTP Client | Fetch API | API requests |
| Date Handling | date-fns | Date formatting/manipulation |

---

## Project Structure

```
frontend/
├── public/               # Static assets
├── src/
│   ├── main.tsx          # Application entry point
│   ├── App.tsx           # Root component with routing
│   ├── App.css           # Global styles
│   ├── index.css         # Tailwind imports
│   ├── vite-env.d.ts     # Vite type definitions
│   │
│   ├── components/       # Reusable UI components
│   │   ├── ui/           # shadcn/ui base components
│   │   ├── AppLayout.tsx
│   │   ├── AppSidebar.tsx
│   │   ├── GlobalFilterBar.tsx
│   │   ├── ExportMenu.tsx
│   │   └── ...
│   │
│   ├── pages/            # Page components
│   │   ├── Dashboard.tsx
│   │   ├── Login.tsx
│   │   ├── Setup.tsx
│   │   └── ...
│   │
│   ├── admin/            # Admin-only pages
│   │   ├── pages/
│   │   │   ├── UsersPage.tsx
│   │   │   ├── GroupsPage.tsx
│   │   │   └── AuditPage.tsx
│   │   └── components/
│   │
│   ├── hooks/            # Custom React hooks
│   │   ├── useAuth.ts
│   │   ├── useExecutions.ts
│   │   └── ...
│   │
│   ├── lib/              # Utility functions
│   │   └── utils.ts
│   │
│   ├── types/            # TypeScript type definitions
│   │   └── index.ts
│   │
│   ├── data/             # Data fetching & state
│   │   ├── api.ts        # API client
│   │   └── queries.ts    # React Query hooks
│   │
│   └── security/         # Auth & permission utilities
│       └── permissions.ts
│
├── Dockerfile            # Production image
├── nginx.conf            # nginx configuration
├── vite.config.ts        # Vite configuration
├── tailwind.config.js    # Tailwind configuration
├── tsconfig.json         # TypeScript configuration
└── package.json          # Dependencies
```

---

## Components Overview

### Layout Components

| Component | Purpose |
|-----------|--------|
| `AppLayout` | Main layout wrapper with sidebar |
| `AppSidebar` | Navigation sidebar |
| `AppHeader` | Top header bar |
| `AppFooter` | Footer with version info |
| `PageShell` | Page wrapper with title |

### Dashboard Components

| Component | Purpose |
|-----------|--------|
| `GlobalFilterBar` | Date range, instance, workflow filters |
| `FilterChips` | Active filter display |
| `DateRangePresets` | Quick date selection |
| `InstanceSelect` | n8n instance selector |
| `ExportMenu` | CSV/JSON export options |

### Data Display

| Component | Purpose |
|-----------|--------|
| `ExecutionChart` | Execution status over time |
| `WorkflowTable` | Workflow list with stats |
| `NodePerformance` | Node execution metrics |
| `MetricsChart` | Instance health graphs |

### Admin Components

| Component | Purpose |
|-----------|--------|
| `UsersPage` | User management |
| `GroupsPage` | Group/role management |
| `AuditPage` | Audit log viewer |
| `RetentionSettings` | Data retention config |

---

## Routing

### Public Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/login` | Login | User authentication |
| `/setup` | Setup | First admin creation |
| `/forgot-password` | ForgotPassword | Password reset request |
| `/reset-password` | ResetPassword | Password reset form |

### Protected Routes (Requires Auth)

| Path | Component | Required Role |
|------|-----------|---------------|
| `/` | Dashboard | Any |
| `/executions` | Executions | Any |
| `/workflows` | Workflows | Any |
| `/metrics` | Metrics | Analyst+ |
| `/admin/users` | UsersPage | Admin |
| `/admin/groups` | GroupsPage | Admin |
| `/admin/audit` | AuditPage | Admin |
| `/admin/retention` | RetentionPage | Admin |

### Route Guards

```tsx
// Setup guard: redirect to /setup if no users exist
if (setupRequired && pathname !== '/setup') {
  return <Navigate to="/setup" />;
}

// Auth guard: redirect to /login if not authenticated
if (!user && !publicRoutes.includes(pathname)) {
  return <Navigate to="/login" />;
}

// Role guard: check permissions for admin routes
if (adminRoutes.includes(pathname) && !hasPermission('admin')) {
  return <Navigate to="/" />;
}
```

---

## State Management

### Authentication State

```tsx
// useAuth hook provides:
const {
  user,           // Current user object or null
  loading,        // Auth state loading
  login,          // Login function
  logout,         // Logout function
  hasPermission,  // Permission check
} = useAuth();
```

### Filter State

```tsx
// FilterProvider context
const {
  dateRange,      // { from: Date, to: Date }
  instanceId,     // Selected instance or 'all'
  workflowId,     // Selected workflow or 'all'
  status,         // Filter by status
  setFilters,     // Update filters
  clearFilters,   // Reset to defaults
} = useFilters();
```

### Data Fetching

Data is fetched using custom hooks that wrap the fetch API:

```tsx
// Example: useExecutions hook
const { data, loading, error, refetch } = useExecutions({
  instanceId,
  workflowId,
  dateRange,
  status,
});
```

---

## API Communication

### Base Configuration

All API requests go through `/api/*` which nginx proxies to the backend.

```typescript
// src/data/api.ts
const API_BASE = '/api';

export async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    credentials: 'include',  // Include cookies
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.json());
  }

  return response.json();
}
```

### Authentication

JWT tokens are stored in HttpOnly cookies (set by backend). The frontend doesn't handle tokens directly.

```typescript
// Login
await fetchApi('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
// Cookie is set automatically by backend

// Logout
await fetchApi('/auth/logout', { method: 'POST' });
// Cookie is cleared
```

---

## Styling & Theming

### Tailwind CSS

Utility-first styling with custom theme:

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: { /* custom palette */ },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
      },
    },
  },
};
```

### Dark Theme

The dashboard uses a dark theme by default, optimized for analytics display.

```css
/* index.css */
:root {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... */
}
```

### shadcn/ui Components

Pre-built accessible components in `src/components/ui/`:

- Button, Input, Select, Dialog
- Card, Table, Badge
- Toast notifications
- Calendar, DatePicker

---

## Building & Running

### Local Development

```bash
cd frontend
npm install
npm run dev
# Opens http://localhost:3000
```

Vite dev server proxies `/api/*` to `http://localhost:8001` (backend).

### Production Build

```bash
# Build static files
npm run build
# Output in dist/

# Preview production build
npm run preview
```

### Docker Build

```bash
# Build frontend image
docker build -t n8n_pulse_frontend:local ./frontend

# Build without cache (clean build)
docker build --no-cache -t n8n_pulse_frontend:local ./frontend

# Build with version tag
docker build -t mohammedaljer/n8n_pulse_frontend:v1.3.1 ./frontend
```

### Docker Compose

```bash
# Development (with build)
docker compose up -d --build

# Rebuild frontend only (no cache)
docker compose build --no-cache frontend
docker compose up -d frontend

# Production
docker compose -f docker-compose.prod.yml up -d --build
```

---

## nginx Configuration

The production frontend runs in nginx:

```nginx
# nginx.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # Static files
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy to backend
    location /api/ {
        proxy_pass http://backend:8001/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check proxy
    location /health {
        proxy_pass http://backend:8001/health;
    }
}
```

### Key Points

- SPA routing: All routes fall back to `index.html`
- API proxy: `/api/*` → backend container
- Health: `/health` proxied for external health checks
- Headers: X-Real-IP, X-Forwarded-* for proper client IP detection

---

## Environment Variables

### Build-time (Vite)

| Variable | Description |
|----------|-------------|
| `VITE_*` | Available in frontend code via `import.meta.env.VITE_*` |

### Runtime

No runtime environment variables needed. The frontend uses relative URLs for the API (`/api/*`), which nginx proxies to the backend.

---

## Type Definitions

```typescript
// src/types/index.ts

export interface User {
  id: string;
  email: string;
  permissions: string[];
}

export interface Execution {
  execution_id: string;
  workflow_id: string;
  instance_id: string;
  status: 'success' | 'error' | 'running' | 'waiting';
  started_at: string;
  stopped_at: string;
  duration_ms: number;
}

export interface Workflow {
  workflow_id: string;
  name: string;
  instance_id: string;
  active: boolean;
  tags: string[];
}

export interface MetricsSnapshot {
  instance_id: string;
  snapshot_time: string;
  cpu_usage_percent: number;
  memory_used_mb: number;
  event_loop_latency_ms: number;
}
```
