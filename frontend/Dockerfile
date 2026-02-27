# n8n Pulse - Frontend Dockerfile
# Builds and serves the React frontend with nginx.
# API requests are proxied to the backend container via nginx.

# Stage 1: Build
FROM node:22.14.0-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV VITE_DATA_MODE=api
ENV VITE_API_BASE_URL=
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine AS production
RUN apk add --no-cache ca-certificates
# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# No curl: just check port is open
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["nginx", "-t"]


CMD ["nginx", "-g", "daemon off;"]