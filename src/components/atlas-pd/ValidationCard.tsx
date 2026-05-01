// Phase 1.10ac — ValidationCard
//
// Renders a single pd_auto_validation row: verdict pill, model/cost footer,
// 1-paragraph reasoning, bulleted gap list. Card layout per the AI review
// research note (Cursor / Copilot pattern: advice, not auto-apply).

import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PdAutoValidation, PdValidationVerdict } from '@/lib/pd-client'

const VERDICT_STYLE: Record<PdValidationVerdict, { color: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  pass:         { color: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-900', icon: CheckCircle2, label: 'Pass' },
  'needs-work': { color: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-900', icon: AlertTriangle, label: 'Needs work' },
  reject:       { color: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900', icon: XCircle, label: 'Reject' },
}

export function ValidationCard({ validation }: { validation: PdAutoValidation }) {
  const v = VERDICT_STYLE[validation.verdict] ?? VERDICT_STYLE['needs-work']
  const Icon = v.icon
  return (
    <div className={cn('rounded-md border p-3 text-xs', v.color)}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="size-3.5" aria-hidden />
        <span className="font-semibold uppercase text-[11px] tracking-wide">{v.label}</span>
        <span className="ml-auto text-[10px] opacity-70">
          {validation.ai_model} · ${validation.cost_usd.toFixed(4)} ·{' '}
          {new Date(validation.created_at).toLocaleString()}
        </span>
      </div>
      {validation.reasoning && (
        <p className="leading-relaxed text-slate-700 dark:text-slate-300 mb-2">{validation.reasoning}</p>
      )}
      {validation.gaps.length > 0 && (
        <>
          <p className="font-semibold text-[10px] uppercase tracking-wide text-slate-500 mb-1">Gaps</p>
          <ul className="space-y-0.5 text-slate-700 dark:text-slate-300 list-disc list-inside">
            {validation.gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </>
      )}
    </div>
  )
}
