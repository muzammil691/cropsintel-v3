# Task: Phase 1.00 — Clean slate (delete wrong-numbered features, restore master-plan foundation)

**Master plan reference:** anti-restart rule 2.1 ("If a fresh restart is genuinely the only path, the master plan is updated and the old version is deleted, not parked")
**User instruction 2026-04-29:** "i want a clean app and code... please avoid any extra written, give agent command to delete all and start from scratch"
**Estimated effort:** ~3 hours
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

The agent earlier shipped 3 features (profile-org, dashboard-shell, CRM) that did NOT match master plan v1.5 Phase 1 ordering. Per the user's explicit instruction, delete ALL code added by those features so the codebase returns to a clean Phase-1.3 (auth) foundation. Then subsequent queued tasks (1.04 RBAC → 1.05 landing → 1.06 Adela) build the correct intelligence-layer-first product.

This is a one-pass surgical cleanup, not an iterative rebuild.

## In scope — DELETE these

### Files added by phase-1.4-profile-org (commit 42f920d)
Use `git diff 42f920d^..42f920d --name-only` to enumerate. Likely targets:
- `src/pages/onboarding/ProfileSetup.tsx`
- `src/pages/onboarding/OrgSetup.tsx`
- `src/pages/admin/InviteCodes.tsx`
- `src/components/onboarding/StepIndicator.tsx`
- `src/components/onboarding/OrgInviteJoinForm.tsx`
- `src/components/onboarding/OrgCreateForm.tsx`
- `src/lib/onboarding.ts`
- Any `supabase/migrations/2026042*_orgs.sql` migration
- Any new routes added to `src/App.tsx` for `/onboarding/*` and `/admin/invite-codes`
- The `current_org_id` column / `organizations` / `organization_members` / `org_invite_codes` tables — write a follow-up SQL migration that DROPs them with `CASCADE` (the new migration's filename should sort after the orgs creation migration)

### Files added by phase-1.5-dashboard-shell (commit 88d7158)
- `src/components/layout/AppShell.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/Topbar.tsx`
- `src/components/layout/CommoditySelector.tsx`
- `src/pages/Markets.tsx`
- `src/pages/Trading.tsx`
- `src/pages/Reports.tsx`
- `src/pages/Settings.tsx` (and any sub-routes)
- `src/stores/commodityStore.ts` and the entire `src/stores/` directory if empty after this
- `src/hooks/useCommodity.ts`
- `src/lib/dashboard.ts`
- shadcn `sidebar`, `dropdown-menu`, `avatar`, `tabs` components if added by this phase — delete them too
- `zustand` from package.json dependencies (run `npm uninstall zustand`)
- Routes added to App.tsx for /markets, /trading, /reports, /settings/*

Note: `src/pages/Dashboard.tsx` should remain as a STUB (just an empty placeholder page). The real dashboard with widgets is master plan 1.9, far down the road.

### Files added by phase-1.6-crm (commit 243e9ff)
- `src/pages/CRM.tsx` (revert to a stub if it existed before, else delete entirely)
- `src/pages/crm/ContactDetail.tsx`
- `src/pages/crm/ContactImport.tsx`
- `src/components/crm/ContactTable.tsx`
- `src/components/crm/ContactForm.tsx`
- `src/components/crm/ActivityTimeline.tsx`
- `src/components/crm/LogActivityDialog.tsx`
- `src/lib/crm.ts`
- Any `supabase/migrations/2026042*_crm.sql` migration → write a follow-up DROP migration (contacts / contact_activities / contact_imports tables) with CASCADE
- `@tanstack/react-table`, `papaparse`, `@types/papaparse` from package.json (run `npm uninstall`)
- shadcn `table` if added by this phase — delete

## In scope — KEEP these (do NOT delete)

These are master-plan-aligned foundation that subsequent phases depend on:

- All scaffold files (`vite.config.ts`, `tsconfig*.json`, `package.json` — except dependency removals above, `index.html`)
- `src/main.tsx`, `src/App.tsx`, `src/index.css`
- `src/pages/Welcome.tsx`, `src/pages/Auth.tsx`, `src/pages/Dashboard.tsx` (as stub), `src/pages/NotFound.tsx`
- `src/lib/supabase.ts`, `src/lib/database.types.ts`, `src/lib/types.ts`
- `src/contexts/AuthContext.tsx`, `src/hooks/useAuth.ts`, `src/components/RouteGuard.tsx`
- `src/components/ui/*` — keep ALL shadcn primitives that aren't tied to a specific deleted phase (button, card, input, label, separator, etc.). Only remove ui components added by deleted phases (sidebar, dropdown-menu, avatar, table, tabs).
- `supabase/migrations/20260428000001_v3_foundation.sql` (Phase 1.2)
- `supabase/migrations/20260428000002_fix_user_roles_rls.sql` (Phase 1.2)
- ALL Phase 1.3 auth code: `src/pages/SetPassword.tsx`, `src/components/auth/*`, `src/lib/auth-bridge.ts`, `supabase/functions/whatsapp-send-otp`, `supabase/functions/whatsapp-verify-otp`, related migrations
- All `agent/` directory (Dockerfile, agent-loop.sh, notify-whatsapp.sh, CLAUDE.md, README.md)
- All `.agent/tasks/` structure
- `.github/workflows/deploy.yml`
- `public/CNAME`
- The Vite base path fix (vite.config.ts has `base: '/cropsintel-v3/'`) — KEEP
- The Router basename in main.tsx (`basename={import.meta.env.BASE_URL}`) — KEEP
- The SPA 404 fix from phase-1.7-vite-pages-fix (`public/404.html` and the corresponding inline script in `index.html`) — KEEP, this is infrastructure not a feature

## Order of operations

1. Read this task carefully. If anything is ambiguous, write `.agent/questions/phase-1.00-clean-slate-q.md` and stop.
2. Use `git log --oneline` and `git diff <commit>^..<commit> --name-only` to enumerate exactly what each wrong-phase commit touched.
3. Build a single deletion list. Cross-reference against the KEEP list above.
4. Delete files. Drop tables via new migration files (DROP IF EXISTS ... CASCADE).
5. Update `src/App.tsx` to remove routes pointing to deleted pages.
6. Run `npm uninstall` for the dependency list above.
7. Run `npm install` to refresh package-lock.
8. Regenerate types: `npx supabase gen types typescript --project-id hzrnohsxigrqlmzegwlb --schema public > src/lib/database.types.ts`
9. Run `npm run build` — must pass green. If TypeScript errors, fix them until green (these will be from removed imports — fix the importing files).
10. Run the new DROP migrations against V3 Supabase: `supabase db push`. (Use SUPABASE_ACCESS_TOKEN env var.)
11. ONE commit with a clear message: `chore: clean slate — remove wrong-numbered phases (1.4 profile-org, 1.5 dashboard-shell, 1.6 crm) per user 2026-04-29`
12. Push.

## Acceptance criteria

1. `git ls-files src/` lists ONLY: scaffold files + auth files + Phase 1.3-shipped files + minimal stubs. NO onboarding/, NO components/layout/, NO components/crm/, NO components/onboarding/, NO pages/crm/, NO stores/, NO Markets/Trading/Reports/Settings pages.
2. `npm run build` passes
3. V3 Supabase Studio: tables `organizations`, `organization_members`, `org_invite_codes`, `contacts`, `contact_activities`, `contact_imports` are GONE.
4. The site at https://muzammil691.github.io/cropsintel-v3/ still loads (Welcome page renders)
5. Sign-in flow still works (Phase 1.3 auth not broken)
6. Single commit, clear message
7. Conventional commit style (`chore:` prefix is correct for this)

## What this task is NOT

- NOT a rebuild. Don't add any new code in this task — only deletions.
- NOT a database migration tweak beyond DROP. Don't refactor Phase 1.2 or 1.3 schema.
- NOT a place to address other tech debt. One job: delete the wrong-numbered features.

## After this task ships

Next queued tasks (alphabetical order):
- `phase-1.04-rbac.md` — proper 3-tier RBAC + Verified Review queue
- `phase-1.05-public-landing.md` — public landing + market insight pages
- `phase-1.06-adela-skeleton.md` — Adela scraper Railway service
- `phase-1.07b-v1-data-migration.md` — skip stub (just moves to done/)

The agent then proceeds in master-plan order: RBAC → landing → Adela → ...

---

**Done condition:** the V3 codebase contains ONLY master-plan-aligned Phase 1.0-1.3 work + agent infrastructure + foundation scaffold. Build passes. Site renders. Auth works. No phase-1.4/1.5/1.6 features present.
