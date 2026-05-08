---
phase: 1.10ah
title: Adela /health endpoint connectivity fix
status: planned
gate: in-progress count <= 2 AND phases 1.10ae, 1.10af, 1.10ag shipped
order: 4-of-4
estimated_builder_minutes: 45
estimated_cost_usd: 1
master_plan_section: 11.7
---

# Phase 1.10ah — Adela `/health` endpoint connectivity fix

## Why this exists

Adela's source code already has a working `/health` endpoint (`adela/src/index.ts` + `adela/src/health.ts`). The endpoint serves 200 JSON. **Yet the dashboard shows Adela as `unreachable` and `health probe failed`.** This is a deploy/networking issue, not a missing-endpoint issue.

This spec diagnoses the root cause and applies the right fix from a small set of likely causes.

## Foundation-first check

- ✅ `adela/src/health.ts` exists and registers all 4 cron scrapers.
- ✅ `adela/src/index.ts` starts an HTTP server on `process.env.PORT || 3001` and serves `/health` with status 200.
- ❓ Railway service `believable-warmth` may not be exposing port 3001 externally.
- ❓ Railway may be running an older build that lacks the health server.

## Diagnostic step (Builder runs FIRST)

Document findings in `docs/atlas-decisions/2026-MM-DD-adela-health-investigation.md`.

1. **Direct probe.** Run `curl -v https://believable-warmth-production.up.railway.app/health` from Builder's environment. Document: HTTP status, response body, error message.

2. **Inspect Railway service config.** Use `railway` CLI or Railway API (with `RAILWAY_API_TOKEN` from secrets) to query the service config for `believable-warmth`. Document:
   - Is there a `PORT` env var set?
   - Does the service have a public domain? On which port?
   - What's the latest deployment SHA, and does it match the head of `main` for `adela/`?

3. **Inspect Adela logs.** Last 100 lines from Railway. Look for `Health server listening on port`. Document: what port does it actually bind to?

4. **Check the dashboard probe.** Find where the dashboard checks Adela health (look in `atlas/src/lib/tools.ts` around line 71 where `ADELA_URL` is defined; trace where it's actually probed). Document the probe URL, timeout, and how the result is interpreted.

## Fix branches

### Branch A: Railway port mismatch

If diagnostic shows Adela binds to `3001` but Railway's public domain points to `8080` (or some other port):

- Add `PORT=8080` to Adela's Railway service env vars (or whatever port Railway expects).
- Verify by re-running `curl -v https://believable-warmth-production.up.railway.app/health` after redeploy.

### Branch B: Old deployment

If diagnostic shows latest deployed SHA is older than the SHA where `health.ts` was added:

- Trigger Railway redeploy.
- Wait 90 seconds.
- Verify with `curl`.

### Branch C: Dashboard probes wrong URL or expects different shape

If `curl` directly returns 200 but the dashboard still shows `unreachable`:

- Inspect the dashboard's probe code (likely in a tools file or a status snapshot generator).
- Confirm it's hitting `/health` not `/healthz` or `/status`.
- Confirm the parser accepts `{status: 'ok', ...}` not just `{ok: true}`.
- Adjust whichever side is wrong (prefer fixing the dashboard expectation if Adela's response is reasonable).

### Branch D: Health server doesn't start (port already in use, etc.)

If logs show `EADDRINUSE` or similar:

- Adela might be running two instances. Inspect Procfile / Railway start command.
- The scheduler-only mode and the health-server-with-scheduler mode may have been confused.
- Fix: ensure `adela/src/index.ts` is the entry point (which starts both), not `scheduler.ts` directly.

## Acceptance criteria

- `curl https://believable-warmth-production.up.railway.app/health` returns HTTP 200 with valid JSON.
- Dashboard's Agents tab shows Adela with a green dot, status `idle` (or `running` if cron just fired).
- Diagnostic doc exists in `docs/atlas-decisions/`.
- `npm run build` passes (no Adela code changes needed if it's a deploy/config issue).

## Out of scope

- Adding monitoring metrics beyond /health (separate spec if needed).
- Changing scrape schedule.
- Adela ai-analyst pipeline (covered in 1.6f).

## Dependencies

- 1.10ae, 1.10af, 1.10ag shipped (so we can trust the dashboard truth when verifying Adela goes green).
