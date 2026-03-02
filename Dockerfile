# =============================================================================
# n8n Pulse — Unified Docker Image
# Builds the React frontend and serves it from the Express backend.
# Single container, single port, no NGINX required.
# =============================================================================

# Stage 1: Build frontend
FROM node:22.14.0-alpine AS frontend-builder
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ .
ENV VITE_DATA_MODE=api
ENV VITE_API_BASE_URL=
RUN npm run build

# Stage 2: Install backend production dependencies
FROM node:22.14.0-alpine AS backend-deps
WORKDIR /app

ENV npm_config_cache=/tmp/.npm
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && rm -rf /tmp/.npm

# Stage 3: Production (distroless — no shell, minimal attack surface)
FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app

# Backend dependencies + code
COPY --from=backend-deps /app/node_modules ./node_modules
COPY backend/index.js ./
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY backend/package.json ./

# Frontend build output → served by Express as static files
COPY --from=frontend-builder /app/dist ./public

# Explicitly run as non-root (distroless :nonroot defaults to 65534,
# but being explicit satisfies security scanners and documents intent)
USER 65534

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["index.js"]
