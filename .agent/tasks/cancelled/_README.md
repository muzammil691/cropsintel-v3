# Cancelled tasks

These tasks were marked done by the dev-time agent but verification revealed they shipped only stubs. Real implementations are queued under their original names with `-real` suffix and run AFTER production-house agents are built.

## What lives here

- `phase-1.3-auth.md` — original auth task. Will be re-implemented as `phase-1.30-auth-real.md` after the production-house agents (Verifier, Memory, Council, Adela) are live.
- `phase-1.04-rbac.md` — RBAC task. The SQL functions landed in the foundation migration (`supabase/migrations/20260428000001_v3_foundation.sql`), so this is *partially* done; full RBAC + admin VerifiedReviewQueue page will land as `phase-1.40-rbac-real.md`.
- `phase-1.05-public-landing.md` — public landing task. Will be re-implemented as `phase-1.50-landing-real.md`.

## Why cancelled, not deleted

History matters. We preserve these specs so future agents can read what was originally intended, what was actually shipped, and how the deeper-clean-slate restart happened.

## Build order after this restart

1. `phase-1.00b-verification-agent.md` — Verifier (production-house auditor)
2. `phase-1.00c-memory-agent.md` — Memory ingestion
3. `phase-1.00d-council.md` — Council (multi-brain)
4. `phase-1.00e-adela-skeleton.md` — Adela scrapers

Once those four ship, Council writes the real `-real` task specs for auth, RBAC, and landing using its auto-task-writer mode.
