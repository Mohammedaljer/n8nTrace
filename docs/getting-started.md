<!-- TOC -->

- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Quick Start (Docker)](#quick-start-docker)
  - [First Run Setup](#first-run-setup)
  - [Local Development](#local-development-without-docker)
  - [Verify Installation](#verify-installation)
  - [Next Steps](#next-steps)

<!-- /TOC -->

# Getting Started

Get n8n Pulse running locally in minutes.

## Prerequisites

- Docker & Docker Compose v2+
- Git

## Quick Start (Docker)

```bash
# Clone repository
git clone https://github.com/Mohammedaljer/n8nPulse.git
cd n8nPulse

# Start all services (dev mode)
docker compose up -d --build

# Open dashboard
open http://localhost:8899
```

## First Run Setup

On first run, create the initial admin:

1. Navigate to `http://localhost:8899/setup`
2. Enter email and password (min 8 characters)
3. Click "Create Admin"
4. Login with your credentials

> **Note**: `/setup` is only accessible when zero users exist.

## Local Development (without Docker)

### Backend

```bash
cd backend
npm install

export DATABASE_URL="postgres://user:pass@localhost:5432/n8n_pulse"
export JWT_SECRET="dev-secret-at-least-32-characters-long"
export APP_ENV="development"

npm run dev
# Backend: http://localhost:8001
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Frontend: http://localhost:5173
```

## Verify Installation

```bash
# Health check
curl http://localhost:8899/health
# {"ok":true,"db":"connected"}

# Setup status
curl http://localhost:8899/api/setup/status
# {"setupRequired":true}  (before first admin)
```

## Next Steps

- [Configure for production](./deployment.md)
- [Environment variables](./configuration.md)
- [Roles and permissions](./rbac.md)
- [Troubleshooting](./troubleshooting.md)
