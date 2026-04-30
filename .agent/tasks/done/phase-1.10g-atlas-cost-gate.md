# Task: Phase 1.10g — Atlas cost gatekeeper

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §9 (cost gatekeeper) and master plan §10.3 ($400/mo cap with provider sub-budgets)
**Context:** Atlas tracks every AI call's cost in atlas_cost_log. Before any dispatch that incurs AI spend, check current burn against budget. Hard cap at $400 total/month; soft warning at 80%.
**Estimated effort:** ~30 min
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Implement `atlas/src/lib/cost-gate.ts` exporting:
- `checkBudget(estimatedCostUsd)` → returns `{ allow, reason, status }` where status ∈ `'ok' | 'warning' | 'paused' | 'blocked'`
- `getBurnRate()` → returns current burn snapshot (today, MTD, by provider)
- Hooks into the dispatcher (1.10d) so AI-spending tools auto-check before executing

## Budget rules (from master plan §10.3)

```
TOTAL    Anthropic   OpenAI    Gemini    ElevenLabs
$400     $200        $50       $50       $100   per month
```

Daily soft cap: $40 (3× normal day = ~$13). Above that, pause auto-dispatch for 1 hour.
Monthly soft warning: $320 (80% of $400).
Monthly hard cap: $400 → block all AI-spending dispatches; allow only chat reads.

Override mechanism: a `BUDGET_OVERRIDE_TOKEN` env var. If client passes header `X-Budget-Override: <token>`, gate is bypassed for that request only and logged.

## Implementation

### atlas/src/lib/cost-gate.ts

```ts
import { getSupabaseClient } from './supabase'

const MONTHLY_HARD_CAP = parseFloat(process.env.ATLAS_BUDGET_MONTHLY ?? '400')
const MONTHLY_WARNING_PCT = 0.80
const DAILY_PAUSE_THRESHOLD = parseFloat(process.env.ATLAS_BUDGET_DAILY_PAUSE ?? '40')
const PROVIDER_CAPS: Record<string, number> = {
  anthropic: parseFloat(process.env.ATLAS_BUDGET_ANTHROPIC ?? '200'),
  openai:    parseFloat(process.env.ATLAS_BUDGET_OPENAI ?? '50'),
  google:    parseFloat(process.env.ATLAS_BUDGET_GEMINI ?? '50'),
  elevenlabs: parseFloat(process.env.ATLAS_BUDGET_ELEVENLABS ?? '100'),
}

export interface BudgetCheck {
  allow: boolean
  status: 'ok' | 'warning' | 'paused' | 'blocked'
  reason?: string
  burnToday: number
  burnMonth: number
  budgetRemaining: number
}

export async function checkBudget(estimatedCostUsd: number, opts?: { provider?: string; overrideToken?: string }): Promise<BudgetCheck> {
  // Override path
  if (opts?.overrideToken && opts.overrideToken === process.env.BUDGET_OVERRIDE_TOKEN) {
    return {
      allow: true, status: 'ok',
      reason: 'override token accepted',
      burnToday: 0, burnMonth: 0, budgetRemaining: MONTHLY_HARD_CAP,
    }
  }

  const sb = getSupabaseClient()
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)

  const [todayQuery, monthQuery] = await Promise.all([
    sb.from('atlas_cost_log').select('cost_usd').gte('occurred_at', today.toISOString()),
    sb.from('atlas_cost_log').select('cost_usd, provider').gte('occurred_at', monthStart.toISOString()),
  ])

  const burnToday = (todayQuery.data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0)
  const burnMonth = (monthQuery.data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0)

  const burnByProvider = new Map<string, number>()
  for (const row of (monthQuery.data ?? [])) {
    burnByProvider.set(row.provider, (burnByProvider.get(row.provider) ?? 0) + Number(row.cost_usd))
  }

  const projected = burnMonth + estimatedCostUsd
  const projectedToday = burnToday + estimatedCostUsd
  const budgetRemaining = MONTHLY_HARD_CAP - burnMonth

  // Hard cap
  if (projected > MONTHLY_HARD_CAP) {
    return {
      allow: false, status: 'blocked',
      reason: `Monthly cap $${MONTHLY_HARD_CAP} would be exceeded ($${burnMonth.toFixed(2)} + $${estimatedCostUsd.toFixed(4)} > $${MONTHLY_HARD_CAP})`,
      burnToday, burnMonth, budgetRemaining,
    }
  }

  // Provider sub-cap
  if (opts?.provider) {
    const providerCap = PROVIDER_CAPS[opts.provider]
    const providerBurn = burnByProvider.get(opts.provider) ?? 0
    if (providerCap && providerBurn + estimatedCostUsd > providerCap) {
      return {
        allow: false, status: 'blocked',
        reason: `${opts.provider} sub-cap $${providerCap} would be exceeded ($${providerBurn.toFixed(2)} + $${estimatedCostUsd.toFixed(4)})`,
        burnToday, burnMonth, budgetRemaining,
      }
    }
  }

  // Daily soft pause
  if (projectedToday > DAILY_PAUSE_THRESHOLD) {
    return {
      allow: false, status: 'paused',
      reason: `Daily soft cap $${DAILY_PAUSE_THRESHOLD} reached ($${burnToday.toFixed(2)}). Auto-dispatch paused for 1 hour.`,
      burnToday, burnMonth, budgetRemaining,
    }
  }

  // Monthly warning
  if (projected > MONTHLY_HARD_CAP * MONTHLY_WARNING_PCT) {
    return {
      allow: true, status: 'warning',
      reason: `${Math.round(100 * projected / MONTHLY_HARD_CAP)}% of monthly budget consumed`,
      burnToday, burnMonth, budgetRemaining,
    }
  }

  return { allow: true, status: 'ok', burnToday, burnMonth, budgetRemaining }
}

export async function getBurnRate(): Promise<{
  today: number
  monthToDate: number
  byProvider: Record<string, number>
  capacity: number
}> {
  const sb = getSupabaseClient()
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)

  const [todayQuery, monthQuery] = await Promise.all([
    sb.from('atlas_cost_log').select('cost_usd').gte('occurred_at', today.toISOString()),
    sb.from('atlas_cost_log').select('cost_usd, provider').gte('occurred_at', monthStart.toISOString()),
  ])

  const burnToday = (todayQuery.data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0)
  const burnMonth = (monthQuery.data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0)
  const byProvider: Record<string, number> = {}
  for (const row of (monthQuery.data ?? [])) {
    byProvider[row.provider] = (byProvider[row.provider] ?? 0) + Number(row.cost_usd)
  }
  return {
    today: burnToday,
    monthToDate: burnMonth,
    byProvider,
    capacity: MONTHLY_HARD_CAP - burnMonth,
  }
}
```

### Wire into dispatch.ts

In `dispatch()`, before executing a tool that incurs AI spend (i.e., `council.write_spec`, `memory.search` if it triggers reranking, any chat call), call `checkBudget(estimatedCost)`. If status === 'blocked' or 'paused', return `status: 'blocked'` to caller. If status === 'warning', proceed but include warning in result metadata.

For v0.1, the dispatcher's tool-call estimate can be:
- `council.write_spec` → ~$0.10 estimate
- `memory.search` → ~$0.001 estimate  
- `verifier.audit` → 0 (Verifier handles its own cost)
- `chat` itself (in 1.10e) → estimated per request based on prompt+history length

Refine estimates based on observed data after v0.1.

### Add /atlas/costs endpoint

```ts
if (url === '/atlas/costs' && method === 'GET') {
  if (!authenticate(req)) { json(res, 401, { error: 'Unauthorized' }); return }
  json(res, 200, await getBurnRate())
  return
}
```

## Acceptance criteria

After this task ships:

1. `atlas/src/lib/cost-gate.ts` exists, exports `checkBudget` and `getBurnRate`.
2. `GET /atlas/costs` with Bearer auth returns JSON with today, monthToDate, byProvider, capacity.
3. Dispatcher rejects a synthetic over-budget call (e.g., `BUDGET_OVERRIDE_TOKEN` test where checkBudget returns blocked).
4. Smoke test: insert a fake $399 cost row, then try to dispatch council.write_spec — should be blocked with reason "Monthly cap $400 would be exceeded".

## Out of scope

- Budget alerts pinging WhatsApp at 80% (separate task; can hook into 1.10i snapshot cron)
- Per-day reset logic for "paused" state (just rely on the daily threshold check; if today's burn is below $40 again at midnight UTC, status flips to ok automatically)
- UI for viewing cost breakdown (1.10k frontend will use /atlas/costs)

## Notes

- All budget config is env-overridable. Defaults match master plan §10.3.
- The `BUDGET_OVERRIDE_TOKEN` is a secret env var; share only with yourself for emergency overrides.
- Cost tracking depends on `atlas_cost_log` rows having accurate `cost_usd` values — providers' SDKs return these in usage info; multi-brain.ts already records them.
