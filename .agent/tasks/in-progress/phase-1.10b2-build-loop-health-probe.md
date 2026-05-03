---
priority: 1
model: claude-opus-4-7
primary-domain: analytical
---

# Task: Phase 1.10b2 — Build-Loop Health Probe

**Master plan reference:** §9.2 (Atlas R3) — observability for the autonomous build pipeline.
**Estimated effort:** ~15 min (single new HTTP route, no migrations, no UI).
**Model:** claude-opus-4-7

## Goal

Add a single new HTTP route `GET /atlas/health/build-loop` to `atlas/src/server.ts`
that returns the last 3 rows from `atlas_build_attempts` as JSON. This is a
read-only diagnostic endpoint — it lets operators (and outside health-check tools)
see the most recent build pipeline activity without having to query Supabase
directly or open the Audit tab.

This task is intentionally tiny. It is the first end-to-end test of the
agent-loop stabilization fixes shipped this week (zombie triage, Gemini
fallback chain, null-verdict-as-block, audit-feed dedup). Builder should
need only one file edit and no new dependencies.

## Files

- `atlas/src/server.ts` — add ONE new route block alongside the existing
  `/atlas/verifier/runs` and `/atlas/designer/runs` GET handlers. Pattern-match
  their structure exactly: same auth, same JSON shape, same error handling.
  No other files should be touched.

## Architecture

The new route:

```
GET /atlas/health/build-loop
  Auth: requireAuth (Bearer session token, same as siblings)
  Query: ?limit=N (optional, default 3, max 10)
  Body: none (GET)
  Response: 200 JSON
    {
      "attempts": [
        {
          "id": string,
          "task_id": string,
          "spec_filename": string,
          "primary_domain": "frontend"|"analytical"|"research"|"mixed",
          "status": "planned"|"queued"|"shipped"|"verified"|"failed"|"escalated",
          "attempt_number": number,
          "planned_at": string (ISO 8601),
          "shipped_at": string | null,
          "verified_at": string | null,
          "completed_at": string | null
        }
      ],
      "ts": string (ISO 8601 — server time when the response was built)
    }
```

Implementation pattern:
- Read `limit` from URL query string (URLSearchParams), clamp to [1, 10], default 3.
- Query Supabase: `from('atlas_build_attempts').select(...).order('planned_at', { ascending: false }).limit(limit)`.
- Return `{ attempts, ts: new Date().toISOString() }`.
- Error path: same as siblings — `json(res, 500, { error: error.message })`.

## Success criteria

1. The route `/atlas/health/build-loop` is registered in `atlas/src/server.ts`.
2. With a valid Bearer token, the route returns HTTP 200 with a JSON body.
3. The body contains an `attempts` array of length ≤ 3 by default.
4. Each entry has all 10 fields listed in the response shape above.
5. The `?limit=` query param is honored, clamped to [1, 10].
6. Without a Bearer token, the route returns 401 (matches `requireAuth` siblings).
7. `npm run build` and `npx tsc --noEmit` (in `atlas/`) both pass clean — no new TS errors.
8. The implementation is a SINGLE additional route block in `atlas/src/server.ts`. No new files. No new dependencies. No migrations.

## Risks + mitigations

- **Risk:** Builder modifies more than `atlas/src/server.ts` and creates scope creep.
  **Mitigation:** Spec NEVER list below blocks new files / migrations / UI changes.
- **Risk:** Endpoint accidentally leaks sensitive data (cost, gaps).
  **Mitigation:** Response shape is fixed in this spec. Only the 10 listed fields.
  No `cost_usd`, no `failure_gaps`, no `multi_brain_run_id`.
- **Risk:** Builder forgets `requireAuth` and exposes the route publicly.
  **Mitigation:** Spec explicitly says "same auth as siblings"; auditor checks
  `requireAuth` is present.
- **Risk:** Builder writes own helper instead of pattern-matching the existing
  sibling routes, leading to inconsistency.
  **Mitigation:** Spec is explicit: "Pattern-match their structure exactly."

## NEVER list

- Do NOT add new files. The change MUST be confined to `atlas/src/server.ts`.
- Do NOT add new dependencies to `atlas/package.json`.
- Do NOT add a Supabase migration. The `atlas_build_attempts` table already
  exists (shipped 4310681).
- Do NOT add UI components. This is a backend probe only.
- Do NOT include `cost_usd`, `failure_gaps`, `multi_brain_run_id`, `prior_warnings`,
  or `spec_sha` in the response.
- Do NOT add a write/POST/PATCH endpoint. Read-only.
- Do NOT change the auth pattern — `requireAuth` only, no public access.
- Do NOT modify `verifier/src/`, `memory/src/`, `designer/src/`, `council/src/`,
  `src/components/`, or any migration file.
