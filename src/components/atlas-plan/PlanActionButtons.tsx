import { Pencil, PlusCircle, Flag, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PlanNode } from '@/lib/atlas-client'

export type PlanCockpitAction = 'add' | 'modify' | 'follow' | 'revisit'

interface PlanActionButtonsProps {
  node: PlanNode
  onAction: (action: PlanCockpitAction, node: PlanNode) => void
  isFollowing?: boolean
  isRevisiting?: boolean
  isBuilding?: boolean
  className?: string
}

/**
 * Phase 1.10aj — the four cockpit action buttons rendered next to each plan
 * node row. Add inserts a sub-phase; Modify rewrites this one; Follow queues
 * the spec; Revisit dims the node so the build runner skips it.
 */
export function PlanActionButtons(props: PlanActionButtonsProps) {
  const { node, onAction, isFollowing, isRevisiting, isBuilding, className } = props

  return (
    <div
      data-testid="plan-action-buttons"
      className={cn('flex items-center gap-0.5', className)}
    >
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={`Add sub-phase under ${node.title}`}
        onClick={(e) => { e.stopPropagation(); onAction('add', node) }}
        disabled={isBuilding}
      >
        <PlusCircle className="size-3" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={`Modify ${node.title}`}
        onClick={(e) => { e.stopPropagation(); onAction('modify', node) }}
        disabled={isBuilding}
      >
        <Pencil className="size-3" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant={isFollowing ? 'default' : 'ghost'}
        aria-label={isFollowing ? `Following ${node.title}` : `Follow ${node.title}`}
        aria-pressed={Boolean(isFollowing)}
        onClick={(e) => { e.stopPropagation(); onAction('follow', node) }}
        disabled={isBuilding}
        className={cn(isFollowing && 'text-emerald-700 dark:text-emerald-300')}
      >
        <Flag className="size-3" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant={isRevisiting ? 'default' : 'ghost'}
        aria-label={isRevisiting ? `Un-revisit ${node.title}` : `Revisit ${node.title}`}
        aria-pressed={Boolean(isRevisiting)}
        onClick={(e) => { e.stopPropagation(); onAction('revisit', node) }}
        disabled={isBuilding}
        className={cn(isRevisiting && 'text-slate-400')}
      >
        <RotateCcw className="size-3" />
      </Button>
    </div>
  )
}

export default PlanActionButtons
