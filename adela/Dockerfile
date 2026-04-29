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

# Run compiled output
CMD ["node", "dist/index.js"]
