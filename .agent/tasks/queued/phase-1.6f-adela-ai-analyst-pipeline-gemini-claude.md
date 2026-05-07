---
primary-domain: research
---
```markdown
---
phase: phase-1.6f
model: claude-sonnet-4-5
status: draft
owner: adela
---

# Task: Phase 1.6f — Adela AI Analyst Pipeline (Gemini + Claude)

**Master plan reference:** CropsIntel V3 Master Plan §4.3 "Adela Analyst Layer" — final sub-phase (5 of 5) of Adela bring-up. Predecessors: 1.6a (Supabase schema), 1.6b (position_reports ingestion), 1.6c (atlas_dispatches audit layer), 1.6d (atlas_cost_log schema), 1.6e (Adela scaffolding + env wiring).

**Estimated effort:** 3 developer days

**Model:** claude-sonnet-4-5

---

## Goal

Create the Adela AI analysis pipeline that transforms raw commodity position reports into structured market intelligence. The pipeline:

1. Reads `position_reports` rows from Supabase for the last 7 days.
2. Sends the aggregated data to **Gemini Pro** to extract structured market signals: `demand_strength`, `supply_tightness`, `price_direction`, `key_markets`.
3. Passes those signals to **Claude Sonnet** to author a 200–300 word plain-English market brief (no jargon).
4. Upserts the result into the `ai_analyses` table (`analysis_date`, `model_used`, `input_data`, `signals jsonb`, `brief text`, `confidence_score`).
5. Writes a completion audit record to `atlas_dispatches`.
6. Tracks LLM costs — after every API call, writes a row to `atlas_cost_log` (`tokens_in`, `tokens_out`, `cost_usd`, `model`).

Three files are delivered: the pipeline itself (`ai-analyst.ts`) and two typed client wrappers with retry logic (`gemini-client.ts`, `anthropic-client.ts`).

---

## Files

| Path | Purpose |
|---|---|
| `adela/src/analyst/ai-analyst.ts` | Orchestrates the 5-step pipeline end-to-end |
| `adela/src/lib/gemini-client.ts` | Typed Gemini Pro wrapper — retry (3×, exponential backoff), cost tracking |
| `adela/src/lib/anthropic-client.ts` | Typed Anthropic Claude wrapper — retry (3×, exponential backoff), cost tracking |

### `adela/src/lib/gemini-client.ts`

```typescript
// Exports:
export interface GeminiResponse<T> {
  data: T;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export async function geminiGenerate<T>(
  prompt: string,
  schema: ZodSchema<T>,
  opts?: { maxRetries?: number }
): Promise<GeminiResponse<T>>
```

- Model string sourced from `GEMINI_MODEL` env var (default `gemini-1.5-pro`).
- Retry: up to 3 attempts, backoff 1 s → 2 s → 4 s.
- After each **successful** call writes one row to `atlas_cost_log`.
- Throws `GeminiClientError` (typed) on exhausted retries.

### `adela/src/lib/anthropic-client.ts`

```typescript
export interface AnthropicResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export async function claudeComplete(
  systemPrompt: string,
  userMessage: string,
  opts?: { maxRetries?: number; maxTokens?: number }
): Promise<AnthropicResponse>
```

- Model string sourced from `ANTHROPIC_MODEL` env var (default `claude-sonnet-4-5`).
- Retry: up to 3 attempts, backoff 1 s → 2 s → 4 s.
- After each **successful** call writes one row to `atlas_cost_log`.
- Throws `AnthropicClientError` (typed) on exhausted retries.

### `adela/src/analyst/ai-analyst.ts`

```typescript
export interface MarketSignals {
  demand_strength: 'low' | 'medium' | 'high';
  supply_tightness: 'loose' | 'balanced' | 'tight';
  price_direction: 'falling' | 'stable' | 'rising';
  key_markets: string[];
}

export async function runAiAnalyst(): Promise<void>
```

Pipeline steps (all errors propagate — no silent swallowing):

1. Query `position_reports` WHERE `report_date >= now() - interval '7 days'`.
2. Call `geminiGenerate<MarketSignals>(...)` — validated via Zod schema.
3. Call `claudeComplete(...)` — assert word count 180–320 (soft bounds).
4. Upsert into `ai_analyses` using `analysis_date = today()` as conflict key.
5. Insert into `atlas_dispatches` (`event = 'ai_analyst_complete'`, `payload = { analysis_date, confidence_score }`).

---

## Architecture

```
Supabase (position_reports)
        │
        ▼
  ai-analyst.ts
  ┌─────────────────────────────────┐
  │ 1. fetch last-7-days rows       │
  │ 2. gemini-client ──► Gemini Pro │ ──► signals: MarketSignals
  │ 3. anthropic-client ► Claude    │ ──► brief: string
  │ 4. upsert ai_analyses           │
  │ 5. insert atlas_dispatches      │
  └─────────────────────────────────┘
        │                │
        ▼                ▼
  atlas_cost_log   atlas_dispatches
  (per LLM call)   (completion audit)
```

Both clients write to `atlas_cost_log` independently and are unaware of each other. The analyst orchestrates sequentially (not concurrently) to keep cost records ordered and avoid partial-write ambiguity.

---

## Success criteria

1. **Pipeline runs end-to-end without error** when `position_reports` contains ≥ 1 row dated within the last 7 days.
2. **`ai_analyses` upsert succeeds**: row exists after run with non-null `signals` (valid JSON matching `MarketSignals` shape), `brief` word count between 180 and 320, `confidence_score` between 0.0 and 1.0.
3. **`atlas_dispatches` record created**: event `ai_analyst_complete` row present with today's `analysis_date` in payload.
4. **Cost log populated**: exactly 2 new rows in `atlas_cost_log` per pipeline run (one Gemini, one Claude), each with `tokens_in > 0`, `tokens_out > 0`, `cost_usd > 0`.
5. **Retry logic exercised**: unit test simulates a single transient API failure; pipeline recovers and completes on second attempt; cost log contains exactly 1 row (failed attempt does NOT write cost).
6. **Empty data guard**: when `position_reports` returns 0 rows, pipeline exits early with a logged warning and writes NO rows to `ai_analyses`, `atlas_dispatches`, or `atlas_cost_log`.
7. **TypeScript compiles cleanly**: `tsc --noEmit` passes with zero errors.
8. **No secrets in source**: API keys read exclusively from environment variables; no key string appears in committed code.

---

## Risks + mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Dependency not shipped**: `position_reports`, `ai_analyses`, `atlas_dispatches`, `atlas_cost_log` tables may not exist if phases 1.6a–1.6d were not completed. | Medium | Blocking | Verify table existence in a pre-flight check at pipeline startup; throw `DependencyError` with the missing table name. Document that 1.6a–1.6d are hard prerequisites. |
| R2

## NEVER list

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- Never violate master plan §11.6 invariants.
- Never ship without verifying `npm run build` is clean.
