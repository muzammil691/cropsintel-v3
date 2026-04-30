# Task: Phase 1.6f — Adela orchestrator + Railway service config

**Master plan reference:** §11.2 row 1.6 ("Adela runtime: cron + 6 scrapers"); §1.6 named layer Adela.
**Context:** With 1.6a-e shipping schema + 4 new scrapers (USDA, Strata, news, ABC-hardening), Adela's `scheduler.ts` now needs to register all of them, expose a small HTTP control surface so Atlas can trigger ad-hoc runs (`POST /scrape`), and ensure the Railway service `believable-warmth` has all required environment variables.
**Estimated effort:** ~50 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

1. Extend `adela/src/scheduler.ts` to dynamically read scraper registration from `scraper_sources` table — only `enabled=true` scrapers run
2. Add HTTP control surface at `adela/src/server.ts` (port 8080):
   - `GET /health` — liveness, no auth
   - `GET /adela/status` — Bearer-auth, returns `scraper_sources` rows + last 10 `adela_runs`
   - `POST /adela/scrape` — Bearer-auth, body `{ scraper_key: string }`, triggers an ad-hoc run; matches Atlas's `adela.trigger_scrape` tool contract (`atlas/src/lib/tools.ts`)
3. Update `adela/Dockerfile` to expose port 8080 and run both the cron scheduler AND the HTTP server in a single process
4. Document required Railway env vars in `adela/README.md`

## Architecture

```
adela/
├── Dockerfile                     # extend: EXPOSE 8080
├── entrypoint.sh                  # extend: just node dist/index.js (it now runs both)
├── package.json
├── README.md                      # NEW — env var doc + deploy steps
├── src/
│   ├── index.ts                   # extend: also call startServer()
│   ├── server.ts                  # NEW — HTTP /health, /adela/status, /adela/scrape
│   ├── scheduler.ts               # rewrite registration to be data-driven
│   ├── scrapers/
│   │   ├── abc.ts (existing)
│   │   ├── usda.ts (1.6b)
│   │   ├── strata.ts (1.6c)
│   │   └── news.ts (1.6d)
│   └── ...
```

## Data-driven scheduler

Replace hardcoded `jobs[]` with bootstrap from `scraper_sources`:

```typescript
async function loadJobs(): Promise<Job[]> {
  const { data } = await supabase
    .from('scraper_sources')
    .select('scraper_key, cron_schedule, enabled')
    .eq('enabled', true)
  return (data ?? []).map((row) => ({
    name: row.scraper_key,
    schedule: row.cron_schedule,
    run: SCRAPER_REGISTRY[row.scraper_key],
  })).filter((j) => j.run)
}

const SCRAPER_REGISTRY: Record<string, () => Promise<void>> = {
  abc: runAbcScraper,
  usda: runUsdaScraper,
  strata: runStrataScraper,
  news: runNewsScraper,
}
```

Boot order: at startup, `loadJobs()` → register all → log registered jobs. Re-load every 30 min in case Atlas toggles `enabled` flags via DB.

## HTTP server

```typescript
// adela/src/server.ts
import http from 'http'

export function startServer() {
  const port = Number(process.env.PORT ?? 8080)
  http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }))
      return
    }
    // Bearer check for everything else
    const auth = req.headers.authorization
    if (auth !== `Bearer ${process.env.ADELA_API_TOKEN}`) {
      res.writeHead(401); res.end('unauthorized'); return
    }
    if (req.method === 'GET' && req.url === '/adela/status') { /* ... */ }
    if (req.method === 'POST' && req.url === '/adela/scrape') { /* ... */ }
    res.writeHead(404); res.end()
  }).listen(port, () => console.log(`[adela] HTTP on :${port}`))
}
```

## Railway env vars (document in README)

```
V3_SUPABASE_URL=https://hzrnohsxigrqlmzegwlb.supabase.co
V3_SUPABASE_SECRET_KEY=sb_secret_...
GEMINI_API_KEY=AIzaSy...
USDA_NASS_API_KEY=...                 # 1.6b
USDA_FAS_API_KEY=...                  # 1.6b
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+12345622692
TWILIO_WHATSAPP_TO=whatsapp:+971562556592
ADELA_API_TOKEN=cropsintel-adela-token-2026-05-01
PORT=8080
```

## Atlas wiring

Atlas's `tools.ts` already references `ADELA_URL` and the `adela.trigger_scrape` tool. After this spec ships, Muzammil must add `ADELA_URL=https://believable-warmth-production.up.railway.app` and `ADELA_API_TOKEN=cropsintel-adela-token-2026-05-01` to Atlas's Railway env vars (manual step — surface in handoff). The spec body should include this note in `README.md`.

## Files

- `adela/src/index.ts` (extend)
- `adela/src/server.ts` (NEW)
- `adela/src/scheduler.ts` (rewrite to data-driven)
- `adela/Dockerfile` (extend — EXPOSE 8080)
- `adela/README.md` (NEW)
- (No new migrations — uses tables from 1.6a)

## Success criteria

- `curl https://believable-warmth-production.up.railway.app/health` returns 200 (after Railway redeploys)
- `curl -H "Authorization: Bearer ..." .../adela/status` returns JSON with `scraper_sources` array
- Scheduler logs at boot list all enabled scrapers from DB (not hardcoded)
- `POST /adela/scrape -d '{"scraper_key":"abc"}'` returns 202 and triggers a run (visible in `adela_runs` within 60 s)
- TypeScript build passes; tests from 1.6e still pass
- Atlas's `adela.trigger_scrape` tool successfully dispatches when called from Atlas chat

## Risks + mitigations

- **Risk:** Race condition between cron + ad-hoc trigger of same scraper. **Mitigation:** simple in-memory mutex `Map<scraper_key, Promise>` — second invocation returns 409 if first still running.
- **Risk:** DB unreachable at boot — scheduler can't load jobs. **Mitigation:** boot retry every 30 s; log loudly; do NOT crash (HTTP server still serves /health for Railway healthcheck).
- **Risk:** Adding HTTP server to a previously cron-only process changes Railway expectation. **Mitigation:** Railway will detect EXPOSE 8080 and route to it; user just needs to "Generate Domain" once.

## NEVER list

- No client-side ADELA_API_TOKEN exposure (server-only secret).
- No removing the existing notify-WhatsApp behavior on startup — keep "🤖 Adela online" message.
