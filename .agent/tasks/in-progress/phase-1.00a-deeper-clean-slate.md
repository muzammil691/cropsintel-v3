# Task: Phase 1.00a — Deeper clean slate (wipe stubs, agents-first build order)

**Master plan reference:** anti-restart rule 2.1 (controlled restart when fresh start IS the path)
**User instruction 2026-04-29:** "start with clean slate to build all the agents first and then implement agents carefully to the job on clean slate"
**Critical context:** the prior shipped Phase 1.3, 1.04, 1.05 turned out to be stubs labeled as "done". Rather than remediate piecemeal, the user prefers a clean restart in this order: wipe stubs → build production-house agents (Verifier, Memory, Council, Adela) → THEN re-implement features properly with the production house in place.
**Estimated effort:** ~2 hours (deletion-only task)
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

Wipe the stubs that were incorrectly shipped as "done", clear the way for the agent-first build order. After this task, the codebase contains ONLY:
- Real Phase 1.0-1.2 work (scaffold + foundation schema + agent infra)
- Honest placeholders for not-yet-built pages (clearly marked "BUILD-PENDING")

Stubs that LIE about being implemented are deleted. Honest stubs that explicitly say "not implemented yet" are fine.

## In scope — DELETE these (because they're stubs masquerading as shipped features)

### Files to delete or reset to honest placeholders
- `src/pages/Auth.tsx` — currently 57 lines pretending to be auth. **Action:** replace contents with a 10-line `<NotImplemented phase="1.30-auth-real" />` placeholder
- `src/pages/Welcome.tsx` — currently 44 lines of hero. **Action:** keep the hero (it's a real welcome) but add a banner that says "V3 Phase 1 — agent infrastructure deploying. Full product after Phase 1.30+ ships."
- `src/pages/Dashboard.tsx` — keep as `<NotImplemented phase="1.50+" />` placeholder

### Done-folder cleanup
Move these task files from `.agent/tasks/done/` to `.agent/tasks/cancelled/` (create folder if missing) — preserves history, removes from "actually done" set:
- `phase-1.3-auth.md` (was a stub-shipping)
- `phase-1.04-rbac.md` (verify state — RBAC SQL functions are in foundation migration so this is partially done)
- `phase-1.05-public-landing.md` (was a stub-shipping)

Add a `cancelled/_README.md` explaining: "These tasks were marked done by the dev-time agent but verification revealed they shipped only stubs. Real implementations are queued under their original names with -real suffix and run AFTER production-house agents are built."

### New honest placeholder component
Create `src/components/NotImplemented.tsx`:

```tsx
import { Helmet } from "react-helmet-async"
import { Link } from "react-router-dom"

export default function NotImplemented({ phase, what }: { phase: string; what?: string }) {
  return (
    <>
      <Helmet><title>Coming soon — CropsIntel</title></Helmet>
      <main className="min-h-screen flex items-center justify-center px-6 py-12 text-center">
        <div className="max-w-md space-y-4">
          <h1 className="text-2xl font-semibold">Build pending</h1>
          <p className="text-muted-foreground">
            This page is scheduled for build in <code>{phase}</code>.
            {what && <> It will include: {what}</>}
          </p>
          <p className="text-xs text-muted-foreground border-t pt-3">
            CropsIntel V3 is built by an autonomous agent following the master plan.
            Production-house agents (Verifier, Memory, Council, Adela) ship first;
            this surface follows.
          </p>
          <Link to="/" className="text-sm underline">← Back to home</Link>
        </div>
      </main>
    </>
  )
}
```

This is honest. The site still loads cleanly, but every page that's NOT real says so explicitly.

### App.tsx updates
- Auth route → `<NotImplemented phase="1.30-auth-real" what="4 login methods (email+password, email OTP, WhatsApp+password, WhatsApp OTP) plus V1/V2 user migration bridge" />`
- Dashboard route → `<NotImplemented phase="1.50+ — after Adela lands data" />`
- Public surface routes (insights, news, about, pricing) → all `<NotImplemented phase="1.50-landing-real" />` placeholders

### Delete the legacy phase number naming
Rename queued task files to the new naming convention:
- `phase-1.06-adela-skeleton.md` → `phase-1.00e-adela-skeleton.md` (sorts after 1.00a/b/c/d as production-house build #5)
- `phase-1.06c-multibrain-architect.md` → `phase-1.00d-council.md`
- `phase-1.07b-v1-data-migration.md` → KEEP as is (skip stub, harmless)

So queue becomes (in alphabetical run order):
1. `phase-1.00a-deeper-clean-slate.md` ← THIS task, runs first
2. `phase-1.00b-verification-agent.md` ← Verifier (uses o3 + Gemini, NOT Claude)
3. `phase-1.00c-memory-agent.md` ← Memory (V1+V2+plan ingestion)
4. `phase-1.00d-council.md` ← Council (multi-brain quick + deep modes)
5. `phase-1.00e-adela-skeleton.md` ← Adela (Gemini scrapers)
6. `phase-1.07b-v1-data-migration.md` ← skip stub (no work)

After all 5 agent builds complete, write follow-up task specs:
- `phase-1.30-auth-real.md` (real auth with all 4 methods + Verifier-gated)
- `phase-1.40-rbac-real.md` (verify and complete RBAC; create the missing migration with explicit `has_role` `is_verified` `is_team` functions if not already present; build VerifiedReviewQueue admin page)
- `phase-1.50-landing-real.md` (real landing + 5 public pages)

These follow-up specs should be GENERATED by Council (multi-brain) using its auto-task-writer mode once Council is live. Don't write them manually now — let the production house do its job.

## In scope — KEEP these (foundation that survives clean slate)

- All scaffold (vite.config, tsconfig*, package.json, index.html, main.tsx, App.tsx structure)
- `src/components/RouteGuard.tsx` (foundational)
- `src/components/ui/*` (shadcn primitives — button, dialog, input)
- `src/contexts/AuthContext.tsx`, `src/hooks/useAuth.ts` (auth foundation)
- `src/lib/supabase.ts`, `src/lib/database.types.ts`, `src/lib/types.ts`, `src/lib/utils.ts`
- `supabase/migrations/20260428000001_v3_foundation.sql` (12 tables, RLS, seed data — Phase 1.2)
- `supabase/migrations/20260428000002_fix_user_roles_rls.sql`
- ALL `agent/` directory (the Builder)
- ALL `.agent/tasks/done/` history except the 3 stubs being cancelled
- ALL `.agent/tasks/queued/` (the new agent-first build queue)
- `.github/workflows/deploy.yml`
- `public/CNAME`, `public/404.html`
- `docs/MAXONS_Workflow_v1.md` and `docs/MAXONS_Workflow_v1.docx`

## Acceptance criteria

1. `src/pages/Auth.tsx`, `src/pages/Dashboard.tsx` use `<NotImplemented />` honestly
2. `src/components/NotImplemented.tsx` exists and renders cleanly
3. Welcome.tsx still renders but with a "build pending" banner
4. Cancelled tasks moved to `.agent/tasks/cancelled/` with explanatory README
5. Queued tasks renamed to `phase-1.00a/b/c/d/e` series
6. App.tsx routes updated to use NotImplemented for non-built surfaces
7. `npm run build` passes (clean placeholders compile)
8. Deployed site at https://muzammil691.github.io/cropsintel-v3/ shows: real Welcome + honest "build pending" pages elsewhere
9. ONE commit, message: `chore: deeper clean slate — wipe stubs, restructure for agents-first build order`
10. Push.

## Out of scope

- Don't actually BUILD any of the agents in this task — they get built by their own task specs (1.00b through 1.00e)
- Don't wipe the V3 Supabase data (foundation tables stay, RLS stays)
- Don't touch Railway env vars
- Don't delete agent infra

## Foundation check (BEFORE starting)

- Confirm `src/pages/Auth.tsx` is a stub (read first 5 lines — it should say "STUB for Phase 1.3")
- Confirm `src/pages/Welcome.tsx` is a thin hero (~44 lines)
- Confirm Phase 1.2 migrations are intact (don't touch them)

## Notes for the agent

- This is a SAFE deletion task. No external services touched. All changes are local repo + git.
- After this commits and pushes, the next tick picks `phase-1.00b-verification-agent.md` and starts the production-house build.
- The Verifier when it ships will run audit-all and find ZERO stubs (because we've replaced them with honest NotImplemented placeholders that the stub-detector regex EXCLUDES — see verifier spec, the regex looks for "shipped but lying" patterns, NotImplemented is "honestly not built yet" which is fine).
- This task is the prerequisite for the agents-first sequence the user requested.

---

**Done condition:** stubs wiped, NotImplemented placeholders in place, queue restructured for agents-first build, build green, single clean commit pushed.
