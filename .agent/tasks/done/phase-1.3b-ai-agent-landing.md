---
phase: 1.3b
title: AI agent landing scaffold + 10-deep-output gate UI (Phase 1.10 Zyra placeholder)
status: planned
gate: in-progress count <= 2 AND phase 1.3a shipped
order: 2-of-3 morning batch
estimated_builder_minutes: 35
estimated_cost_usd: 6
master_plan_section: 11.2 Phase 1.5 + Phase 1.10 scaffold
launch: v1.0-alpha
---

# Phase 1.3b — AI agent landing scaffold

## Why this exists

The product concept (locked with Muzammil 2026-05-09 morning):
- The AI agent IS the front door of cropsintel.com, not "with charts beside it"
- Hybrid starter: 3-4 prompts + free input chat box
- Direct, opinionated voice (Bloomberg-with-strong-views)
- Role + geography inferred from natural conversation
- 10 deep insights free for guests; basic chat unlimited
- At limit: AI sells the upgrade in-thread (no popup)
- Registered tier = saved history + more depth; Verified tier = execution-grade intel

Master plan ties this to:
- **Phase 1.5** "Public landing + market-insight pages" (1 week per master plan §11.2)
- **Phase 1.10** "Zyra customer chat (R1 — server-side via edge function, Claude default, ElevenLabs voice). **Phase 1 ships 13 Zyra modules** (defensive 9 + behavioral 4 per v1.4)"

This spec ships the **scaffold + gate UX**. Phase 1.10 replaces the placeholder chat handler with the real 13-module Zyra. The gate, layout, upgrade pitch, and conversion flow all work today; the AI brain comes later.

## The 5 rules check (V3-CODING-INSTRUCTIONS §0)

1. **Foundation-first.** Uses `guest_sessions` table from 1.3a. Adds `chat_sessions` for registered users. No parallel auth/profile tables.
2. **Anti-restart.** Replaces whatever's at `/` route in place. New components live in `src/components/landing/`.
3. **Multi-commodity from Day 1.** Role-geo inference scaffold structures answers around `commodity_id` even in placeholders. Almonds is hardcoded today; pistachio/walnut activate via flag.
4. **AI keys server-side only.** Placeholder responses don't call AI yet, but the architecture (`atlas/src/server.ts` endpoints) routes through edge function shape so Phase 1.10 swap is clean. Zero `VITE_AI_*` keys.
5. **Information walls.** A guest never sees registered-tier data; registered never sees verified-tier data. Gate enforced server-side, never trust the client.

## Foundation-first check

- ✅ `profiles` extended with verification fields (1.3a)
- ✅ `guest_sessions` table exists (1.3a)
- ✅ `verification_requests` table exists (1.3a)
- ✅ Auth bridge endpoint exists (1.3a)
- ✅ All 4 form components exist (1.3a)
- ✅ RouteGuard supports `requireTier` and `requireRole` (1.3a)
- ✅ useAuth exposes `tier`, `verificationState`, `roles` (1.3a)
- ❓ Landing page UI — net new
- ❓ Guest gate API endpoints — net new

## What ships

### 1. Migration — chat_sessions for registered users

`supabase/migrations/<ts>_phase_1_3b_chat_sessions.sql`:

```sql
CREATE TABLE public.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  summary text,
  conversation_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  deep_outputs_count int NOT NULL DEFAULT 0,
  geography_country text,
  role_active text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_sessions_user ON public.chat_sessions(user_id, last_message_at DESC);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own chat sessions"
  ON public.chat_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "users write own chat sessions"
  ON public.chat_sessions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "team/admin read all chat sessions"
  ON public.chat_sessions FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE TRIGGER trg_chat_sessions_updated_at BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### 2. Backend — Zyra placeholder edge function + guest gate

**Per master plan section 10**: Zyra is server-side via edge function, NOT in `atlas/src/server.ts`. Atlas conductor is internal infra; Zyra is customer-facing.

`supabase/functions/zyra-chat/index.ts` (new — placeholder for Phase 1.10):
- Accepts: `{ guest_id?: string, user_id?: string, message: string, conversation_history: Message[] }`
- Returns: `{ response: string, is_deep_output: boolean, role_inferred?: string, geography_inferred?: string, upgrade_pitch?: UpgradePitch }`
- Logic for 1.3b (placeholder):
  - Detect "deep" via keyword match (price, supplier, buyer, market, forecast, India, US, China, Spain, Australia, packer, broker, arbitrage, position, yield, tariff)
  - Return canned response: *"[Phase 1.10 will give you the real intelligence here. For now: <generic-helpful-response>]"*
  - Infer role from keywords ("buying"/"importing" → customer; "exporting"/"packer" → packer; "broker"/"arbitrage" → broker)
  - Infer geography from country mentions
  - If deep AND guest count >= 10 → return upgrade pitch
  - If deep AND user is registered (not verified) AND keyword in execution-grade list ("real-time", "live", "supplier names", "position report") → return verified-tier upgrade pitch

`supabase/functions/guest-gate/index.ts` (new):
- `POST /functions/v1/guest-gate/start` — creates `guest_sessions` row, returns `{ guest_id, deep_outputs_count: 0, limit: 10 }`
- `POST /functions/v1/guest-gate/record-deep` — body `{ guest_id, content_type }` → if count < 10, increment + return `{ ok: true, count: N }`; if >= 10, return `{ ok: false, gated: true, count: 10 }`
- `POST /functions/v1/guest-gate/record-basic` — body `{ guest_id }` → increment basic_chat_count
- `GET /functions/v1/guest-gate/state` — query `?guest_id=X` → returns full state
- `POST /functions/v1/guest-gate/convert` — body `{ guest_id, user_id }` → sets `converted_to_user`, links

**NOT** put in `atlas/src/server.ts`. This is customer-facing — must be on Supabase edge functions for the `cropsintel.com` traffic path.

### 3. Frontend — Landing + chat components

**`src/pages/Landing.tsx`** (new — replaces whatever's at `/`):

Layout (full-screen, dense, premium Bloomberg vibe):
- **Hero left rail (~40% width on desktop, hidden/collapsed mobile):** brand mark "CropsIntel" + tagline ("The AI agent for almond markets. Direct, data-driven, opinionated.") + small "Already a user? Sign in →" link
- **Chat panel right (~60% width):**
  - AI greeting at top: *"Welcome. I'm CropsIntel — I track almond markets globally and I'll tell you what I actually think. Are you buying, selling, trading, or just curious?"*
  - 4 starter chips: *"I'm buying for India"*, *"I'm a US packer looking at exports"*, *"I'm a broker watching arbitrage"*, *"Just exploring"*
  - Free input box: *"Ask anything about almond markets..."*
  - Counter (`InsightCounter` component): `0 / 10 deep insights used` — guest only

On mount:
- Call `useGuestSession.startGuestSession()` if no `guest_id` cookie
- Greeting comes from edge function call
- Click starter or type → `useGuestSession.sendMessage()` → edge function → render response

If user is authenticated (registered or verified): hide counter, show "Saved sessions" link instead. Use chat_sessions for persistence.

**`src/components/landing/ChatConversation.tsx`** (new):
- Renders message thread (user bubbles right, AI bubbles left)
- Bottom-aligned scroll
- "Atlas is thinking..." indicator (reuse from cockpit) for ~1s before AI response
- Each AI response is rendered with optional "Deep insight" badge
- Markdown rendering for AI responses (use existing markdown lib)

**`src/components/landing/InsightCounter.tsx`** (new):
- Shows `{count} / 10 deep insights used`
- Color: emerald (0-5), amber (6-8), rose (9-10)
- Hidden when `useAuth().tier !== 'guest'`

**`src/components/landing/UpgradePitchInline.tsx`** (new):
- Renders inside chat thread when AI response includes `upgrade_pitch` field
- Shape:
  ```
  AI: "I see you're getting real value here — you've used your 10 deep insights.
       Quick signup unlocks unlimited insights + saves your conversation history.
       Email or WhatsApp?"
  
  [Email →]   [WhatsApp →]
  ```
- Click button → navigate to `/auth?mode=register&method=<email|whatsapp>&from=landing`
- Conversation context preserved via guest_id cookie

**`src/components/landing/UpgradeToVerifiedInline.tsx`** (new):
- For registered users hitting execution-grade walls
- AI says: *"This needs verified-tier access — real-time prices, supplier names, position reports. I can put you in the queue. Tap below and someone from Maxons will follow up within 24 hours."*
- Button: "Request verification" → POST to verification queue, redirects to `/profile/verification-status` (Phase 1.3a admin queue picks it up)

**`src/components/landing/StarterChips.tsx`** (new):
- 4 pre-written starter prompts as chips
- Click → calls `sendMessage` with the prompt as user input

**`src/lib/role-geo-inference.ts`** (new — placeholder):
- `inferRole(message: string): AppRoleType | null` — keyword matching
- `inferGeography(message: string): { country?: string, city?: string }` — country list from `data/countryCityData.ts` (port from V1)
- Phase 1.10 replaces these with Claude classification

**`src/data/countryCityData.ts`** (port from V1's `almond-oracle`) — full ALL_COUNTRIES list + getCitiesForCountry helper.

**`src/hooks/useGuestSession.ts`** (extend the 1.3a stub or implement if 1.3a left it as basic):
- `startGuestSession()` — POST to guest-gate edge function
- `sendMessage(content: string, isStarter?: bool)` — calls zyra-chat edge function, updates conversation_history client-side, sends to gate function
- `recordDeepOutput()` — bumps count
- `convertToUser(userId: string)` — links session

### 4. Routes update (extend `App.tsx`)

```tsx
<Route path="/" element={<Landing />} />
```

Replaces the existing `/` route. If a logged-in user hits `/`, the Landing detects auth state and shows registered-tier UI instead of guest UI (no upgrade counter, "Saved sessions" link, etc.).

### 5. Tests

`e2e/phase-1.3b-landing.spec.ts`:

- (a) Anonymous visit `/` → CropsIntel branding + greeting + 4 starters + input visible.
- (b) Click "I'm buying for India" → conversation starts; verify guest_session row has `role_inferred: 'customer'`, `geography_country_inferred: 'India'`.
- (c) Send 10 deep messages → counter advances 1...10.
- (d) Send 11th deep query → AI response includes upgrade pitch with Email + WhatsApp buttons.
- (e) Click Email button → URL is `/auth?mode=register&method=email&from=landing`.
- (f) Sign up → return to `/`, conversation continues from same session.
- (g) Registered user sends "show me real-time California prices" → AI responds with verified-tier upgrade pitch.
- (h) Verified user sends same query → AI responds with placeholder real-data scaffold (no upgrade pitch).
- (i) Anonymous user sends 100 basic chat messages (no keywords) → counter stays at 0; basic_chat_count is high in DB.

## Acceptance criteria

- All 5 rules satisfied.
- Landing renders at `/` for anonymous; for authenticated, renders tier-aware version.
- Hybrid starter (4 prompts + free input) works.
- Counter visible for guests, hidden after signup.
- Deep output detection (keyword-based for 1.3b) works.
- Soft wall fires at 10 deep, AI sells upgrade in-thread.
- Role + geography captured into guest_session row.
- After signup, conversation continues (session migrated via `convertToUser`).
- Verified-tier upsell fires for registered users on execution-grade keywords.
- 9 e2e tests pass.
- `npm run build` clean.
- Spec lands in `done/`.

## Out of scope

- Real Claude-powered Zyra brain (Phase 1.10 ships 13 modules per master plan v1.4).
- Real-time price data display (Phase 1.6 Adela ships data spine).
- Hyper-personalized prescriptions (Phase 1.11).
- Multi-language landing (English first; i18n is Phase 1.12).
- Voice input/output (defer).
- Saved chat history full UI for registered users (data only — page comes in Phase 1.9 dashboard).
- Mobile-optimized layout (responsive but not native PWA — that's Phase 1.13).

## Manual steps (Muzammil-side)

1. After spec ships, run `npx supabase db push` to apply chat_sessions migration.
2. Deploy edge functions: `npx supabase functions deploy zyra-chat` and `npx supabase functions deploy guest-gate`.
3. After migrations apply, regenerate types: `npx supabase gen types typescript --project-id hzrnohsxigrqlmzegwlb > src/lib/database.types.ts`
4. Verify on localhost.

Document in `docs/phase-1.3b-manual-steps.md`.

## Files touched (estimate)

- 1 new SQL migration (chat_sessions ~50 lines)
- 2 new edge functions (zyra-chat, guest-gate)
- 1 new page (Landing.tsx)
- 6 new components in `src/components/landing/`
- 1 new lib (role-geo-inference.ts)
- 1 ported data file (countryCityData.ts from V1)
- useGuestSession.ts implementation
- App.tsx route update
- 1 e2e test file

Total: **~13 files**

## Realistic Builder time

UI-heavy but smaller than 1.3a. **30-40 min Builder**, ~5 min Verifier, ~7 min Designer (UI-heavy). Wall clock ~50-60 min. Cost ~$5-8.

## Dependencies

- 1.3a shipped (auth + RBAC + guest_sessions table)
- V1 repo accessible for `data/countryCityData.ts` port
