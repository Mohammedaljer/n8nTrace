<!-- TOC -->

- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Quick Start (Docker)](#quick-start-docker)
  - [First Run Setup](#first-run-setup)
  - [Local Development (without Docker)](#local-development-without-docker)
    - [Backend](#backend)
    - [Frontend](#frontend)
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
# Clone the repository
git clone https://github.com/Mohammedaljer/n8nPulse.git
cd n8n_dash

# Start all services (dev mode)
docker compose up -d --build

# Open the dashboard
open http://localhost:8899
```

## First Run Setup

On first run, there are no users in the database. Create the initial admin:

1. Navigate to `http://localhost:8899/setup`
2. Enter an email and strong password (min 8 characters)
3. Click "Create Admin"
4. You'll be redirected to login

> **Note**: The `/setup` page is only accessible when the database has zero users.

## Local Development (without Docker)

### Backend

```bash
cd backend
npm install

# Set required environment variables
export DATABASE_URL="postgres://user:pass@localhost:5432/n8n_pulse"
export JWT_SECRET="dev-secret-at-least-32-characters-long"

npm run dev
# Backend runs on http://localhost:8001
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Frontend runs on http://localhost:5173
```

## Verify Installation

```bash
# Health check
curl http://localhost:8899/health
# Expected: {"ok":true,"db":"connected"}

# Setup status
curl http://localhost:8899/api/setup/status
# Expected: {"setupRequired":true} (before first admin)
```

## Next Steps

- [Configure for production](./deployment.md)
- [Set up environment variables](./configuration.md)
- [Understand roles and permissions](./rbac.md)
