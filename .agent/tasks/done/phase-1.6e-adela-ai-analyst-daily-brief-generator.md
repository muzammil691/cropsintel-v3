---
primary-domain: analytical
---
```markdown
---
phase: phase-1.6e
model: claude-sonnet-4-5
status: draft
---

# Task: Phase 1.6e — Adela AI Analyst (Daily Brief Generator)

**Master plan reference:** CropsIntel V3 Master Plan §1.6 "Adela Intelligence Layer" — daily AI analyst that converts raw scraper output into trader-ready briefs.
**Estimated effort:** 1 session (~3–4 hours), single file plus tests.
**Model:** claude-sonnet-4-5 (narrative brief) + gemini-2.0-flash (signal extraction)

---

## Goal

Complete the Adela AI analyst module so that, after scrapers have populated data for the day, a single invocation of `adela/src/ai-analyst.ts`:

1. Fetches the latest `position_reports` rows (today or most recent), `strata_prices` (latest snapshot), and `market_news` (last 48 hours) from Supabase.
2. Builds a structured context object from the fetched data.
3. Sends the context to **Gemini Flash** for market signal extraction — identifying the top 3 price signals, demand trends per market, and anomalies.
4. Sends the Gemini output plus the raw context to **Claude Sonnet** for narrative brief generation — a 3–5 sentence executive summary suitable for a commodity trader.
5. Upserts the result into the `ai_analyses` table with fields: `report_date`, `signals` (jsonb), `brief_text`, `model_used`, `tokens_in`, `tokens_out`, `cost_usd`.
6. Logs the API cost to `atlas_cost_log` via Supabase.
7. Exits cleanly with a warning log when guard conditions are not met — never fabricates data.

---

## Architecture

### Module: `adela/src/ai-analyst.ts`

```
┌─────────────────────────────────────────────────────────────────┐
│                        ai-analyst.ts                            │
│                                                                 │
│  run()                                                          │
│   │                                                             │
│   ├─ 1. fetchData()        → { positionReports, strataPrices,  │
│   │                            marketNews }                     │
│   │       └─ GUARD: no position_reports for current week        │
│   │              → log warning, return early                    │
│   │                                                             │
│   ├─ 2. buildContext()     → AnalystContext (typed object)      │
│   │                                                             │
│   ├─ 3. extractSignals()   → signals: MarketSignal[]            │
│   │       └─ Gemini Flash primary                               │
│   │          retry once on failure                              │
│   │          fallback to Claude Sonnet on second failure        │
│   │                                                             │
│   ├─ 4. generateBrief()    → brief_text: string                 │
│   │       └─ Claude Sonnet (receives signals + raw context)     │
│   │                                                             │
│   ├─ 5. upsertAnalysis()   → ai_analyses row                    │
│   │                                                             │
│   └─ 6. logCost()          → atlas_cost_log row                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Types

```typescript
interface AnalystContext {
  reportDate: string;            // ISO date, e.g. "2026-05-06"
  positionReports: PositionReport[];
  strataPrices: StrataPrice[];
  marketNews: MarketNewsItem[];
}

interface MarketSignal {
  rank: number;                  // 1–3
  signal: string;
  market: string;
  direction: "up" | "down" | "neutral";
  confidence: number;            // 0.0–1.0
}

interface AiAnalysisRow {
  report_date: string;
  signals: MarketSignal[];       // stored as jsonb
  brief_text: string;
  model_used: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}
```

### Prerequisite Tables (must exist before this phase runs)

| Table | Owning Phase | Notes |
|---|---|---|
| `position_reports` | §1.4 Scraper Layer | RLS enabled |
| `strata_prices` | §1.4 Scraper Layer | RLS enabled |
| `market_news` | §1.5 News Scraper | RLS enabled |
| `ai_analyses` | **This task (migration required)** | Schema defined below |
| `atlas_cost_log` | §1.3 Cost Tracking | RLS enabled |

### `ai_analyses` Migration (included in this task)

```sql
create table if not exists public.ai_analyses (
  id            uuid primary key default gen_random_uuid(),
  report_date   date not null,
  signals       jsonb not null default '[]',
  brief_text    text not null,
  model_used    text not null,
  tokens_in     integer not null default 0,
  tokens_out    integer not null default 0,
  cost_usd      numeric(10,6) not null default 0,
  created_at    timestamptz not null default now(),
  unique (report_date)
);

alter table public.ai_analyses enable row level security;

create policy "service role full access"
  on public.ai_analyses
  for all
  to service_role
  using (true)
  with check (true);
```

---

## Files

```
adela/
└── src/
    └── ai-analyst.ts              # Main analyst module (new)
supabase/
└── migrations/
    └── 20260506_ai_analyses.sql   # Table + RLS migration (new)
```

No other files are modified. The module imports existing clients:
- `adela/src/lib/supabase.ts` — Supabase client (existing, from §1.3)
- `adela/src/lib/gemini.ts` — Gemini client (existing, from §1.6a–d)
- `adela/src/lib/claude.ts` — Claude client (existing, from §1.6a–d)

---

## Success criteria

Verifier checks all of the following:

1. **Data fetch** — `fetchData()` returns non-empty `positionReports` when Supabase contains rows for the current week; returns empty array and logs `WARN: no position_reports for current week` when none found.
2. **Guard exit** — When `positionReports` is empty for the current week, `run()` returns `{ status: "skipped", reason: "no_data" }` without calling any AI API.
3. **Context object** — `buildContext()` produces a fully typed `AnalystContext` with no `undefined` fields; report_date matches today's ISO date.
4. **Signal extraction** — `extractSignals()` returns exactly 3 `MarketSignal` objects with `rank` 1–3, each having a non-empty `signal`, `market`, and a valid `direction`.
5. **Gemini retry** — When Gemini fails on first attempt, a second attempt is made; when both fail, Claude is used for extraction, and `model_used` reflects `"claude-sonnet-4-5/fallback"`.
6. **Narrative brief** — `generateBrief()` returns a string of 3–5 sentences (verified by sentence-count assertion in tests).
7. **Upsert** — `ai_analyses` row is created or updated for today's `report_date`; all 7 schema fields are populated with non-null values.
8. **Cost log** — An `atlas_cost_log` entry is inserted containing the total `cost_usd` for the run, attributed to `"adela/ai-analyst"`.
9. **No fabrication** — Unit tests with mocked empty Supabase responses confirm no AI call is made and no row is written.
10. **No key leakage** — Static analysis (`grep -r "sk-\|AIza"`) finds

## Risks + mitigations

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- **Risk:** Council was unavailable, so draft may have gaps. **Mitigation:** review the spec carefully before queueing; refine ambiguous items.

## NEVER list

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- Never violate master plan §11.6 invariants.
- Never ship without verifying `npm run build` is clean.
