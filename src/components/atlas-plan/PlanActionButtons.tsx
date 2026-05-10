import { Flag, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PlanNode } from '@/lib/atlas-client'

export type PlanCockpitAction = 'follow' | 'revisit'

interface PlanActionButtonsProps {
  node: PlanNode
  onAction: (action: PlanCockpitAction, node: PlanNode) => void
  isFollowing?: boolean
  isRevisiting?: boolean
  isBuilding?: boolean
  className?: string
}

/**
 * Always-visible labeled cockpit action buttons. Follow queues the spec for the
 * build runner; Revisit dims the node so the runner skips it. On screens
 * narrower than `lg` the labels collapse to icon-only with `title` tooltips so
 * the actions never go invisible (cockpit row density).
 *
 * 1.10bb-c Session 4 — Add + Modify removed; plan mutation now flows through
 * the Workshop tab (decision-log driven, Verifier-audited).
 */
export function PlanActionButtons(props: PlanActionButtonsProps) {
  const { node, onAction, isFollowing, isRevisiting, isBuilding, className } = props

  return (
    <div
      data-testid="plan-action-buttons"
      className={cn('flex items-center gap-1 sm:gap-1.5', className)}
    >
      <Button
        type="button"
        size="sm"
        variant={isFollowing ? 'default' : 'outline'}
        title={isFollowing ? `Following ${node.title} — click to un-follow` : `Follow ${node.title} (queue for build)`}
        aria-label={isFollowing ? `Following ${node.title}` : `Follow ${node.title}`}
        aria-pressed={Boolean(isFollowing)}
        onClick={(e) => { e.stopPropagation(); onAction('follow', node) }}
        disabled={isBuilding}
        data-cockpit-action="follow"
        className={cn(
          'h-7 px-2 text-[11px] focus-visible:ring-2 focus-visible:ring-emerald-600/50 transition-colors duration-200',
          isFollowing
            ? 'bg-emerald-600 text-white hover:bg-emerald-600/90 border-emerald-600'
            : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40',
        )}
      >
        <Flag className="size-3" />
        <span className="hidden lg:inline">{isFollowing ? 'Following' : 'Follow'}</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        title={isRevisiting ? `Un-revisit ${node.title}` : `Revisit ${node.title} (defer)`}
        aria-label={isRevisiting ? `Un-revisit ${node.title}` : `Revisit ${node.title}`}
        aria-pressed={Boolean(isRevisiting)}
        onClick={(e) => { e.stopPropagation(); onAction('revisit', node) }}
        disabled={isBuilding}
        data-cockpit-action="revisit"
        className={cn(
          'h-7 px-2 text-[11px] focus-visible:ring-2 focus-visible:ring-emerald-600/50 transition-colors duration-200',
          isRevisiting
            ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
            : 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-400 dark:hover:bg-amber-950/40',
        )}
      >
        <RotateCcw className="size-3" />
        <span className="hidden lg:inline">{isRevisiting ? 'Revisiting' : 'Revisit'}</span>
      </Button>
    </div>
  )
}

export default PlanActionButtons
