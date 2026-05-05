// Phase A.3 of Pillar A — shared action panel used by both PlanTree (vertical
// view) and PlanGraphView (ReactFlow horizontal view). Single source of truth
// for the per-node button set so the two views stay consistent.
//
// In Tree view this renders inline (icon-only) on hover; in Graph view it
// renders in the right-side dock as a labeled button stack.

import { ArrowUp, ArrowDown, Hammer, MessageSquare, Trash2, Undo2, FolderInput, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PlanNode } from '@/lib/atlas-client'

export interface PlanNodeActionHandlers {
  onMoveUp?: (node: PlanNode) => void
  onMoveDown?: (node: PlanNode) => void
  onBuildNow?: (node: PlanNode) => void
  onDiscuss?: (node: PlanNode) => void
  onVoid?: (node: PlanNode) => void
  onRecover?: (node: PlanNode) => void
  onUndeploy?: (node: PlanNode) => void
  onAddToQueue?: (node: PlanNode) => void
  onChangePhase?: (node: PlanNode) => void
}

export interface PlanNodeActionFlags {
  isVoided?: boolean
  isQueued?: boolean
  isShipped?: boolean
}

export interface PlanNodeActionsProps extends PlanNodeActionHandlers, PlanNodeActionFlags {
  node: PlanNode
  /**
   * 'inline' = icon-only buttons in a flex row (PlanTree's hover overlay).
   * 'panel'  = full-width labeled button stack (PlanGraphView's right dock).
   */
  variant: 'inline' | 'panel'
  /** Disable all buttons (e.g. while a mutation is in flight). */
  disabled?: boolean
}

interface ActionDef {
  key: string
  label: string
  icon: typeof ArrowUp
  visible: boolean
  destructive?: boolean
  emphasis?: boolean
  onClick: () => void
}

export function PlanNodeActions(props: PlanNodeActionsProps) {
  const { node, variant, disabled } = props

  const actions: ActionDef[] = [
    {
      key: 'move-up',
      label: 'Move up',
      icon: ArrowUp,
      visible: !!props.onMoveUp,
      onClick: () => props.onMoveUp?.(node),
    },
    {
      key: 'move-down',
      label: 'Move down',
      icon: ArrowDown,
      visible: !!props.onMoveDown,
      onClick: () => props.onMoveDown?.(node),
    },
    {
      key: 'build',
      label: 'Deploy now',
      icon: Hammer,
      visible: !!props.onBuildNow,
      emphasis: true,
      onClick: () => props.onBuildNow?.(node),
    },
    {
      key: 'discuss',
      label: 'Discuss with Atlas',
      icon: MessageSquare,
      visible: !!props.onDiscuss,
      onClick: () => props.onDiscuss?.(node),
    },
    {
      key: 'add-to-queue',
      label: 'Add to queue',
      icon: Inbox,
      visible: !!props.onAddToQueue && !props.isQueued && !props.isShipped,
      onClick: () => props.onAddToQueue?.(node),
    },
    {
      key: 'undeploy',
      label: 'Request undeploy',
      icon: Undo2,
      visible: !!props.onUndeploy && !!props.isShipped,
      destructive: true,
      onClick: () => props.onUndeploy?.(node),
    },
    {
      key: 'change-phase',
      label: 'Change phase',
      icon: FolderInput,
      visible: !!props.onChangePhase,
      onClick: () => props.onChangePhase?.(node),
    },
    {
      key: props.isVoided ? 'recover' : 'void',
      label: props.isVoided ? 'Recover' : 'Void',
      icon: props.isVoided ? Undo2 : Trash2,
      visible: props.isVoided ? !!props.onRecover : !!props.onVoid,
      destructive: !props.isVoided,
      onClick: () => (props.isVoided ? props.onRecover?.(node) : props.onVoid?.(node)),
    },
  ]

  const visible = actions.filter(a => a.visible)
  if (visible.length === 0) return null

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {visible.map(a => {
          const Icon = a.icon
          return (
            <Button
              key={a.key}
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={a.label}
              disabled={disabled}
              onClick={(e) => { e.stopPropagation(); a.onClick() }}
            >
              <Icon className={cn('size-3', a.destructive && 'text-rose-500')} />
            </Button>
          )
        })}
      </div>
    )
  }

  // panel variant — full labeled button stack
  return (
    <div className="flex flex-col gap-1.5">
      {visible.map(a => {
        const Icon = a.icon
        return (
          <Button
            key={a.key}
            type="button"
            size="sm"
            variant={a.emphasis ? 'default' : a.destructive ? 'destructive' : 'outline'}
            disabled={disabled}
            onClick={a.onClick}
            className="justify-start text-xs gap-2"
          >
            <Icon className="size-3.5" />
            {a.label}
          </Button>
        )
      })}
    </div>
  )
}
