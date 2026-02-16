# n8n Pulse Backend

Express.js REST API for n8n Pulse.

## Documentation

Full documentation: [`/docs/backend.md`](../docs/backend.md)

- [Database Schema](../docs/backend.md#database-schema)
- [Migrations](../docs/backend.md#migrations)
- [API Endpoints](../docs/backend.md#api-endpoints)
- [n8n Data Ingestion](../docs/backend.md#n8n-data-ingestion)
- [Configuration](../docs/configuration.md)

## Quick Commands

```bash
# Install dependencies
npm install

# Development (hot reload)
npm run dev

# Production
npm start

# Run migrations
npm run migrate up

# Rollback migration
npm run migrate down
```

## Docker Build

```bash
# Build image
docker build -t n8n_pulse_backend:local .

# Build without cache
docker build --no-cache -t n8n_pulse_backend:local .
```

## Health Check

```bash
curl http://localhost:8001/health
```
