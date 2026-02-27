# Stage 1: deps (install prod dependencies only)
FROM node:22.14.0-alpine AS deps
WORKDIR /app

ENV npm_config_cache=/tmp/.npm

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --no-audit --no-fund \
  && rm -rf /tmp/.npm


# Stage 2: runtime (no .env or secrets copied)
FROM node:22.14.0-alpine AS runtime
WORKDIR /app

RUN apk update && apk upgrade --no-cache

COPY --from=deps /app/node_modules ./node_modules

COPY --chown=node:node index.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node package.json ./

USER node

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 \
  CMD node -e "fetch('http://localhost:8001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
