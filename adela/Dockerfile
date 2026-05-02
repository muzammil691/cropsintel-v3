FROM node:20-alpine

# tini for signal handling, ca-certificates for HTTPS fetches, wget for HEALTHCHECK
RUN apk add --no-cache ca-certificates tini bash wget

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src

RUN npx tsc \
  && mkdir -p dist/scrapers \
  && cp src/scrapers/selectors.json dist/scrapers/selectors.json \
  && npm prune --omit=dev

# Drop privileges — node:20-alpine ships with a built-in `node` user
RUN chown -R node:node /app
USER node

# Railway sets $PORT; default to 8080 inside the container
ENV PORT=8080
EXPOSE 8080

# Container-level health check hitting the in-process /health server.
# Railway also probes /health via its platform healthcheck; this is a belt+braces
# liveness signal so a stuck event-loop trips a restart.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
