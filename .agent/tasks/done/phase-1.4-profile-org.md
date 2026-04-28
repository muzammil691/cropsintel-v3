# Task: Phase 1.4 — Profile + Organization Setup

**Master plan reference:** section 11.4
**Depends on:** Phase 1.3 (auth must work)
**Estimated effort:** ~3-5 hours of agent work; iterate.

---

## Goal

After a user signs up (Phase 1.3), they need to complete their profile and either join or create an organization. This is the gate between "registered" and "verified" tiers in the master plan.

## In scope

### Pages
- `src/pages/onboarding/ProfileSetup.tsx` — display name, role, country, WhatsApp, optional photo
- `src/pages/onboarding/OrgSetup.tsx` — Two paths: (a) Create new org (becomes org admin); (b) Join existing org by invite code
- `src/pages/admin/InviteCodes.tsx` — Org admin can generate invite codes for their team

### Components
- `src/components/onboarding/StepIndicator.tsx` — 1-of-3 / 2-of-3 / 3-of-3 indicator
- `src/components/onboarding/OrgInviteJoinForm.tsx`
- `src/components/onboarding/OrgCreateForm.tsx`

### Schema (write a new migration `20260429xxxxxx_orgs.sql`)
- `organizations` table: id, name, country, created_by (auth.users), created_at, settings jsonb
- `organization_members` table: id, org_id, user_id, role enum('admin','member'), invited_by, joined_at
- `org_invite_codes` table: id, org_id, code (unique), expires_at, max_uses, current_uses, created_by
- RLS on all three (org members can read their org; admins can write)
- Update `profiles` table to add `current_org_id` foreign key (nullable)

### Routing changes
- After auth, if `profile.display_name IS NULL` → redirect to `/onboarding/profile`
- After profile complete, if `current_org_id IS NULL` → redirect to `/onboarding/org`
- After org complete → `/dashboard` (the next phase will build this)

### Library
- `src/lib/onboarding.ts` — checkOnboardingStatus(profile), markStepComplete(step)

## Out of scope
- Org-level billing / subscriptions (Phase 5)
- Multi-org switching (a user can be in multiple orgs but only "current" matters now)
- Org-level branding / theme customization (Phase 3)

## Acceptance criteria

1. New signup → redirected to `/onboarding/profile` automatically
2. Profile saved → redirected to `/onboarding/org`
3. User chooses "Create org" → fills form → becomes admin of new org → redirected to `/dashboard` (404 is fine for now, dashboard is phase 1.5)
4. User chooses "Join org" → enters valid code → joins as member → redirected to `/dashboard`
5. Org admin can visit `/admin/invite-codes`, generate a code, see it in a table, copy to clipboard
6. RLS prevents non-members from seeing org data
7. `npm run build` passes
8. Conventional commits

## Foundation check (BEFORE starting)
- Verify Phase 1.3 auth works on deployed site
- Verify `profiles` table exists and has rows for any test users

## Notes
- Country list: use a static array of ISO 3166-1 alpha-2 codes for now
- Invite code format: 8 alphanumeric chars, generated server-side via SQL function
- shadcn components needed: `form`, `card`, `input`, `select`, `button` (run `npx shadcn@latest add form card select` if not already present)

---

**Done condition:** new user can complete signup → profile → org and reach `/dashboard` placeholder, build green.
