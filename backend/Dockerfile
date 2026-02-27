# Stage 1: deps (install prod dependencies only)
FROM node:22.14.0-alpine AS deps
WORKDIR /app
RUN npm install -g npm@11.11.0

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund


# Stage 2: runtime (no .env or secrets copied)
FROM node:22.14.0-alpine AS runtime

# Healthcheck needs curl
#RUN apk add --no-cache curl

WORKDIR /app
RUN npm install -g npm@11.11.0

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy app files (ensure ownership for non-root user)
COPY --chown=node:node package*.json ./
COPY --chown=node:node index.js ./
COPY --chown=node:node src ./src 
COPY --chown=node:node migrations ./migrations

# Do NOT copy .env, .env.*, or any secret files

# Run as non-root (node user exists in node:alpine images)
USER node

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 \
  CMD node -e "fetch('http://localhost:8001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
