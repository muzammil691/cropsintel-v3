FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src/ ./src/
RUN npm ci && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
# Default repo root — override in Railway to /workspace/cropsintel-v3
ENV REPO_ROOT=/workspace/cropsintel-v3

CMD ["node", "dist/index.js", "gate"]
