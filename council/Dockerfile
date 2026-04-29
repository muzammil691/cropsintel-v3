FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y git curl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV COUNCIL_MODE=cron

CMD ["node", "dist/index.js"]
