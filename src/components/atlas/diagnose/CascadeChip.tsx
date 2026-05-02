import { Link2, Clock, GitCommit } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CascadeRelation } from '@/lib/atlas-client'

interface CascadeChipProps {
  relation: CascadeRelation
  className?: string
}

const GITHUB_REPO = 'muzammil691/cropsintel-v3'

export function CascadeChip({ relation, className }: CascadeChipProps) {
  if (relation.kind === 'unknown') return null

  const base =
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors duration-200'

  if (relation.kind === 'introduced-here') {
    return (
      <span
        className={cn(
          base,
          'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
          className,
        )}
        title={relation.reason}
      >
        <GitCommit className="size-3" aria-hidden />
        New file
      </span>
    )
  }

  if (relation.kind === 'introduced-by-prior-fix') {
    const sha = relation.prior_sha.slice(0, 7)
    const url = `https://github.com/${GITHUB_REPO}/commit/${relation.prior_sha}`
    const label = relation.same_check
      ? `Re-introduced by your fix ${sha}`
      : `Introduced by your fix ${sha}`
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          base,
          'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/40 underline-offset-2 hover:underline',
          className,
        )}
        title={`Prior fix subject: ${relation.prior_subject}`}
      >
        <Link2 className="size-3" aria-hidden />
        {label}
      </a>
    )
  }

  if (relation.kind === 'pre-existing') {
    return (
      <span
        className={cn(
          base,
          'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
          className,
        )}
        title={`Oldest touch: ${relation.oldest_sha.slice(0, 7)}`}
      >
        <Clock className="size-3" aria-hidden />
        Pre-existing ({relation.days_old}d old)
      </span>
    )
  }

  return null
}
