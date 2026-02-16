# n8n Pulse - Frontend Dockerfile
# Builds and serves the React frontend with nginx.
# API requests are proxied to the backend container via nginx.

# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# CRITICAL: Force empty API base URL so all API calls use relative paths.
# This ensures /api/* requests go to the same origin (nginx) which proxies
# them to the backend container. Never bake in localhost or any absolute URL.
ENV VITE_DATA_MODE=api
ENV VITE_API_BASE_URL=

RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine AS production

RUN apk add --no-cache curl

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
