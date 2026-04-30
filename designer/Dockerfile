FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src/ ./src/
RUN npm install && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

# Install git + openssh-client so entrypoint can clone the repo at startup
RUN apk add --no-cache git openssh-client bash

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["server"]
