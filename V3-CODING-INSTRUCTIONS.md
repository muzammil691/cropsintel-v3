# V3 — Autonomous Coding Instructions

**Audience:** any coding agent (Cowork+Code, Lovable, Claude.ai, Codex, future hires) picking up V3 work.
**Authority:** the master plan at `~/Documents/Claude/Projects/Cropsintel/cropsintel-v3-master-plan.md` is the source of truth. This document is the tactical execution layer that translates the master plan into next-task queues.
**Read order:** master plan first → this document second → current task third.
**Updated:** 2026-04-28

---

## 0. The five rules every agent follows

These are non-negotiable. Violating them is grounds for the Scope Guardian (D2) to block your change.

1. **Foundation-first.** Every feature must satisfy the dependency graph in master plan section 4.1. Before adding `offers`, you must have `companies + contacts + canonical_products + relationships`. Don't skip.
2. **Anti-restart.** When something is broken, fix it in place. Do NOT create a parallel implementation next to it (V1's `/zyra` + `/zyra-ai` is the cautionary tale). If a fresh restart is genuinely the only path, update the master plan and DELETE the old version — never park.
3. **Multi-commodity from Day 1.** Every domain table has a `commodity_id` FK. Every query that scopes to almonds must scope through that FK. Adding pistachios later is configuration, not a rewrite.
4. **AI keys server-side only.** Zero `VITE_*` env vars for any AI provider. Every AI call routes through a Supabase edge function that holds the key in Supabase secrets. Reference: master plan section 10.4. The V2 mistake (`VITE_ANTHROPIC_API_KEY`) is the cautionary tale.
5. **Information walls are load-bearing.** Suppliers see pricing/demand; brokers see margin targets; customers see ONLY their own pricing. Never mix. RLS policies enforce this at the DB layer; agent code respects it at the app layer (V1's `zyraTradeParity.ts` pattern). Phase 3 ships a penetration test for this.

If you find yourself thinking "but for THIS feature it's OK to break rule X" — stop. Surface the conflict to the master plan owner (Muzammil), not silently to the codebase.

---

## 1. Current state (as of 2026-04-28)

### What's done
- ✅ V3 GitHub repo: `git@github.com:muzammil691/cropsintel-v3.git` (private)
- ✅ V3 Supabase project: `hzrnohsxigrqlmzegwlb` (Singapore region, Free tier)
- ✅ Vite 8 + React 19 + TypeScript 6 + Tailwind 4 + shadcn/ui (Radix + Nova preset) scaffolded and committed
- ✅ Path aliases configured (`@/*` → `./src/*`)
- ✅ Foundation migration drafted at `supabase/migrations/20260428000001_v3_foundation.sql` — 12 tables, RLS policies, helper functions, seed data (almonds + 9 varieties)
- ✅ Hand-written TypeScript types at `src/lib/database.types.ts` matching the migration
- ✅ Supabase client wired (`src/lib/supabase.ts`)
- ✅ Auth context + useAuth hook + RouteGuard component
- ✅ App router skeleton with 4 page stubs (Welcome, Auth, Dashboard, NotFound)
- ✅ GitHub Pages deploy workflow (`.github/workflows/deploy.yml`)
- ✅ `public/CNAME` → cropsintel.com (DNS cutover at end of Phase 1.15)
- ✅ README + this instructions doc

### What's NOT done (Phase 1 sub-tasks remaining)
- ⏳ **Apply migration to Supabase** (Muzammil-side: `npx supabase db push`)
- ⏳ **Add GitHub Actions secrets** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) so deploy workflow builds
- ⏳ Phase 1.3 — Auth (4 login methods + V1/V2 user migration bridge)
- ⏳ Phase 1.5 — Public market-insight pages
- ⏳ Phase 1.6 — Adela runtime on Railway (port V2's `runner.js`)
- ⏳ Phase 1.7 — Position reports ingestion + analytics layer (port V1's `positionReportAnalyticsLayer.ts`)
- ⏳ Phase 1.8 — Market Price Intelligence (Workflow 1 from MAXONS doc)
- ⏳ Phase 1.9 — Dashboard with widget set (~10 widgets, configuration-driven)
- ⏳ Phase 1.10 — Zyra customer chat (R1 agent, server-side via edge function, with 13 Zyra modules per v1.4)
- ⏳ Phase 1.11 — Hyper-personalized prescription engine v1
- ⏳ Phase 1.11b — Verified-user review queue UI for Maxons team
- ⏳ Phase 1.12 — i18n setup (EN + HI + ZH + AR + UR for launch)
- ⏳ Phase 1.13 — PWA setup (vite-plugin-pwa pinned to Vite 7 if needed; see master plan)
- ⏳ Phase 1.14 — Playwright e2e for critical flows
- ⏳ Phase 1.15 — DNS cutover

### Known parked items
- shadcn `form` component didn't install in 4.6 — try `npx shadcn@latest add form` again or use a different name. Phase 1.3 needs it.
- `vite-plugin-pwa` doesn't yet support Vite 8. Either wait for compat release or pin Vite to ^7 when adding PWA. Not blocking until Phase 1.13.

---

## 2. The first 5 tasks any agent should pick up

In strict order. Do not start task N before task N-1 is shipped.

### Task 1 — Apply foundation migration to Supabase

**Hands-on-keyboard for Muzammil** (only he has Supabase login + DB password):

```bash
cd ~/Documents/Claude/Projects/cropsintel-v3
npx supabase login
npx supabase link --project-ref hzrnohsxigrqlmzegwlb
npx supabase db push
```

Expected output: "Connecting to remote database..." → list of objects created → "Finished supabase db push."

**Verification:** open https://supabase.com/dashboard/project/hzrnohsxigrqlmzegwlb/editor — you should see 12 tables (commodities, companies, contacts, canonical_products, profiles, relationships, market_intelligence, zyra_conversations, agent_audit_log, agent_rate_limits, scope_violations, user_roles).

**Done condition:** all 12 tables exist in Supabase + 1 commodities row + 9 canonical_products rows visible.

### Task 2 — Configure GitHub Actions secrets so deploy workflow can build

**Hands-on-keyboard for Muzammil:**

1. Go to https://github.com/muzammil691/cropsintel-v3/settings/secrets/actions
2. Click **New repository secret** twice:
   - Name: `VITE_SUPABASE_URL` / Value: `https://hzrnohsxigrqlmzegwlb.supabase.co`
   - Name: `VITE_SUPABASE_ANON_KEY` / Value: `sb_publishable_6Okgwer13OJzhOf1PtGafA_zMf6oujt`

**Verification:** push any small commit (e.g., a typo fix). Watch the Actions tab — the deploy workflow should build green.

**Done condition:** Actions workflow runs successfully, deploys to GitHub Pages preview URL.

### Task 3 — Generate fresh `database.types.ts` from live schema

After Task 1 ships:

```bash
cd ~/Documents/Claude/Projects/cropsintel-v3
npx supabase gen types typescript \
  --project-id hzrnohsxigrqlmzegwlb \
  > src/lib/database.types.ts
git add src/lib/database.types.ts
git commit -m "chore: regenerate database.types.ts from live schema"
git push
```

This replaces the hand-written types with the auto-generated ones. They'll be richer (include views, functions, enums) and stay in sync with the schema.

**Done condition:** `database.types.ts` has the auto-generated banner at the top + types compile (no `npm run build` errors).

### Task 4 — Verify dev server runs

```bash
npm run dev
```

Open `http://localhost:5173`. Expected: Welcome page with "CropsIntel" heading, "Sign in" + "Create account" buttons.

**Common issues:**
- `Cannot find module '@/...'` — path aliases not picked up. Check `tsconfig.app.json` has `baseUrl: "."` and `paths: { "@/*": ["./src/*"] }`.
- Tailwind classes not applying — confirm `@tailwindcss/vite` is in `vite.config.ts`.
- Supabase init error — `.env.local` is missing or has wrong values.

**Done condition:** all 4 routes load (`/welcome`, `/auth`, `/dashboard` redirects to `/auth`, `/anything-else` shows 404).

### Task 5 — Phase 1.3 — Auth (the first real feature)

This is the start of feature work. Master plan section 11.2 Phase 1 sub-task 1.3.

**Scope:**
- 4 login methods: WhatsApp + Pass, WhatsApp OTP, Email + Pass, Email OTP
- Migration bridge for V1 + V2 users (port V2's `auth.jsx` bridge logic)
- Verified-tier review queue UI for Maxons team (sub-task 1.11b)

**Files to create / change:**

| File | Action | Purpose |
|---|---|---|
| `src/pages/Auth.tsx` | replace stub | full 4-method login UI |
| `src/components/auth/EmailPasswordForm.tsx` | new | email + password sign-in / register |
| `src/components/auth/EmailOTPForm.tsx` | new | email OTP flow |
| `src/components/auth/WhatsAppPasswordForm.tsx` | new | whatsapp + password (uses Supabase phone auth) |
| `src/components/auth/WhatsAppOTPForm.tsx` | new | whatsapp OTP flow (uses Twilio via edge function) |
| `src/lib/auth-bridge.ts` | new | V1/V2 user detection + SetPassword flow trigger |
| `supabase/functions/whatsapp-send-otp/index.ts` | new | edge function — send Twilio WhatsApp OTP |
| `supabase/functions/whatsapp-verify-otp/index.ts` | new | edge function — verify code + sign user in |
| `src/pages/SetPassword.tsx` | new | for V1/V2 users without password yet |
| `src/pages/admin/VerifiedReviewQueue.tsx` | new | Maxons team queue for tier promotions |

**Acceptance criteria:**
- All 4 login methods work end-to-end on localhost
- A V2 user (one of the 65 migrated) can log in with email/password using the bridge
- A new user signs up, gets `tier: 'registered'` automatically
- Maxons team can view the review queue and promote a user to `tier: 'verified'`
- All flows have Playwright e2e tests
- AI provider keys are NOT involved (this is auth, not AI)

**Foundation check before starting:**
- ✅ `profiles` table exists with `tier`, `whatsapp_number`, `whatsapp_verified` columns
- ✅ `user_roles` table exists with `app_role` enum
- ✅ Supabase Auth phone provider needs to be enabled in Supabase dashboard (Maxons does this once via UI: Authentication → Providers → Phone → Enable + add Twilio creds)

---

## 3. How to add a new feature (the standard playbook)

Every new feature follows this 8-step pattern. Skipping steps trips the Scope Guardian.

### Step 1 — Read the master plan section for your feature
Find the Phase + sub-task number. If your work doesn't map to one, stop and surface the gap.

### Step 2 — Verify foundation
For every entity your feature touches, confirm:
- The table exists in `supabase/migrations/`
- It has FKs to its dependencies (per master plan section 4.1 dependency graph)
- It has RLS policies
- The TypeScript types in `database.types.ts` match

If anything is missing, write a new migration FIRST (Task 1 of YOUR feature is "extend foundation").

### Step 3 — Write a scope doc
Single markdown file in `~/Documents/Claude/Projects/Cropsintel/scopes/<YYYY-MM-DD>-<feature>.md` containing:
- Feature name + master plan reference
- What's in scope (bullet list)
- What's out of scope (bullet list — be explicit)
- File-level changes (table from §2 Task 5 above is the format)
- Acceptance criteria (testable conditions)
- Out-of-scope deferral (link to a future phase if applicable)

### Step 4 — Create a branch
```bash
git checkout -b feat/<short-name>
```

### Step 5 — Implement
Follow code conventions in the README. Specifically:
- Use the typed Supabase client from `@/lib/supabase`
- Use `useAuth()` for any auth-aware component
- Wrap protected routes with `<RouteGuard>`
- Lazy-load pages via `React.lazy()` in `App.tsx`
- Write Playwright tests for happy paths
- Conventional commits (`feat:`, `fix:`, `chore:`, etc.)

### Step 6 — Local verification
```bash
npm run build           # must pass — no TS errors
npx playwright test     # if e2e was added
npm run dev             # eyeball the feature
```

### Step 7 — Push + PR
```bash
git push -u origin feat/<short-name>
```
Open PR on GitHub. Vercel/GitHub Pages builds a preview deploy. Verify on the preview URL.

### Step 8 — Merge
Squash-merge to `main`. The deploy workflow triggers, GitHub Pages updates, cropsintel.com reflects the change (once DNS cuts over in Phase 1.15).

---

## 4. AI agent rules (when you ARE the autonomous coder)

These apply when Cowork / Lovable / Claude.ai is doing the coding itself.

### 4.1 Always
- Re-read this file + the master plan at the start of every session
- Read the relevant code BEFORE editing it (no Write without prior Read)
- Update `~/Documents/Claude/Projects/Cropsintel/cropsintel-v3-master-plan.md` when you make architectural decisions, with a change log entry
- Update `~/Documents/Claude/Projects/Cropsintel/SECRETS.md` when you create new credentials
- Use TodoWrite to track multi-step tasks
- Surface scope violations to Muzammil; don't silently absorb them
- Commit frequently with conventional-commit messages
- Tag every commit with the master plan section it implements (e.g., `feat: implement WhatsApp OTP login (master plan 1.3)`)

### 4.2 Never
- Don't put AI provider keys in `VITE_*` env vars
- Don't ship source maps to production (`build.sourcemap: false` in vite.config.ts is the safety belt)
- Don't add a feature that depends on an entity not yet in `supabase/migrations/`
- Don't create a parallel implementation next to a broken one
- Don't post Sale Contracts / Purchase Orders to BC — V3 doesn't integrate with BC (master plan v1.2)
- Don't break information walls — customers never see broker source, broker margins, or other customers' pricing
- Don't make decisions Muzammil hasn't approved (DNS changes, payment actions, repo visibility changes, key rotations)

### 4.3 When stuck
1. Read the master plan section that covers your area
2. Read the V1 audit (`v3-step2-v1-audit.md`) for "how V1 did it" reference
3. Read the V1 codebase at `/tmp/almond-oracle` (cloned for the audit, may have been removed — re-clone from GitLab if needed)
4. Surface the question to Muzammil with one multi-choice question (not open-ended)

---

## 5. Useful command reference

### Supabase CLI (V3 project linked)
```bash
npx supabase status                    # show current state
npx supabase db push                   # apply local migrations to remote
npx supabase db pull                   # pull remote schema into local migrations
npx supabase functions list            # list deployed edge functions
npx supabase functions deploy <name>   # deploy one edge function
npx supabase gen types typescript --project-id hzrnohsxigrqlmzegwlb > src/lib/database.types.ts
```

### Vite / npm
```bash
npm run dev          # dev server on :5173
npm run build        # production build to dist/
npm run preview      # preview built bundle
npm run lint         # eslint
```

### shadcn/ui — add a component
```bash
npx shadcn@latest add card           # adds Card component to src/components/ui/
npx shadcn@latest add table          # adds Table
# etc. — Components catalog: https://ui.shadcn.com/docs/components
```

### Git
```bash
git checkout -b feat/<name>          # new feature branch
git add . && git commit -m "feat: <msg> (master plan <section>)"
git push -u origin feat/<name>       # push + open PR on GitHub
```

---

## 6. Where things live

| What | Where |
|---|---|
| V3 source | `~/Documents/Claude/Projects/cropsintel-v3/` |
| V3 GitHub | `git@github.com:muzammil691/cropsintel-v3.git` |
| V3 Supabase | `https://supabase.com/dashboard/project/hzrnohsxigrqlmzegwlb` |
| V3 deployed (eventual) | `https://cropsintel.com` (after Phase 1.15 DNS cutover) |
| Master plan | `~/Documents/Claude/Projects/Cropsintel/cropsintel-v3-master-plan.md` |
| V1/V2 audits | `~/Documents/Claude/Projects/Cropsintel/v3-step2-v1-audit.md` and `v3-step3-v2-audit.md` |
| Comparative | `~/Documents/Claude/Projects/Cropsintel/v3-step4-v1-v2-comparative.md` |
| MAXONS workflow doc | uploaded as `cropsintel-cowork-handoff V3.md` (knowledge reference only — V3 doesn't execute these workflows) |
| Master secrets record | `~/Documents/Claude/Projects/Cropsintel/SECRETS.md` (NOT in any git repo, never commit) |
| Cowork memory directory | `~/Library/Application Support/Claude/local-agent-mode-sessions/<id>/spaces/<id>/memory/` |

---

## 7. Definition of Done for Phase 1

Phase 1 ships when:

1. ✅ Foundation migration applied + auto-generated types committed
2. ✅ All 4 login methods work + V2's 65 users can log in
3. ✅ 3-tier RBAC enforced at route, DB, app layers
4. ✅ Public landing + market-insight pages render with real Supabase data
5. ✅ Adela cron-driven runner deployed on Railway, scraping ABC + Strata + news daily
6. ✅ Position reports ingested + analytics layer working
7. ✅ Market Price Intelligence dashboard live
8. ✅ ~10 dashboard widgets working (configuration-driven via `widget_configs` table)
9. ✅ Zyra customer chat working (server-side edge function, Claude default, ElevenLabs voice, 13 Zyra modules per v1.4)
10. ✅ Hyper-personalized prescription engine v1 working
11. ✅ Verified-user review queue UI working for Maxons team
12. ✅ i18n setup with EN + HI + ZH + AR + UR
13. ✅ PWA setup (vite-plugin-pwa)
14. ✅ Playwright e2e tests passing for critical flows
15. ✅ DNS cutover: cropsintel.com points to V3 (V2 stays as readonly archive)
16. ✅ All AI keys server-side (in Supabase secrets); zero `VITE_*KEY` env vars

When all 16 are checked, Phase 1 is complete and Phase 2 (CRM Intelligence + Atlas + tracked-deals) begins.

**Realistic timeline:** 14-16 weeks (per master plan v1.4) at 10-20 focused hours/week.

---

## 8. Spec frontmatter flags (Workshop pre-flight contract)

When Atlas drafts a task spec into `.agent/tasks/queued/`, the Workshop
pre-flight (`atlas/src/workshop/queue-validator.ts`) refuses to queue it if
the body has no concrete `Files required` paths AND the frontmatter does
not declare the `audit-only` escape hatch. A title-only spec
deterministically fails the Verifier's `empty-diff-guard` check (see
`docs/atlas-decisions/ADR-2026-05-23-verifier-cluster-7da23cc3f830.md` §3.1
for the cluster that produced this gate).

### `audit-only: true`

Use this flag — and ONLY this flag — when the spec's deliverable is a
markdown ADR rather than a code diff. Examples: cluster-investigation
specs that produce `docs/atlas-decisions/ADR-*.md`, foundation audit
write-ups, or post-incident reviews where no `src/`/`supabase/`/`atlas/`
files are touched.

```yaml
---
priority: 2
audit-only: true
---
# Task: investigate cluster 7da23cc3f830

(deliverable is an ADR in docs/atlas-decisions/, not a code change)
```

**Do not** use `audit-only: true` to bypass the gate for a real coding task
whose Files required block was simply left empty by mistake — that defeats
the purpose. If you find yourself reaching for `audit-only` to silence the
pre-flight, the right move is almost always to add a concrete
`## Files required` block to the spec body.

On refusal, the pre-flight writes a stub `.agent/questions/<task-id>-q.md`
and stops, so a human reviews the spec before queue-out (per the system
prompt §6 question contract).

---

**End of V3 Coding Instructions.** Re-read at the start of every session.
