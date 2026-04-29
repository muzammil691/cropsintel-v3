import { getSupabase } from './supabase'

const MONTHLY_CAP_USD = 50

function currentMonthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export async function checkBudget(): Promise<void> {
  const supabase = getSupabase()
  const month = currentMonthStart()

  const { data } = await supabase
    .from('council_budget')
    .select('spent_usd, cap_usd')
    .eq('month', month)
    .maybeSingle()

  const spent = data?.spent_usd ?? 0
  const cap = data?.cap_usd ?? MONTHLY_CAP_USD

  if (spent >= cap) {
    throw new Error(`Council monthly budget cap reached ($${spent.toFixed(2)} / $${cap.toFixed(2)}). Halting.`)
  }
}

export async function recordSpend(costUsd: number): Promise<void> {
  const supabase = getSupabase()
  const month = currentMonthStart()

  // Upsert the month row
  const { data: existing } = await supabase
    .from('council_budget')
    .select('spent_usd, cap_usd, alerts_sent')
    .eq('month', month)
    .maybeSingle()

  const prevSpent: number = existing?.spent_usd ?? 0
  const cap: number = existing?.cap_usd ?? MONTHLY_CAP_USD
  const alerts: Record<string, boolean> = existing?.alerts_sent ?? { '80': false, '100': false }

  const newSpent = prevSpent + costUsd
  const pct = (newSpent / cap) * 100

  if (pct >= 100 && !alerts['100']) {
    alerts['100'] = true
    console.warn(`[council/budget] ⚠️  BUDGET ALERT: 100% cap reached ($${newSpent.toFixed(2)} / $${cap.toFixed(2)})`)
  } else if (pct >= 80 && !alerts['80']) {
    alerts['80'] = true
    console.warn(`[council/budget] ⚠️  BUDGET ALERT: 80% cap reached ($${newSpent.toFixed(2)} / $${cap.toFixed(2)})`)
  }

  await supabase.from('council_budget').upsert({
    month,
    spent_usd: newSpent,
    cap_usd: cap,
    alerts_sent: alerts,
    updated_at: new Date().toISOString(),
  })
}
