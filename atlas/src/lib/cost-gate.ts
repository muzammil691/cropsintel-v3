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

export async function checkBudget(
  estimatedCostUsd: number,
  opts?: { provider?: string; overrideToken?: string },
): Promise<BudgetCheck> {
  if (opts?.overrideToken && opts.overrideToken === process.env.BUDGET_OVERRIDE_TOKEN) {
    return {
      allow: true, status: 'ok',
      reason: 'override token accepted',
      burnToday: 0, burnMonth: 0, budgetRemaining: MONTHLY_HARD_CAP,
    }
  }

  const sb = getSupabaseClient()
  if (!sb) {
    return { allow: true, status: 'ok', burnToday: 0, burnMonth: 0, budgetRemaining: MONTHLY_HARD_CAP }
  }

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

  if (projected > MONTHLY_HARD_CAP) {
    return {
      allow: false, status: 'blocked',
      reason: `Monthly cap $${MONTHLY_HARD_CAP} would be exceeded ($${burnMonth.toFixed(2)} + $${estimatedCostUsd.toFixed(4)} > $${MONTHLY_HARD_CAP})`,
      burnToday, burnMonth, budgetRemaining,
    }
  }

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

  if (projectedToday > DAILY_PAUSE_THRESHOLD) {
    return {
      allow: false, status: 'paused',
      reason: `Daily soft cap $${DAILY_PAUSE_THRESHOLD} reached ($${burnToday.toFixed(2)}). Auto-dispatch paused for 1 hour.`,
      burnToday, burnMonth, budgetRemaining,
    }
  }

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
  if (!sb) {
    return { today: 0, monthToDate: 0, byProvider: {}, capacity: MONTHLY_HARD_CAP }
  }

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
