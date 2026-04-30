# Task: Phase 1.10a — Atlas service scaffold

**Master plan reference:** §1.6 named layer Atlas; §11.3 Phase 2 brought forward; full master spec at `.agent/specs/atlas-master-spec.md`
**Context:** First of ~12 tasks that build the Atlas conductor agent. This one creates the empty Railway service shell — package.json, Dockerfile, entrypoint, basic HTTP server with /health. Subsequent tasks (1.10b through 1.10l) build the actual brain on top of this scaffold.
**Estimated effort:** ~30 min
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Create a new top-level `atlas/` directory at the repo root, mirroring the structure used by `verifier/`, `memory/`, `council/`. This task ships ONLY the scaffold — no business logic, no multi-brain, no chat. Just a Railway-deployable Node service that boots, clones the repo, and serves `GET /health` on port 8080.

## Required directory layout

```
atlas/
├── Dockerfile              # Multi-stage build (mirror memory/Dockerfile pattern)
├── entrypoint.sh           # Clone repo on startup (mirror memory/entrypoint.sh)
├── package.json
├── package-lock.json
├── tsconfig.json
├── src/
│   ├── index.ts            # CLI entrypoint with `server` subcommand
│   ├── server.ts           # HTTP server with /health
│   ├── lib/
│   │   ├── env.ts          # Env var loader + validator
│   │   └── supabase.ts     # Multi-name fallback (V3_SUPABASE_URL, SUPABASE_URL, etc.)
│   └── types.ts            # Shared TypeScript types
└── .gitignore              # node_modules, dist
```

## Files to create

### atlas/package.json

```json
{
  "name": "cropsintel-atlas",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js server",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "commander": "^12.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "typescript": "^5.6.2"
  }
}
```

(Run `npm install` to generate package-lock.json before committing.)

### atlas/tsconfig.json

Mirror `memory/tsconfig.json` exactly.

### atlas/Dockerfile

Mirror `memory/Dockerfile` exactly (multi-stage Node 22 alpine, full deps in builder, --omit=dev in runtime, entrypoint.sh wrapper).

### atlas/entrypoint.sh

Mirror `memory/entrypoint.sh` exactly, but with `[atlas-entrypoint]` log tag instead of `[memory-entrypoint]`.

### atlas/src/index.ts

```ts
import { Command } from 'commander'

const program = new Command()
program.name('atlas').description('CropsIntel V3 Atlas — production-house conductor').version('0.1.0')

program
  .command('server')
  .description('Start the Atlas HTTP server')
  .action(() => {
    const { startServer } = require('./server')
    startServer()
  })

program.parse(process.argv)
```

### atlas/src/server.ts

```ts
import { createServer, IncomingMessage, ServerResponse } from 'http'

const PORT = parseInt(process.env.PORT ?? '8080', 10)
const ATLAS_API_TOKEN = process.env.ATLAS_API_TOKEN

function authenticate(req: IncomingMessage): boolean {
  if (!ATLAS_API_TOKEN) return true
  const auth = req.headers['authorization'] ?? ''
  return auth === `Bearer ${ATLAS_API_TOKEN}`
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

export function startServer(): void {
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    if (url === '/health' && method === 'GET') {
      json(res, 200, {
        status: 'ok',
        service: 'cropsintel-atlas',
        version: '0.1.0',
        trust_mode: process.env.ATLAS_TRUST_MODE ?? 'passive',
        ts: new Date().toISOString(),
      })
      return
    }

    if (!authenticate(req)) {
      json(res, 401, { error: 'Unauthorized' })
      return
    }

    json(res, 404, { error: 'Not found — endpoint will be added in subsequent tasks' })
  })

  server.listen(PORT, () => {
    console.log(`[atlas-server] Listening on :${PORT}`)
  })
}
```

### atlas/src/lib/env.ts

Validates required env vars at startup, throws with a clear message if any are missing.

```ts
const REQUIRED_ON_STARTUP = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']
const REQUIRED_FOR_PERSISTENCE = ['V3_SUPABASE_URL', 'V3_SUPABASE_SECRET_KEY']

export function validateEnv(): void {
  const missing: string[] = []
  for (const v of REQUIRED_ON_STARTUP) {
    if (!process.env[v]) missing.push(v)
  }
  if (missing.length > 0) {
    console.warn(`[atlas-env] WARN: missing env vars (Atlas will boot but degraded): ${missing.join(', ')}`)
  }

  const hasUrl = process.env.V3_SUPABASE_URL || process.env.SUPABASE_URL
  const hasKey = process.env.V3_SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!hasUrl || !hasKey) {
    console.warn('[atlas-env] WARN: no Supabase credentials — persistence disabled')
  }
}
```

Call `validateEnv()` at the top of `startServer()`.

### atlas/src/lib/supabase.ts

Copy `verifier/src/lib/supabase.ts` verbatim — same multi-name fallback logic.

### atlas/src/types.ts

```ts
export type TrustMode = 'passive' | 'chat' | 'confirm' | 'auto' | 'stopped'

export interface Snapshot {
  takenAt: string
  currentPhase: string | null
  queuedSpecs: number
  inFlightSpecs: number
  doneSpecs24h: number
  failedSpecs24h: number
}
```

### atlas/.gitignore

```
node_modules/
dist/
*.log
.env
.env.local
```

## Verification (acceptance criteria)

After this task ships:

1. `atlas/` directory exists at repo root with all files above.
2. `atlas/package.json`, `atlas/Dockerfile`, `atlas/entrypoint.sh` are present and identical in structure to `memory/`.
3. `cd atlas && npm install && npm run build` produces `atlas/dist/index.js` and `atlas/dist/server.js` without TypeScript errors.
4. `node atlas/dist/index.js server` starts and listens on :8080.
5. `curl http://localhost:8080/health` returns 200 with `{"status":"ok","service":"cropsintel-atlas",...}`.
6. No business logic in this task — `/atlas/chat`, `/atlas/dispatch`, etc. all return 404. They land in subsequent tasks (1.10c onward).

## Out of scope for this task (handled by 1.10b-1.10l)

- Multi-brain orchestrator → 1.10c
- Schema migrations → 1.10b
- Chat API → 1.10e
- WhatsApp webhook → 1.10f
- Tool registry → 1.10d
- Cost gatekeeper → 1.10g
- Invariants engine → 1.10h
- Snapshot cron → 1.10i
- Trust mode runtime flag → 1.10j
- Dashboard frontend → 1.10k
- PWA polish → 1.10l

## Notes

- Use Node 22-alpine to mirror Memory. Council uses bookworm-slim because of git/openssh; Atlas needs git too (entrypoint clones repo), but openssh-client is enough — alpine works.
- Don't add the Railway service definition to any infra-as-code in this task — Muzammil creates the Railway service manually following the Memory/Verifier pattern after this scaffold lands.
- Don't add Twilio, OpenAI, Anthropic, Gemini SDKs to package.json yet — they're added by the tasks that need them (1.10c for the brain providers, 1.10f for Twilio).
