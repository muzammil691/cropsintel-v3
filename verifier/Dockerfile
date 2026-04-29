FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src/ ./src/
RUN npm ci && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

# Install git + openssh-client so entrypoint can clone the repo at startup
RUN apk add --no-cache git openssh-client bash

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production

# entrypoint.sh clones the repo (using AGENT_SSH_PRIVATE_KEY env var) into
# /workspace/cropsintel-v3, sets REPO_ROOT, then execs the verifier with
# whatever command was passed. Default = audit-all (one-shot).
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["audit-all"]
