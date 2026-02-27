# Stage 1: deps (install prod dependencies only)
FROM node:22.14.0-alpine AS deps
WORKDIR /app

ENV npm_config_cache=/tmp/.npm

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && rm -rf /tmp/.npm

# Stage 2: runtime (distroless + CA certs)
FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY index.js ./
COPY src ./src
COPY migrations ./migrations
COPY package.json ./

EXPOSE 8001

# Healthcheck using node fetch (works without shell/curl)
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["index.js"]