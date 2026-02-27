# n8n Pulse - Frontend Dockerfile
# Builds and serves the React frontend with nginx.
# API requests are proxied to the backend container via nginx.

# Stage 1: Build
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV VITE_DATA_MODE=api
ENV VITE_API_BASE_URL=
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine AS production
RUN apk update && apk upgrade --no-cache
# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# No curl: just check port is open
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD nc -z 127.0.0.1 80 || exit 1

CMD ["nginx", "-g", "daemon off;"]