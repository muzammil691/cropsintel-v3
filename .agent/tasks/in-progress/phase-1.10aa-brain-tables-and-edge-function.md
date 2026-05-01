---
priority: 2
depends-on:
  - phase-1.10z-atlas-events-and-dratlas-sdk
---

# Task: Phase 1.10aa — brain tables + brain-ai edge function (Multi-Brain backend)

**Master plan reference:** §1.6 Atlas; §11.3 Phase 2.11 (brought forward); user directive 2026-05-01: complete Atlas vision with 7-agent workflow.
**Context:** V1 had `brain_nodes` (48 rows), `brain_discussions` (299 rows), `brain_node_history` (23 rows), and a 826-line `brain-ai` edge function that ran Claude+GPT+Gemini debates with a Consensus judge that produced "Lovable-ready" prompts. Atlas's existing `multi-brain.ts` lib (1.10c) does in-process debate, but there's no UI surface to SEE debates. This spec is the backend half — tables + edge function — that powers `/atlas-brain` (built in 1.10ab).
**Estimated effort:** ~75 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

1. Three new tables (`brain_nodes`, `brain_discussions`, `brain_node_history`) in V3 Supabase, RLS-protected to admin/team only.
2. Supabase edge function `brain-ai` that exposes:
   - `POST /brain-ai` body `{ action: 'debate' | 'consensus', node_id, prompt, context? }` — invokes the multi-brain pipeline and persists results.
3. Wiring: when a brain debate runs, write turns to `brain_discussions`; when consensus is reached, append a `brain_node_history` row with score change.
4. Reuse Atlas's existing `multi-brain.ts` library where possible — share the model invocation logic; this spec adds the *persistence* + *scoring* + *consensus prompt* layer.
5. Seed `brain_nodes` with a starter set covering the master plan's domain areas (e.g. "atlas-conductor-quality", "verifier-strict-gate", "designer-tokens", "memory-recall-accuracy", "adela-scrape-freshness", "zyra-prompt-defense", "rls-information-walls").

## Schema

```sql
-- supabase/migrations/20260501060000_brain_tables.sql
CREATE TABLE IF NOT EXISTS public.brain_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_key text UNIQUE NOT NULL,        -- 'atlas-conductor-quality'
  label text NOT NULL,
  description text,
  category text,                         -- 'agent' | 'product' | 'infra' | 'process'
  status text NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'archived'
  score numeric(5,2) DEFAULT 0,          -- 0..100
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.brain_discussions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES public.brain_nodes(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL,               -- groups messages within a single debate
  author text NOT NULL,                  -- 'human' | 'claude' | 'gpt' | 'gemini' | 'consensus'
  message_type text NOT NULL DEFAULT 'comment', -- 'prompt' | 'comment' | 'ai_analysis' | 'consensus' | 'decision'
  content text NOT NULL,
  cost_usd numeric(10,4) DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.brain_node_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES public.brain_nodes(id) ON DELETE CASCADE,
  score_before numeric(5,2),
  score_after numeric(5,2),
  reason text NOT NULL,
  changed_by text NOT NULL,              -- 'human:<user_id>' | 'consensus' | 'auto'
  related_thread_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE brain_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_discussions ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_node_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brain_nodes_admin_team" ON brain_nodes FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE POLICY "brain_discussions_admin_team" ON brain_discussions FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE POLICY "brain_node_history_admin_team" ON brain_node_history FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));

CREATE INDEX idx_brain_discussions_node_thread ON brain_discussions (node_id, thread_id, created_at);
CREATE INDEX idx_brain_node_history_node ON brain_node_history (node_id, created_at DESC);

-- Seed starter brain nodes
INSERT INTO public.brain_nodes (node_key, label, description, category, score) VALUES
  ('atlas-conductor-quality', 'Atlas conductor quality', 'How well does Atlas decide what to build next?', 'agent', 70),
  ('verifier-strict-gate', 'Verifier strict gate', 'Tightness of Verifier audits + remediation accuracy', 'agent', 80),
  ('designer-tokens-enforcement', 'Designer tokens enforcement', 'Adherence to design system tokens across UI', 'agent', 50),
  ('memory-recall-accuracy', 'Memory recall accuracy', 'Quality of memory.search results', 'agent', 65),
  ('adela-scrape-freshness', 'Adela scrape freshness', 'How current is the market data Adela ingests', 'agent', 0),
  ('zyra-prompt-defense', 'Zyra prompt defense', 'Resistance to prompt injection / jailbreak', 'agent', 0),
  ('rls-information-walls', 'RLS information walls', 'Are customer/broker/supplier data walls enforced?', 'process', 75),
  ('build-loop-throughput', 'Build loop throughput', 'Specs shipped per hour by Builder', 'infra', 85),
  ('cost-budget-discipline', 'Cost budget discipline', 'Stay under $400/mo AI spend', 'process', 95)
ON CONFLICT (node_key) DO NOTHING;
```

## Edge function: brain-ai

`supabase/functions/brain-ai/index.ts` — Deno runtime, ~600 lines target. Key functions:

- `runDebate(nodePrompt, models)` — invokes Claude Opus 4.7 + GPT-4o + Gemini 2.5 Pro in parallel (fan-out), returns 3 opinions
- `runConsensus(opinions, judge='gpt-4o')` — judge model produces unified verdict + structured output
- `persistDebate(nodeId, threadId, opinions, consensus)` — writes to `brain_discussions` + optionally updates `brain_nodes.score` + `brain_node_history`

System prompts mirror V1's pattern (consensus judge produces "Lovable-ready prompt" — adapt to "spec-ready prompt" format compatible with Builder).

Cost log per call to `atlas_cost_log` (Anthropic + OpenAI + Google).

API:
- `POST /brain-ai` body `{ action: 'debate', node_id, prompt }` → starts debate, returns `thread_id` + streams SSE events (`opinion_received`, `consensus_received`, `done`)
- `POST /brain-ai` body `{ action: 'consensus', node_id, thread_id }` → re-runs consensus on existing thread

CORS for V3 frontend. Auth: Supabase JWT verification.

## Wiring with Atlas's existing multi-brain.ts

`atlas/src/lib/multi-brain.ts` (created in 1.10c) handles in-process multi-brain calls used by the conductor and `atlas.draft_spec` tool. The new `brain-ai` edge function is ALSO a multi-brain caller but lives in Supabase (closer to the DB, used by the React UI directly).

To avoid duplication: extract the model-invocation logic into a shared TypeScript module that both can import. Recommended:
- `atlas/src/lib/multi-brain-core.ts` — model invocation (provider-agnostic)
- `atlas/src/lib/multi-brain.ts` — Atlas-specific wrappers (existing)
- `supabase/functions/brain-ai/_shared/multi-brain.ts` — Supabase edge function wrappers

OR if extraction is too invasive, just duplicate the ~150 lines of model invocation. Document the duplication explicitly so future updates touch both.

## Files

- `supabase/migrations/20260501060000_brain_tables.sql` (NEW)
- `supabase/functions/brain-ai/index.ts` (NEW)
- `supabase/functions/brain-ai/_shared/types.ts` (NEW)
- `supabase/functions/brain-ai/_shared/multi-brain.ts` (NEW or extracted from atlas/src/lib/multi-brain.ts)
- `atlas/src/lib/multi-brain-core.ts` (NEW — if extracting)
- `atlas/src/lib/multi-brain.ts` (refactor to use core if extracted)

## Success criteria

- Migration applies cleanly (`npx supabase db push`)
- 9 starter brain_nodes rows present
- `curl POST .../functions/v1/brain-ai -d '{"action":"debate","node_id":"<id>","prompt":"..."}' -H "Authorization: Bearer <jwt>"` returns SSE stream with 3 opinions + 1 consensus
- New `brain_discussions` rows: 4 per debate (3 opinions + 1 consensus); `brain_node_history` row added if score changed
- `atlas_cost_log` accumulates rows with providers `anthropic`, `openai`, `google`
- Atlas's existing `atlas.draft_spec` and conductor still work (no regression)

## Risks + mitigations

- **Risk:** Code duplication between Atlas service and Supabase edge fn. **Mitigation:** explicit doc comment; sync tests.
- **Risk:** Edge fn cold-start latency for 3-way debate. **Mitigation:** consensus judge runs only after all 3 opinions return; SSE keeps user informed.
- **Risk:** Cost burn — 3 models + 1 judge per debate ≈ $0.30-$0.50. **Mitigation:** budget gate via existing `cost-gate.ts`; rate-limit `/brain-ai` per user per minute.

## NEVER list

- Never invoke brain-ai without auth (admin/team only)
- Never expose API keys to client bundle
- Never persist debate without consensus judge running (incomplete debate could mislead)
