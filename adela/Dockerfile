FROM node:20-slim

# System deps: curl + ca-certificates for HTTPS fetches; tini for signal handling
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc && \
    mkdir -p dist/scrapers && \
    cp src/scrapers/selectors.json dist/scrapers/selectors.json && \
    npm prune --omit=dev

# Drop privileges — the node:20-slim image ships with a built-in `node` user
# (uid/gid 1000). Running as non-root is required by the security baseline.
RUN chown -R node:node /app
USER node

# Railway sets $PORT; expose for documentation
EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
