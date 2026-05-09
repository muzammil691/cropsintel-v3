---
phase: 1.3a
title: Auth — 4 login methods + V1/V2 user bridge + 3-tier RBAC
status: planned
gate: in-progress count <= 2
order: 1-of-3 morning batch — CropsIntel V1 starts shipping
estimated_builder_minutes: 60
estimated_cost_usd: 12
master_plan_section: 11.2 Phase 1.3
launch: v1.0-alpha
---

# Phase 1.3a — Auth foundation

## Why this exists

Master plan section 11.2 Phase 1.3 — "Auth: 4 methods (V2 pattern), V1+V2 user migration bridge". The first **real feature** in V3 (per V3-CODING-INSTRUCTIONS.md §2 Task 5). All subsequent phases (Adela, Zyra, dashboard, prescription) depend on this.

V1 (`muzammil691/almond-oracle`) has the complete reference auth implementation. V3-CODING-INSTRUCTIONS.md §2 Task 5 specifies the V3 file structure (different from V1 — V1's monolithic `Auth.tsx` becomes 4 form components in V3).

**Required reading before Builder starts** (in order):
1. `V3-CODING-INSTRUCTIONS.md` — the 5 rules + this spec's exact file table at §2 Task 5
2. `.agent/master-plan.md` § 11.2 — Phase 1.3 scope
3. `.agent/research/v1-to-v3-phase-1.3-auth-research-brief.md` — V1 file map + V3 conventions reconciliation
4. V1 reference: `muzammil691/almond-oracle/src/pages/Auth.tsx` (1607 lines) — domain knowledge, do NOT copy structure
5. V1 reference: `muzammil691/almond-oracle/supabase/functions/whatsapp-login`, `send-whatsapp-otp`, `verify-whatsapp-otp` — reference logic, V3 names them differently

## The 5 rules (V3-CODING-INSTRUCTIONS §0)

This spec MUST satisfy all five. Verifier checks each:

1. **Foundation-first.** Extends `profiles` table that already exists in `20260428000001_v3_foundation.sql`. Does NOT create parallel auth tables.
2. **Anti-restart.** Replaces `src/pages/Auth.tsx` stub in place. NEVER creates `Auth-2.tsx` or similar.
3. **Multi-commodity from Day 1.** Auth/profile work doesn't touch commodity tables, but profile shape must allow multi-commodity user preferences (see §3 below).
4. **AI keys server-side only.** This spec touches Twilio (WhatsApp OTP) — Twilio creds go in Supabase secrets via edge function, NEVER in `VITE_*` env vars. Same for any future AI calls in auth flows.
5. **Information walls.** RLS policies on every new column. Customers/brokers/suppliers can never read each other's profile rows or verification states.

## Foundation-first check

Verify these BEFORE Builder writes any code:

- ✅ `profiles` table exists (`20260428000001_v3_foundation.sql` line 251) with columns: `id`, `contact_id`, `company_id`, `full_name`, `display_name`, `preferred_language`, `tier`, `primary_models`, `whatsapp_number`, `whatsapp_verified`, `email_verified_at`, `last_seen_at`, `is_active`, `created_at`, `updated_at`
- ✅ `user_tier` ENUM exists with values: `'guest' | 'registered' | 'verified' | 'maxons_team'`
- ✅ `app_role` ENUM exists with values: `'auth' | 'team' | 'admin'`
- ✅ `user_roles` table exists (line ~30) — `user_id`, `role`, `granted_at`, `granted_by`
- ✅ `has_role(_user_id, _role)` helper function exists (line 42)
- ✅ `is_team_or_admin(_user_id)` helper exists (line ~63)
- ✅ `src/components/RouteGuard.tsx` exists (extend it, don't replace)
- ✅ `src/hooks/useAuth.ts` exists (extend it, don't replace — note `.ts` not `.tsx`)
- ✅ `src/pages/Auth.tsx` exists as 91-line stub (REPLACE with full implementation)

**Critical naming distinctions** (do NOT mix):
- `profiles.tier` = `user_tier` ENUM (`guest | registered | verified | maxons_team`) — drives RouteGuard and feature access
- `user_roles.role` = `app_role` ENUM (`auth | team | admin`) — drives admin queue access, NOT user-facing tier

A user can simultaneously be `tier: 'verified'` AND have a `user_roles` row with `role: 'admin'` (if they're a Maxons admin who is also themselves verified as a buyer).

## What ships

### 1. Migration — extend profiles, add verification + V1/V2 bridge tables

`supabase/migrations/<ts>_phase_1_3a_auth_foundation.sql`:

**ALTER `profiles` — add columns** (do NOT recreate the table):
- `verification_state text NOT NULL DEFAULT 'unverified'` CHECK in (`'unverified' | 'pending_review' | 'verified_buyer' | 'verified_broker' | 'verified_supplier'`)
- `verification_state_changed_at timestamptz`
- `verification_assigned_to uuid REFERENCES public.profiles(id)` — admin reviewer
- `geography_country text`
- `geography_city text`
- `business_type text`
- `annual_volume text`
- `referral_source text`

`tier` already exists from foundation; do NOT redefine.

**New table: `verification_requests`** (the multi-reviewer queue with structured background-check):

```sql
CREATE TABLE public.verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'approved', 'rejected')),
  
  -- Assignment (multi-reviewer)
  assigned_to uuid REFERENCES public.profiles(id),
  assigned_at timestamptz,
  
  -- Background-check structured fields
  business_registration_verified boolean,
  business_registration_notes text,
  business_registration_url text,
  
  linkedin_verified boolean,
  linkedin_notes text,
  linkedin_url text,
  
  website_verified boolean,
  website_notes text,
  website_url text,
  
  references_checked_count int NOT NULL DEFAULT 0,
  references_notes text,
  
  trade_history_reviewed boolean,
  trade_history_notes text,
  
  whatsapp_confirmation_done boolean,
  whatsapp_confirmation_date timestamptz,
  
  -- Decision
  decided_at timestamptz,
  decided_by uuid REFERENCES public.profiles(id),
  decided_to_state text CHECK (decided_to_state IN ('verified_buyer', 'verified_broker', 'verified_supplier', 'rejected')),
  final_decision_notes text,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_verification_requests_status ON public.verification_requests(status, created_at DESC);
CREATE INDEX idx_verification_requests_assigned ON public.verification_requests(assigned_to) WHERE status IN ('open', 'in_review');

-- RLS: user reads own; team/admin reads all; only team/admin writes
ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own verification requests"
  ON public.verification_requests FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "team/admin read all verification requests"
  ON public.verification_requests FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "team/admin write verification requests"
  ON public.verification_requests FOR ALL TO authenticated
  USING (public.is_team_or_admin(auth.uid()))
  WITH CHECK (public.is_team_or_admin(auth.uid()));

CREATE TRIGGER trg_verification_requests_updated_at BEFORE UPDATE ON public.verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

**New table: `guest_sessions`** (10-deep-output gate for Phase 1.3b):

```sql
CREATE TABLE public.guest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_fingerprint text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  deep_outputs_count int NOT NULL DEFAULT 0,
  basic_chat_count int NOT NULL DEFAULT 0,
  role_inferred text,
  geography_country_inferred text,
  conversation_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  converted_to_user uuid REFERENCES auth.users(id),
  converted_at timestamptz
);

CREATE INDEX idx_guest_sessions_recent ON public.guest_sessions(last_seen_at DESC) WHERE converted_to_user IS NULL;

ALTER TABLE public.guest_sessions ENABLE ROW LEVEL SECURITY;

-- Guest sessions are server-side only; no client-side reads
CREATE POLICY "service_role only on guest_sessions"
  ON public.guest_sessions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

**New table: `auth_bridge_log`** (V1/V2 user migration audit trail):

```sql
CREATE TABLE public.auth_bridge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  v1_match_email text,
  v1_match_phone text,
  v2_match_email text,
  v2_match_phone text,
  bridge_method text NOT NULL CHECK (bridge_method IN ('email_match', 'phone_match', 'whatsapp_match', 'manual')),
  set_password_required boolean NOT NULL DEFAULT false,
  set_password_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_bridge_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team/admin read bridge log"
  ON public.auth_bridge_log FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "service_role writes bridge log"
  ON public.auth_bridge_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
```

### 2. Edge functions — V3-named (NOT direct V1 ports)

Per V3-CODING-INSTRUCTIONS §2 Task 5, V3 uses different edge function names than V1:

`supabase/functions/whatsapp-send-otp/index.ts` — sends WhatsApp OTP via Twilio
- Reference logic: V1's `send-whatsapp-otp/index.ts`
- V3 differences: stricter rate limiting (use `agent_rate_limits` from foundation), audit log entry per send

`supabase/functions/whatsapp-verify-otp/index.ts` — verifies code, signs user in
- Reference logic: V1's `verify-whatsapp-otp/index.ts`
- V3 differences: triggers auth-bridge check on success (see §3 below)

`supabase/functions/auth-bridge/index.ts` — V1/V2 user detection
- Input: `{ email?, phone? }`
- Logic:
  - If V1/V2 user found by email or phone → return `{ found: true, set_password_required: bool, hint_email, hint_phone }`
  - Write entry to `auth_bridge_log` table
  - DOES NOT auto-create the V3 account; returns hint for SetPassword flow
- Output drives the `SetPassword.tsx` page

Twilio creds go in Supabase secrets:
```bash
npx supabase secrets set TWILIO_ACCOUNT_SID=<sid> TWILIO_AUTH_TOKEN=<token> TWILIO_WHATSAPP_FROM=<number>
```

Document this in spec output. Muzammil-side action — the spec calls this out so he knows to set them.

### 3. Frontend — V3 file structure (per V3-CODING-INSTRUCTIONS Task 5 table)

**`src/pages/Auth.tsx`** — REPLACE 91-line stub with full 4-method auth UI:
- Hero header with brand
- 4 toggleable forms (use Tabs from shadcn/ui):
  - Email + Password
  - Email OTP
  - WhatsApp + Password
  - WhatsApp OTP
- Each form is a separate component (see below)
- Below forms: "First time? V1/V2 user?" link → SetPassword flow
- "Already have an account? Sign in" / "New here? Create account" toggle
- Use `Helmet` for title (matches existing stub pattern)

**`src/components/auth/EmailPasswordForm.tsx`** (new):
- Email + password fields
- Sign in / Sign up toggle
- Standard Supabase email auth via `supabase.auth.signInWithPassword` / `signUp`
- On signup: create profile row with `tier: 'registered'`
- Post-signup redirect: `/dashboard` if returning user, `/onboarding` if new

**`src/components/auth/EmailOTPForm.tsx`** (new):
- Email field + "Send OTP" button
- After send: 6-digit code input + "Verify" button
- Uses Supabase magic link OTP

**`src/components/auth/WhatsAppPasswordForm.tsx`** (new):
- Country code select (port the COUNTRY_CODES list from V1's `data/countryCodes.ts`)
- Phone number field
- Password field
- Uses Supabase phone auth provider (Muzammil enables in dashboard once)

**`src/components/auth/WhatsAppOTPForm.tsx`** (new):
- Country code + phone fields
- "Send OTP via WhatsApp" button → calls `whatsapp-send-otp` edge function
- 6-digit code input
- "Verify" button → calls `whatsapp-verify-otp` edge function

**`src/lib/auth-bridge.ts`** (new):
- `checkBridge({ email?, phone? })` → calls `auth-bridge` edge function
- Returns `{ found, set_password_required, hint_email, hint_phone }`
- Used by all 4 forms after a sign-in attempt — if Supabase says "user not found" but bridge says "V1/V2 match", redirect to SetPassword

**`src/pages/SetPassword.tsx`** (new):
- Shown when user is recognized as V1/V2 but has no V3 password
- Shows hint email/phone (masked, e.g., `m••••@maxons.com`)
- "Set new password" form
- On submit: creates V3 account linked to bridge match, marks `set_password_completed_at` in bridge log

**`src/pages/admin/VerifiedReviewQueue.tsx`** (new):
- Lists `verification_requests` with `status IN ('open', 'in_review')`
- Filter pills: "My queue" | "Unassigned" | "All open" | "All closed"
- Each row: profile name, company, country, business type, requested_at, assigned_to badge
- Click row → expand to show structured background-check checklist
- Each check has: checkbox + notes textarea + URL field (where applicable)
- "Assign to me" button (when unassigned)
- "Approve as → buyer/broker/supplier" with required final_decision_notes
- "Reject" with required final_decision_notes
- Uses `RouteGuard` with `requireRole="team"` (per V3 RBAC pattern: team OR admin can review)

**`src/components/admin/BackgroundCheckChecklist.tsx`** (new):
- Reusable component used inside VerifiedReviewQueue
- 6 check rows, each: checkbox + notes + optional URL
- Auto-saves on blur (debounced 1s)
- Read-only when status is 'approved' or 'rejected'

**Extend `src/hooks/useAuth.ts`** (do NOT replace):
- Add `tier` to returned object (read from `profiles.tier`)
- Add `verificationState` to returned object (read from `profiles.verification_state`)
- Add `roles` array (read from `user_roles` table)
- Helper: `hasTier(t: UserTier): boolean`
- Helper: `hasRole(r: AppRole): boolean`
- Helper: `isTeamOrAdmin(): boolean` (true if role is team OR admin)

**Extend `src/components/RouteGuard.tsx`** (do NOT replace):
- Accept `requireTier?: UserTier` and `requireRole?: AppRole` props
- Block when user doesn't meet either requirement
- On block: redirect to `/auth?next=<current-path>`

### 4. Routes (extend `App.tsx`)

```tsx
<Routes>
  <Route path="/" element={<Landing />} />  {/* Phase 1.3b ships this */}
  <Route path="/auth" element={<Auth />} />
  <Route path="/set-password" element={<SetPassword />} />
  <Route path="/dashboard" element={<RouteGuard requireTier="registered"><Dashboard /></RouteGuard>} />
  <Route path="/insights/basic" element={<RouteGuard requireTier="registered"><InsightsBasic /></RouteGuard>} />
  <Route path="/insights/execution" element={<RouteGuard requireTier="verified"><InsightsExecution /></RouteGuard>} />
  <Route path="/admin" element={<RouteGuard requireRole="admin"><Admin /></RouteGuard>}>
    <Route path="verified-queue" element={<VerifiedReviewQueue />} />
  </Route>
</Routes>
```

(`Landing` and `InsightsBasic`/`InsightsExecution` stubs at minimum — Phase 1.3b ships real Landing.)

### 5. Tests

`e2e/phase-1.3a-auth.spec.ts` (per master plan §11.2 sub-task 1.14 e2e requirement):

- (a) Visit `/auth`, all 4 form tabs render.
- (b) Sign up via Email + Password → profile created with `tier: 'registered'`.
- (c) Sign up via WhatsApp OTP → calls `whatsapp-send-otp` (mock), enters code, calls `whatsapp-verify-otp` (mock), profile created.
- (d) Sign in as V1 user (mock email match in bridge) → redirected to `/set-password`, sets new password, lands at `/dashboard`.
- (e) Registered user submits verification request → row in `verification_requests` with `status: 'open'`.
- (f) Maxons admin opens `/admin/verified-queue`, sees the request, clicks "Assign to me" → row updated.
- (g) Admin completes 4 of 6 background checks, clicks "Approve as buyer" with notes → user becomes `tier: 'verified'`, `verification_state: 'verified_buyer'`, request `status: 'approved'`.
- (h) Verified user accesses `/insights/execution` → allowed.
- (i) Registered user (not verified) accesses `/insights/execution` → redirected to `/auth?next=/insights/execution`.
- (j) Anonymous user accesses `/admin/verified-queue` → redirected to `/auth`.

## Acceptance criteria (per V3-CODING-INSTRUCTIONS Task 5)

Direct quote from instructions: *"All 4 login methods work end-to-end on localhost; A V2 user (one of the 65 migrated) can log in with email/password using the bridge; A new user signs up, gets `tier: 'registered'` automatically; Maxons team can view the review queue and promote a user to `tier: 'verified'`; All flows have Playwright e2e tests."*

Plus this spec adds:

- All 5 rules satisfied (Verifier checks each).
- Multi-reviewer queue with self-assignment works.
- Structured background-check checklist saves per check.
- Guest session table tracks deep_outputs_count (used by 1.3b).
- `npm run build` clean.
- 10 e2e tests pass.
- Spec lands in `done/`.

## Out of scope (defer to other phases)

- AI agent landing page UI (Phase 1.3b ships the scaffold).
- Real Zyra AI brain (Phase 1.10 — 13 modules per master plan v1.4).
- Hyper-personalized prescriptions (Phase 1.11).
- Multi-portal frontend (Phase 1.7).
- Adela data spine (Phase 1.6).
- CRM admin features — offers, inquiries (Phase 2).
- External portals (Phase 3).
- MAXONS App territory (forever — see V3-CODING-INSTRUCTIONS §4.2 "Don't post Sale Contracts...").
- Multi-language for auth UI (English first; i18n is Phase 1.12).
- Voice in/out for forms (defer).

## Manual steps required (Muzammil-side, document in spec output)

1. Enable Supabase phone auth provider (one-time, via dashboard: Authentication → Providers → Phone → enable + add Twilio creds)
2. Set Supabase secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`
3. After spec ships, run `npx supabase db push` (Verifier db_write_failed migration pattern means Atlas CAN'T auto-apply — Muzammil applies)
4. After migration applies, run `npx supabase gen types typescript --project-id hzrnohsxigrqlmzegwlb > src/lib/database.types.ts` to refresh types
5. Verify all 4 login methods on localhost before merging to main

Builder writes a concise summary of these steps to `docs/phase-1.3a-manual-steps.md` after shipping.

## Branching (per V3-CODING-INSTRUCTIONS §3 Step 4)

Builder commits directly to `main` (Atlas convention). The V3-CODING-INSTRUCTIONS branching pattern (`feat/<short-name>` + PR + squash) applies to human-driven Cowork sessions. Atlas autonomous Builder is a different workflow.

If concerns arise about Atlas committing directly to main, that's a **separate spec** (cockpit polish 1.10ba could include "Atlas commits to feat/ branches with auto-PR" as an option). Not in scope here.

## Files touched (estimate)

- 1 new SQL migration (~250 lines)
- 3 new edge functions (whatsapp-send-otp, whatsapp-verify-otp, auth-bridge)
- 1 file replaced (`src/pages/Auth.tsx`)
- 4 new auth form components
- 1 new auth-bridge lib
- 1 new SetPassword page
- 1 new admin VerifiedReviewQueue page
- 1 new BackgroundCheckChecklist component
- 1 useAuth.ts extension
- 1 RouteGuard.tsx extension
- 1 App.tsx routes extension
- 1 e2e test file (10 scenarios)
- 1 manual-steps docs file

Total: **~17 files**. Heavy ports + new structure.

## Realistic Builder time

Calibration:
- 1.10aj cockpit (17 files, 16 min) — most comparable scope
- 1.10am wizard (8 files, 10 min) — smaller
- 1.10ag (9 files, 15 min)

This spec ~17 files, but heavier per-file (real auth UX, real RBAC, real edge functions) than cockpit. Estimate: **45-65 min Builder**, **5 min Verifier**, **8 min Designer** (UI-heavy). Wall clock ~75-90 min. Cost ~$10-15.

## Dependencies

- 1.10ai shipped (real-signal Atlas) ✅
- 1.10ag2 shipped (lifecycle) ✅
- 1.10az shipped (verifier db_write_failed fix) ✅
- V3 foundation migration applied (foundation done per V3-CODING-INSTRUCTIONS §1)
- V1 repo at `muzammil691/almond-oracle` accessible (public)
- V3-CODING-INSTRUCTIONS.md in repo root ✅
- Master plan at `.agent/master-plan.md` ✅
- Research brief at `.agent/research/v1-to-v3-phase-1.3-auth-research-brief.md` (place this BEFORE queueing)
