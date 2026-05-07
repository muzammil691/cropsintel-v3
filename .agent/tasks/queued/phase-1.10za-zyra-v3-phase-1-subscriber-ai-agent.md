---
primary-domain: frontend
---
```markdown
---
model: claude-sonnet-4.5
phase: phase-1.10za
title: Zyra V3 Phase 1 — Subscriber AI Agent (13-Module Orchestration)
status: proposed
---

# Task: Phase 1.10za — Zyra V3 Phase 1 Subscriber AI Agent

**Master plan reference:** CropsIntel V3 Master Plan §4.3 "Zyra Subscriber Agent" (port V1 26-module orchestration framework to V3; Phase 1 covers foundational 13 modules)

**Estimated effort:** 2.5–3 dev-days (justified: 13 modules × ~1–2 hrs each + widget + migrations + tests)

**Model:** claude-sonnet-4.5

---

## Goal

Port the proven Zyra V1 orchestration framework into CropsIntel V3 as a single Supabase edge function (`supabase/functions/zyra-v3/index.ts`), covering the 13 foundational Phase 1 modules that enforce data safety, RBAC, rate limiting, market grounding, and personalization. Deliver a subscriber-facing `ZyraWidget.tsx` (floating bottom-right, mobile-responsive, voice toggle via ElevenLabs, tier-aware quick prompts). Create required database tables via migration if not already present.

**In scope:**
- 13 modules: zyraDataBoundary, zyraInputSanitizer, zyraPromptDefense, zyraRBAC, zyraRateLimiter, zyraAuditLogger, zyraTradeParity, zyraIntelligenceLayer, zyraMemoryEngine, zyraPersonalityEngine, zyraNavigationIntelligence, zyraProactiveAlerts, zyraQualityTracker
- Tables: `zyra_conversations`, `zyra_memory`, `zyra_user_profiles`, `zyra_audit_log`
- Frontend widget: `src/components/zyra/ZyraWidget.tsx`

**Out of scope:** Modules 14–26 (Phase 2+), billing integration, fine-tuning.

**Dependency pre-checks (Builder must verify before writing module code):**
- `strata_prices` table exists and is populated → required by `zyraTradeParity`. If absent, stub module to return `{ skipped: true, reason: "strata_prices not shipped" }` and log a warning; do NOT hard-fail the pipeline.
- `position_reports` and `ai_analyses` tables exist → required by `zyraIntelligenceLayer`. Same stub pattern if absent.
- `atlas_dispatches` table exists → required by `zyraProactiveAlerts`. Same stub pattern if absent.
- All four Zyra tables (`zyra_conversations`, `zyra_memory`, `zyra_user_profiles`, `zyra_audit_log`) must be created by the migration in this spec before any module runs. Migration is NOT optional.

---

## Architecture

### Edge Function: `supabase/functions/zyra-v3/index.ts`

Request pipeline (modules execute in order):

```
Inbound request
  → zyraInputSanitizer        (strip injection / prompt-injection attempts)
  → zyraPromptDefense         (harden system prompt; prevent exfiltration)
  → zyraRBAC                  (resolve tier: guest/registered/verified/admin)
  → zyraRateLimiter           (guest=5/hr, registered=20/hr, verified=100/hr; reject HTTP 429 if exceeded)
  → zyraDataBoundary          (block any response path that would expose margins, logic, or contacts)
  → zyraMemoryEngine          (read zyra_memory WHERE user_id = auth.uid())
  → zyraPersonalityEngine     (load dr-atlas system prompt verbatim from V1 constant)
  → zyraIntelligenceLayer     (read position_reports + ai_analyses for market context — stub if not shipped)
  → zyraTradeParity           (price answers must cite strata_prices — stub if not shipped)
  → zyraNavigationIntelligence(inject V3 page map into context)
  → zyraProactiveAlerts       (query atlas_dispatches for fresh items — stub if not shipped)
  → [LLM call]
  → zyraAuditLogger           (write to zyra_conversations + zyra_audit_log)
  → zyraQualityTracker        (log quality signals to zyra_audit_log)
  → Return response
```

### Frontend: `src/components/zyra/ZyraWidget.tsx`

- Floating position: `fixed bottom-4 right-4 z-50`
- Shadcn primitives: `Button`, `Card`, `ScrollArea`, `Textarea`, `Badge`
- Tier-aware quick prompts: 4 tiers × 5 prompts each (20 total; resolved from auth context)
- Voice toggle: ElevenLabs TTS via `/api/elevenlabs/speak`; button with `aria-label="Toggle voice"`
- Accessibility: `role="dialog"`, `aria-label="Zyra AI Assistant"`, focus-trap on open, `focus-visible:ring-2`, all interactive elements keyboard-navigable, screen-reader labels on icon-only buttons
- Motion: `transition-colors duration-200`, `animate-fade-in` on open
- Responsive: mobile-first; full-screen on `sm` and below (`w-full h-full rounded-none`), floating card on `md+` (`w-96 h-[32rem] rounded-xl`)

### Database Migration: `supabase/migrations/YYYYMMDD_zyra_v3_tables.sql`

Creates (IF NOT EXISTS):
- `zyra_conversations` — columns: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id uuid REFERENCES auth.users NOT NULL`, `session_id uuid NOT NULL`, `role text NOT NULL CHECK (role IN ('user','assistant','system'))`, `content text NOT NULL`, `tier text NOT NULL`, `created_at timestamptz DEFAULT now()`; RLS policy: `user_id = auth.uid()`
- `zyra_memory` — columns: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id uuid REFERENCES auth.users NOT NULL`, `key text NOT NULL`, `value text NOT NULL`, `updated_at timestamptz DEFAULT now()`; RLS policy: `user_id = auth.uid()`; UNIQUE constraint: `(user_id, key)`
- `zyra_user_profiles` — columns: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id uuid REFERENCES auth.users NOT NULL UNIQUE`, `tier text NOT NULL DEFAULT 'registered'`, `preferences jsonb NOT NULL DEFAULT '{}'`, `updated_at timestamptz DEFAULT now()`; RLS policy: `user_id = auth.uid()`
- `zyra_audit_log` — columns: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id uuid REFERENCES auth.users`, `event_type text NOT NULL`, `payload jsonb NOT NULL DEFAULT '{}'`, `quality_signals jsonb NOT NULL DEFAULT '{}'`, `created_at timestamptz DEFAULT now()`; RLS policy: SELECT restricted to `auth.jwt() ->> 'role' = 'admin'`; INSERT allowed for authenticated users (service role only in prod)

---

## Files

| Path | Purpose |
|---|---|
| `supabase/functions/zyra-v3/index.ts` | Edge function orchestrator; imports and sequences all 13 modules |
| `supabase/functions/zyra-v3/modules/zyraDataBoundary.ts` | Block margin/logic/contact exposure |
| `supabase/functions/zyra-v3/modules/zyraInputSanitizer.ts` | Strip prompt injection |
| `supabase/functions/zyra-v3/modules/zyraPromptDefense.ts` | System prompt hardening |
| `supabase/functions/zyra-v3/modules/zyraRBAC.ts` | Tier resolution (guest/registered/verified/admin) |
| `supabase/functions/zyra-v3/modules/zyraRat

## Success criteria

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- `npm run build` clean
- <user-visible behavior 1>
- <test that proves it>

## Risks + mitigations

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- **Risk:** Council was unavailable, so draft may have gaps. **Mitigation:** review the spec carefully before queueing; refine ambiguous items.

## NEVER list

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- Never violate master plan §11.6 invariants.
- Never ship without verifying `npm run build` is clean.
