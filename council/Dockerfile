FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ALL deps (incl. TypeScript) so we can compile
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:22-bookworm-slim AS runtime

# git + openssh-client for entrypoint clone-on-startup
RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssh-client curl ca-certificates bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Production-only deps in runtime stage
COPY package*.json ./
RUN npm ci --omit=dev

# Built code
COPY --from=builder /app/dist ./dist

# Entrypoint that clones the repo before running council
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
ENV COUNCIL_MODE=server
ENV PORT=8080

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["server"]
