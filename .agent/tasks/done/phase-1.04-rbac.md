# Task: Phase 1.4 — 3-tier RBAC (route + DB + app)

**Master plan reference:** v1.5 section 11.2 row 1.4
**Depends on:** Phase 1.3 auth (✅ shipped)
**Estimated effort:** ~6 hours
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

Build the 3-tier role gating system that EVERY subsequent feature depends on. Per master plan section 1.6 + 1.11b:

- **Public** — anyone, including unauthenticated visitors
- **Subscriber (verified)** — paid/manually-approved users
- **Admin / CropsIntel team** — Maxons internal team

Plus a **Verified Review queue** UI so the Maxons team can promote `registered` users to `verified` (per master plan 1.11b).

## In scope

### DB layer (write migration `20260429xxxxxx_rbac_hardening.sql`)
- Confirm `app_role` enum has values: `customer`, `broker`, `supplier`, `admin`, `team` (per master plan 4.1 row 6)
- Confirm `tier` enum on profiles: `public`, `registered`, `verified` (and an internal `team` tier)
- Add SQL function `has_role(_user_id uuid, _role app_role)` — SECURITY DEFINER
- Add SQL function `is_verified(_user_id uuid)` returning boolean — short-circuits for `team` users (always true)
- Add SQL function `is_team(_user_id uuid)` returning boolean
- Audit every existing RLS policy and ensure they call these functions consistently

### Route layer (`src/components/RouteGuard.tsx` already exists — extend it)
- `<RouteGuard tier="public">` — pass-through, but SSR/SSG-friendly
- `<RouteGuard tier="registered">` — must be authenticated; redirect to `/auth` if not
- `<RouteGuard tier="verified">` — must be authenticated AND verified; redirect to `/upgrade-pending` (new page) if registered-but-not-verified
- `<RouteGuard tier="team">` — must be on Maxons team (has `team` role); 404 to outsiders so we don't leak admin URLs

### App layer (UI affordances)
- `useAuth()` hook returns `{ tier, roles, isVerified, isTeam }` — these are derived from `profiles.tier` + `user_roles`
- `<TierGate tier="verified">` component — wraps any UI block, hides for lower tiers, shows an "upgrade to access" CTA for registered users
- `<InfoWall reason="customer-only">` — per master plan information walls (section 1.11). Used inside CRM views to hide e.g. supplier prices from customers.

### Verified Review Queue (1.11b)
- `src/pages/admin/VerifiedReviewQueue.tsx` — table of `registered` users sorted by signup date
- Each row: display name, email, country, WhatsApp verified Y/N, signup age, "Approve" button
- Approve action → updates `profiles.tier = 'verified'` AND inserts a `user_roles` row with role `customer` (or whatever role the admin selects from a dropdown)
- Audit: writes to `admin_audit_log` (create this table if missing) with: who approved, target user, timestamp, role assigned

## Out of scope

- Tier downgrade flow (Phase 2)
- Self-service tier upgrade (Phase 3 — currently only manual via Maxons review)
- Multi-org tier (a user has the same tier across orgs for now)
- 2FA gating per tier (Phase 4)

## Acceptance criteria

1. Visiting `/admin/verified-review` as a non-team user → 404 (NOT a redirect, per master plan information walls)
2. Maxons team user can view the queue, click Approve on a registered user, that user's tier becomes `verified` in DB
3. The newly-verified user, on their next page load, sees the verified-tier UI affordances unlock automatically
4. RLS spot-check: a customer-tier user cannot read another company's data even with a hand-crafted SQL query
5. `has_role()`, `is_verified()`, `is_team()` SQL functions exist and are used by at least 3 RLS policies each
6. Playwright test: signup → registered → admin approves → verified UI elements appear
7. `npm run build` passes

## Foundation check (BEFORE starting)
- Verify `app_role` enum exists from Phase 1.2 migration
- Verify `user_roles` table has `(user_id, role, granted_by, granted_at)` columns
- If anything is missing, write `.agent/questions/phase-1.04-rbac-q.md` with the gap

## Notes
- shadcn components needed: `table`, `dialog`, `select`, `badge` — install if missing
- Information walls are CRITICAL and load-bearing per master plan rule 5 in CLAUDE.md. RLS is the source of truth; UI hiding is a usability layer ON TOP of RLS, not a substitute.
- Use Lucide icons consistently — `ShieldCheck` for verified, `Crown` for team.

---

**Done condition:** every subsequent phase can rely on `useAuth().tier` to gate UI, on RouteGuard to gate pages, and on RLS functions to gate data. Verified review queue functional.
