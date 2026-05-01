// Phase 1.10ac — StatusPill
//
// Color-coded badge for pd_proposals.status. Single source of truth for the
// status palette so every tab renders the same colors.

import { cn } from '@/lib/utils'
import type { PdProposalStatus } from '@/lib/pd-client'

const COLORS: Record<PdProposalStatus, string> = {
  draft:       'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'in-review': 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  approved:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  rejected:    'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  shipped:     'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  archived:    'bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-500',
}

export function StatusPill({ status, size = 'sm' }: { status: PdProposalStatus; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium capitalize',
        size === 'sm' ? 'h-5 px-2 text-[10px]' : 'h-6 px-2.5 text-xs',
        COLORS[status],
      )}
    >
      {status.replace('-', ' ')}
    </span>
  )
}
