---
priority: 1
primary-domain: mixed
remediation: true
remediation-attempt: 3
---
```markdown
---
model: claude-sonnet-4-5
phase: 1.6b
component: adela
type: infrastructure
---

# Task: Phase 1.6b — Adela Docker + Railway Deployment Config

**Master plan reference:** CropsIntel V3 Master Plan §4.2 — Adela Scraper Worker Deployment (follows Phase 1.6a: Adela scheduler + scraper implementation)
**Estimated effort:** 2–4 hours (S)
**Model:** claude-sonnet-4-5

## Goal

Containerise the Adela cron-worker service and wire it for zero-downtime deployment on Railway. Adela is a **pure cron worker** (no HTTP server, no exposed ports). This phase produces four files that are the complete deployment surface for the service:

1. `adela/Dockerfile` — reproducible Node 20 Alpine image
2. `adela/package.json` — canonical dependency manifest with `build`, `start`, and `dev` scripts
3. `adela/tsconfig.json` — TypeScript compiler config targeting ES2022/CommonJS
4. `adela/railway.toml` — Railway deployment descriptor with restart policy

No application logic changes are in scope. Phase 1.6a source files (`src/scheduler.ts`, `src/scraper.ts`, etc.) are consumed as-is.

## Files

### `adela/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# No EXPOSE — Adela is a cron worker, not a server
ENTRYPOINT ["node", "dist/scheduler.js"]
```

### `adela/package.json`

```json
{
  "name": "cropsintel-adela",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/scheduler.js",
    "dev": "ts-node src/scheduler.ts"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "axios": "^1.6.0",
    "cheerio": "^1.0.0",
    "dotenv": "^16.3.0",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/node-cron": "^3.0.11",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.0"
  }
}
```

### `adela/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `adela/railway.toml`

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "adela/Dockerfile"

[deploy]
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

## Success criteria

These are the exact checks the Verifier must pass before the phase is considered complete.

| # | Check | Method |
|---|-------|--------|
| SC-1 | `adela/Dockerfile` exists and contains `FROM node:20-alpine` | `grep -q "FROM node:20-alpine" adela/Dockerfile` |
| SC-2 | Dockerfile has **no** `EXPOSE` instruction | `! grep -q "EXPOSE" adela/Dockerfile` |
| SC-3 | `ENTRYPOINT` is `["node", "dist/scheduler.js"]` | `grep -q 'ENTRYPOINT \["node", "dist/scheduler.js"\]' adela/Dockerfile` |
| SC-4 | `adela/package.json` `name` field equals `cropsintel-adela` | `node -e "const p=require('./adela/package.json');process.exit(p.name==='cropsintel-adela'?0:1)"` |
| SC-5 | All five runtime dependencies present in `package.json` | `node -e "const d=require('./adela/package.json').dependencies;['@supabase/supabase-js','axios','cheerio','dotenv','node-cron'].forEach(k=>{if(!d[k])process.exit(1)})"` |
| SC-6 | `adela/tsconfig.json` sets `target` to `ES2022` and `module` to `commonjs` | `node -e "const t=require('./adela/tsconfig.json').compilerOptions;process.exit(t.target==='ES2022'&&t.module==='commonjs'?0:1)"` |
| SC-7 | `adela/tsconfig.json` has `strict: true` | `node -e "const t=require('./adela/tsconfig.json').compilerOptions;process.exit(t.strict===true?0:1)"` |
| SC-8 | `adela/railway.toml` sets `builder = "DOCKERFILE"` | `grep -q 'builder = "DOCKERFILE"' adela/railway.toml` |
| SC-9 | `adela/railway.toml` sets `restartPolicyMaxRetries = 3` | `grep -q "restartPolicyMaxRetries = 3" adela/railway.toml` |
| SC-10 | `docker build -f adela/Dockerfile .` exits 0 (build succeeds) | CI Docker build step — must pass with no errors |
| SC-11 | No hardcoded secrets in any of the four files | `git grep -rn "SUPABASE_KEY\|API_KEY\|SECRET\|PASSWORD" adela/` returns empty |
| SC-12 | `bun` does not appear in any of the four files | `! grep -rq "bun" adela/` |
| SC-13 | `adela/package-lock.json` exists and is committed | `test -f adela/package-lock.json` |

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Phase 1.6a not fully shipped** — `src/scheduler.ts` or `src/scraper.ts` missing; `tsc` compile fails inside Docker build | Medium | High | Verify Phase 1.6a is merged and `npm run build` succeeds locally before opening this PR. Block this phase on 1.6a completion. |
| **`package-lock.json` absent** — `npm ci` requires a lockfile; omitting it causes build failure | Medium | High | Commit `package-lock.json` alongside `package.json`. SC-13 enforces this in CI. |
| **Railway env vars not set** — `dotenv` reads from `.env` locally but Railway must have `SUPABASE_URL`, `SUPABASE_ANON_KEY`, etc. set as Railway service variables | High | High | Document required env vars in `adela/README.md`. SC-11 enforces no hardcoded secrets. Railway deployment checklist must include var verification step before first deploy. |
| **Multi-stage build cache invalidation** — changing `src/` invalidates the builder stage but not the deps stage; accidental full rebuilds on dependency-only changes | Low | Low

## NEVER list

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- Never violate master plan §11.6 invariants.
- Never ship without verifying `npm run build` is clean.

## Prior failure — gaps to address (attempt 3)

The previous run of `phase-1.6b-adela-docker-railway-deployment-config` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: files-exist
- Severity: `fail`
- Expected: src/scheduler.ts exists
- Actual: src/scheduler.ts is missing
- Remediation: Create src/scheduler.ts per task spec

### Gap 2: files-exist
- Severity: `fail`
- Expected: src/scraper.ts exists
- Actual: src/scraper.ts is missing
- Remediation: Create src/scraper.ts per task spec

