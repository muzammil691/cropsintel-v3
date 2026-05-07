# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S adela && \
    adduser -S adela -u 1001 -G adela

ENV NODE_ENV=production

# Copy dependencies and build artifacts
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Change ownership to non-root user
RUN chown -R adela:adela /app

# Switch to non-root user
USER adela

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# No EXPOSE — Adela is a cron worker, not a server
ENTRYPOINT ["node", "dist/scheduler.js"]
