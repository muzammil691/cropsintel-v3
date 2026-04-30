FROM node:22-alpine AS builder

WORKDIR /app

# Install ALL deps (incl. TypeScript) so we can compile
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runtime

# Install git + openssh-client + bash for entrypoint clone-on-startup
RUN apk add --no-cache git openssh-client bash

WORKDIR /app

# Production deps only (dev deps not needed at runtime)
COPY package*.json ./
RUN npm ci --omit=dev

# Built code
COPY --from=builder /app/dist ./dist

# Entrypoint that clones the repo before running atlas (so it can reach .agent/tasks/*, master plan, workflow doc)
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["server"]
