# n8n-trace — Frontend

React SPA that provides the dashboard, analytics views, RBAC-aware widgets, and admin interface for n8n-trace.

> [!NOTE]
> The frontend is not deployed independently. Vite builds the SPA into static files that are served by the backend inside the [unified Docker image](../docs/deployment.md).

## Tech Stack

React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui · Recharts · Vitest

## Documentation

Full reference: [`/docs/frontend.md`](../docs/frontend.md)

## Local Development

```bash
# Install dependencies
npm install

# Start dev server (with HMR)
npm run dev

# Production build
npm run build

# Preview production build locally
npm run preview

# Lint
npm run lint

# Run tests
npm test

# Tests in watch mode
npm run test:watch
```

## Project Structure

```
src/
├── admin/          # Admin pages and components
├── components/     # Shared UI components and dashboard widgets
├── data/           # Static data and constants
├── hooks/          # Custom React hooks (auth, metrics, theming)
├── lib/            # Utility functions
├── pages/          # Route-level page components
├── security/       # Auth context and route guards
├── test/           # Test setup and helpers
└── types/          # TypeScript type definitions
```
