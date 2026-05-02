FROM node:20-alpine

# tini for signal handling, ca-certificates for HTTPS fetches
RUN apk add --no-cache ca-certificates tini bash

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

# Railway sets $PORT; expose for documentation
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
