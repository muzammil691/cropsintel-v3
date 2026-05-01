FROM node:22-bookworm-slim

# System deps: git + curl for potential fetch-fallback; ca-certificates for HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source and compile
COPY src/ ./src/
COPY tsconfig.json ./

# Install TypeScript devDeps just for the build step, then prune
RUN npm install --include=dev && \
    npx tsc && \
    npm prune --omit=dev

# Copy non-TS assets (selectors config) next to compiled scrapers so
# `path.resolve(__dirname, "./selectors.json")` resolves at runtime.
RUN mkdir -p dist/scrapers && \
    cp src/scrapers/selectors.json dist/scrapers/selectors.json

# Railway sets $PORT; expose for documentation
EXPOSE 8080

# Run compiled output
CMD ["node", "dist/index.js"]
