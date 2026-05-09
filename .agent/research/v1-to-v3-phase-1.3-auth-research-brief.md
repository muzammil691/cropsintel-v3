# V1 → V3 Phase 1.3 Research Brief
**Date:** 2026-05-09
**Author:** Muzammil + Claude (advisor)
**Scope:** Auth + 3-tier RBAC + V1/V2 user bridge + AI-agent landing gate

---

## TL;DR — what to build

**Port V1's auth machinery to V3** (it's already 80% built), **then layer the new AI-agent guest gate** on top. Phase 1.3 = port + adapt, not from scratch.

---

## What V1 already has (port these — they work)

### Auth UI
- **`src/pages/Auth.tsx`** (1,607 lines) — full multi-method auth + onboarding wizard. Has all 4 login methods (WhatsApp/email × password/OTP), all 7 user roles (`customer | supplier | packer | broker | trader | repacker | industry_user`), country/city dropdowns, port lists, almond product taxonomy, business types, annual volume tiers, certifications, currencies, languages, packaging, processing capabilities, trading styles, end-use industries, origin regions. **All hardcoded with real domain knowledge** — preserve these constants verbatim.
- **`src/hooks/useAuth.tsx`** (127 lines) — auth context, role fetch from `user_roles` table, session management, onAuthStateChange listener. Clean. Port unchanged.
- **`src/components/admin/AdminVerificationQueue.tsx`** — admin queue with 5 verification states (`unverified | pending_review | verified_buyer | verified_broker | verified_supplier`).
- **`src/components/ProfileCompletionCard.tsx`** — completion progress display.
- **`src/components/VerificationRequestCard.tsx`** — user-side verification request UI.
- **`src/components/crm/OnboardCustomerWizard.tsx`** (410 lines) — onboarding wizard for verified users.
- **`src/hooks/useVerificationState.ts`** — verification state machine.
- **`src/hooks/useProfileCompletion.ts`** — completion tracking.

### Auth backend (Supabase Edge Functions)
- **`auth-email-hook`** — custom email signup
- **`whatsapp-login`** — WhatsApp + password login
- **`send-whatsapp-otp`** — OTP send via Twilio
- **`verify-whatsapp-otp`** — OTP verify
- **`email-otp-eligibility`** — gate for email OTP
- **`verify-account-number`** — admin verification
- **Email templates** — signup + reauthentication

### RBAC
- **`src/lib/zyraRBAC.ts`** — 4-tier permission system: `viewer | member | admin | owner` with 23 commands and per-role permission sets including `dataScope`, `canCreateWidgets`, `canModifyOthers`, `canAccessAtlas`, `maxWidgetsPerDay`. **Already built and tested.**

### Database tables (V1 Supabase)
- `user_roles` — userId → role mapping
- Profile tables with `verification_state`, `verification_requested_at`, `verification_note`
- Email/phone OTP tracking

---

## What V1 has that doesn't fit V3 (adapt these)

### Guest session model
**V1 uses 5-MINUTE timeout, not interaction-counted.** From `src/hooks/useGuestSession.ts`:

```typescript
const GUEST_SESSION_DURATION = 5 * 60 * 1000; // 5 minutes
```

**V3 needs interaction-counted (10 deep outputs).** This is a real change, not a port. New design:

```typescript
type GuestState = {
  guest_id: string             // session UUID
  started_at: timestamp
  deep_outputs_count: number   // increments only on substantive AI outputs
  basic_chat_count: number     // unlimited, tracked for analytics
  role_inferred: AppRole | null
  geography_inferred: string | null
  conversation_history: Message[]
}
```

Stored in `guest_sessions` Supabase table (server-side, not localStorage — survives device switches if guest re-enters with same browser fingerprint).

### "Approved" vs "verified" terminology
V1 mixes `verification_state` + `is_approved`. V3 should be cleaner — one word, three states: `registered | pending | verified`. Migration maps V1 states forward.

### April 1 deadline logic
V1 has `APRIL_DEADLINE = 2026-04-01` baked in (`isBeforeDeadline()` function). That deadline already passed. **Strip this logic** — V3 doesn't need it.

---

## What V3 needs that V1 doesn't have (build new)

### 1. The AI-agent landing page (Phase 1.10 territory but framework needs to exist in 1.3)

User lands → AI agent greets with hybrid starter (3-4 prompts + free input) → user engages → AI infers role + geography from natural conversation → AI tracks "deep output" count → at 10, soft-walls.

**Phase 1.3 must ship the foundation:**
- `guest_sessions` table + RLS
- `deep_output` event logging endpoint
- Soft-wall gate logic (count check + AI prompt to upgrade)
- Role + geography capture from session into eventual profile

**Phase 1.3 does NOT ship the AI agent itself.** That's Phase 1.10. But the gate must work with whatever lands at /chat or whatever it gets called.

### 2. Multi-reviewer admin queue with assignment

V1's queue is single-reviewer. V3 needs:
- "Assigned to" field on verification request
- Self-assign button + reassign workflow
- Filter: "show only my queue" / "all open" / "all closed"
- Audit trail per reviewer (who approved, when, with what notes)

Reviewers = Maxons team: you + sales + ops/logistics. ~3-5 admin users with shared queue.

### 3. Background-check workflow scaffolding

V1's queue captures basic info + a free-text note. V3 needs structured background-check fields per applicant:

- ✅ Business registration verified (Y/N + notes + reference URL)
- ✅ LinkedIn profile verified (Y/N + URL)
- ✅ Company website verified (Y/N + URL)
- ✅ References checked (count + notes)
- ✅ Trade history reviewed (Y/N + sample shipments)
- ✅ WhatsApp confirmation (Y/N + date)

These are **fields, not gates.** Reviewer can approve without all checked, but the trail is there.

### 4. The "AI sells the upgrade" mechanic

When guest hits 10 deep outputs OR registered hits the verified-tier wall, the AI itself says it — not a popup. Backend:

- AI-side gate detection: when generating a response that would normally include execution-grade intel (real-time prices, supplier names, position reports), instead return a structured "upgrade pitch" object
- Frontend renders the pitch inline in chat: *"I see you're looking for serious data. Quick signup unlocks deeper analytics + saves your conversation history. Email or WhatsApp?"*
- Signup form is a chat-style modal, not a separate page

### 5. Role-aware data scope (the actual product unlock)

Today V1's RBAC is `viewer/member/admin/owner` permissions. V3 also needs **role-driven content** — same query gives different answers to buyer vs supplier vs broker. This affects:

- AI agent's knowledge prompt (system prompt varies by role)
- Dashboard widgets shown
- Position reports filtered (a buyer doesn't see another buyer's positions)

**Phase 1.3 ships only the role capture + storage.** Role-aware content is Phase 1.10 (Zyra) + Phase 1.11 (prescriptions).

---

## Build sequence — concrete files for Phase 1.3 spec

### Foundation (can run in parallel with everything else)

1. **`supabase/migrations/<ts>_phase_1_3_auth_foundation.sql`** — creates:
   - `profiles` (extends V3's foundation — already exists; ADD missing columns: `role`, `verification_state`, `verification_state_changed_at`, `verification_assigned_to`, `geography_country`, `geography_city`, `business_type`, `annual_volume`, etc.)
   - `user_roles` (port from V1)
   - `guest_sessions` (NEW — guest_id, deep_outputs_count, role_inferred, geography_inferred, conversation_history JSONB)
   - `verification_requests` (NEW — replaces V1's free-text — assigned_to, status, structured background-check fields)
   - RLS policies on all the above

2. **Port V1 edge functions** (read-only port, no behavior changes):
   - `supabase/functions/auth-email-hook/`
   - `supabase/functions/whatsapp-login/`
   - `supabase/functions/send-whatsapp-otp/`
   - `supabase/functions/verify-whatsapp-otp/`
   - `supabase/functions/email-otp-eligibility/`

### Frontend port

3. **`src/pages/Auth.tsx`** — port from V1, strip April 1 deadline logic, replace 5-min guest timer with 10-deep-output gate. Keep all the hardcoded constants (port lists, products, business types, etc.).

4. **`src/hooks/useAuth.tsx`** — port unchanged.

5. **`src/lib/zyraRBAC.ts`** — port unchanged. Map V1's 4-tier (viewer/member/admin/owner) to V3's 3-tier (registered/verified/admin):
   - V1 `viewer` → V3 `registered`
   - V1 `member` → V3 `registered` (verified subscribers get all member commands)
   - V1 `admin` + `owner` → V3 `admin`
   - Plus a new V3 tier: `verified` (registered + execution-grade data access)

6. **`src/components/admin/AdminVerificationQueue.tsx`** — port + extend:
   - Add "Assigned to" column
   - Add self-assign button
   - Add "My queue" filter
   - Add structured background-check checklist instead of free-text note

7. **`src/hooks/useGuestSession.ts`** — REWRITE for interaction counting:
   - Replace 5-min timer with `deep_outputs_count` check
   - Persist to `guest_sessions` table (server-side)
   - Provide `incrementDeepOutput()` function for AI agent to call
   - Provide `isGated()` function for AI agent to check before producing deep output

### New for V3

8. **`src/components/landing/AIAgentLanding.tsx`** (NEW — placeholder until Phase 1.10) — minimal landing page with hybrid starter (3 buttons + chat input). On engage, creates guest session, opens chat. Phase 1.10 will replace the chat handler with real Zyra; for Phase 1.3 it's just `"Phase 1.10 will give you the real AI here"` with the gate logic working.

9. **`src/components/landing/UpgradePitch.tsx`** (NEW) — the inline chat-style "AI sells the upgrade" component.

10. **`src/lib/guest-gate.ts`** (NEW) — gate logic:
    - `canProduceDeepOutput(guestId): boolean`
    - `recordDeepOutput(guestId, contentType): void`
    - `getUpgradePitchContent(guestId, attemptedContentType): UpgradePitch`

11. **`src/pages/AdminVerificationQueue.tsx`** — page wrapping the component (multi-reviewer with filters).

### Routes + RouteGuard

12. **`src/lib/RouteGuard.tsx`** — enforces tier per route:
    - `/` — public, AI agent landing
    - `/chat/*` — guest OK (gated by deep_outputs_count), registered OK, verified OK
    - `/insights/basic` — registered OK, verified OK
    - `/insights/execution` — verified OK only
    - `/admin/verified-queue` — admin OK only
    - `/admin/*` — admin OK only

### Tests

13. **`e2e/phase-1.3-auth.spec.ts`**:
    - (a) Guest lands, sees AI agent landing.
    - (b) Guest produces 10 deep outputs, gate fires soft-wall.
    - (c) Guest signs up via email OTP → becomes registered.
    - (d) Registered hits execution-grade wall → AI pitches verification.
    - (e) Registered submits verification request → lands in admin queue.
    - (f) Admin self-assigns → completes background check checklist → approves → user becomes verified_buyer.
    - (g) RouteGuard blocks /admin from non-admin.

---

## What this brief explicitly says we're NOT doing in Phase 1.3

- Building the actual AI agent / Zyra (Phase 1.10).
- Building hyper-personalized prescriptions (Phase 1.11).
- Building the multi-portal frontend (Phase 1.7).
- Building Adela data spine (Phase 1.6).
- Adding multi-commodity beyond schema readiness (V1.5).
- Building CRM admin features — offers, inquiries, contracts (Phase 2).
- Building external portals (Phase 3).
- Touching MAXONS App territory (forever out of scope).

---

## Realistic Builder time estimate

Based on calibration data from yesterday's specs:
- Foundation SQL migrations: 5-10 min
- Port V1 edge functions: 10-15 min (mostly copy + adjust env vars)
- Port `Auth.tsx` + `useAuth.tsx`: 15-20 min
- New guest session + gate logic: 10-15 min
- New admin queue with multi-reviewer: 15-20 min
- New landing page + upgrade pitch: 10-15 min
- 7 e2e tests: 10-15 min
- Total Builder time: **75-110 min** (could split into 2 specs if Builder reaches a complexity ceiling)

Cost estimate: ~$15-25.

---

## Recommended split — ship Phase 1.3 as TWO specs

**Spec 1.3a — Auth foundation (60 min Builder)**
- All 12 files in build sequence above EXCEPT the AI-agent landing.
- Ports V1 auth, ships RBAC, multi-reviewer queue, guest session table.
- Acceptance: registered user can sign up via 4 methods, get assigned tier, request verification, admin can approve, RouteGuard enforces tiers.

**Spec 1.3b — AI-agent landing scaffold (45 min Builder)**
- AIAgentLanding.tsx + UpgradePitch.tsx + guest-gate.ts
- Hybrid starter, 10-output gate, soft-wall, AI-pitch component.
- Phase 1.10 will replace the chat handler later.
- Acceptance: guest lands, sees AI greeting + 3 starters + free input, can chat (returns placeholder responses), gate fires after 10 deep outputs.

Two specs = better Verifier auditability, better Designer review, lower risk if one fails.

---

## Open question for spec writer

**Where should `guest_sessions` live — Supabase table or Redis?**
- Supabase: persists across devices, queryable for analytics, cheap. Recommended.
- Redis: faster, ephemeral, but adds infrastructure. Skip.

→ **Supabase table** unless someone has a specific reason otherwise.
