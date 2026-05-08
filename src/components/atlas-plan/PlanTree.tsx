import { useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, ArrowUp, ArrowDown, Hammer, MessageSquare, Plus, Trash2, Undo2, FolderInput, Inbox, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { PlanNode } from '@/lib/atlas-client'
import { PlanActionButtons, type PlanCockpitAction } from './PlanActionButtons'

export type SpecStatus = 'shipped' | 'queued' | 'planned' | 'blocked'

/** Phase 1.10aj — cockpit phase status overlay (separate from SpecStatus). */
export type CockpitNodeStatus = 'planned' | 'wizard-active' | 'follow' | 'revisit' | 'building' | 'built'

interface PlanTreeProps {
  root: PlanNode
  selectedId: string | null
  onSelect: (node: PlanNode) => void
  multiSelect: boolean
  selectedIds: Set<string>
  onToggleSelected: (id: string) => void
  statusByTitle: Map<string, SpecStatus>
  /**
   * Phase A.1: filter the rendered tree to a single status. 'all' renders
   * everything (default behavior). When set to a specific status, a node is
   * shown only if it (or any descendant) matches — so collapsing parents
   * still reveal filtered leaves.
   */
  statusFilter?: 'all' | SpecStatus
  onMoveUp: (node: PlanNode) => void
  onMoveDown: (node: PlanNode) => void
  onBuildNow: (node: PlanNode) => void
  onDiscuss: (node: PlanNode) => void
  /**
   * Phase A.2: optional plan-state mutation handlers. When omitted, the
   * corresponding button is hidden — keeps PlanTree backwards-compatible
   * with any caller that doesn't yet know about voids/queue/undeploy.
   */
  onVoid?: (node: PlanNode) => void
  onRecover?: (node: PlanNode) => void
  onUndeploy?: (node: PlanNode) => void
  onAddToQueue?: (node: PlanNode) => void
  onChangePhase?: (node: PlanNode) => void
  /**
   * Set of plan-node ids currently marked voided. Used to swap Void → Recover
   * button on those rows. Omit (or pass empty set) when state is unknown.
   */
  voidedIds?: Set<string>
  /**
   * Set of plan-node ids currently in the queue (queued-no-build state). Used
   * to suppress the "Add to queue" button on already-queued rows.
   */
  queuedIds?: Set<string>
  /** Set of plan-node ids that have shipped (verified). Toggles Undeploy. */
  shippedIds?: Set<string>
  /**
   * Phase A.5: ids carrying state='suggested-by-multi-brain' or
   * 'suggested-by-verifier'. Renders a ⭐ badge inline so the user can
   * see what the agents recommended next.
   */
  suggestedIds?: Set<string>
  /**
   * Phase 1.10aj — cockpit overlays. When provided, the row renders the
   * 4-button cockpit action surface (Add / Modify / Follow / Revisit) and
   * paints the row by cockpit status. Existing handlers (onMoveUp etc.)
   * remain wired for backwards compatibility.
   */
  cockpitStatusByNodeId?: Map<string, CockpitNodeStatus>
  followingIds?: Set<string>
  revisitingIds?: Set<string>
  buildingIds?: Set<string>
  onCockpitAction?: (action: PlanCockpitAction, node: PlanNode) => void
}

const STATUS_ICON: Record<SpecStatus, string> = {
  shipped: 'shipped',
  queued: 'queued',
  planned: 'planned',
  blocked: 'blocked',
}
const STATUS_DOT: Record<SpecStatus, string> = {
  shipped: 'bg-emerald-500',
  queued: 'bg-amber-400',
  planned: 'bg-slate-300',
  blocked: 'bg-rose-500',
}

// Phase 1.10aj — cockpit row tinting per status.
const COCKPIT_ROW_TINT: Record<CockpitNodeStatus, string> = {
  planned: '',
  'wizard-active': 'bg-amber-50/60 dark:bg-amber-950/30',
  follow: 'bg-emerald-50/60 dark:bg-emerald-950/30',
  revisit: 'opacity-60 grayscale',
  building: 'bg-blue-50/60 dark:bg-blue-950/30 animate-pulse',
  built: 'bg-emerald-100/40 dark:bg-emerald-900/30',
}

// Phase A.1: a node passes the status filter if it (or any descendant) has
// the selected status. Walks the subtree; cheap because the master plan
// rarely exceeds a few hundred nodes.
function subtreeMatchesStatus(
  node: PlanNode,
  target: SpecStatus,
  statusByTitle: Map<string, SpecStatus>,
): boolean {
  if (inferStatusFor(node.title, statusByTitle) === target) return true
  for (const child of node.children) {
    if (subtreeMatchesStatus(child, target, statusByTitle)) return true
  }
  return false
}

export function PlanTree(props: PlanTreeProps) {
  const filter = props.statusFilter ?? 'all'
  const visibleChildren = filter === 'all'
    ? props.root.children
    : props.root.children.filter(c => subtreeMatchesStatus(c, filter, props.statusByTitle))
  return (
    <div className="text-sm">
      {visibleChildren.length === 0 && filter !== 'all' && (
        <p className="text-[11px] text-slate-500 italic px-2 py-3">
          No nodes match the "{filter}" filter.
        </p>
      )}
      {visibleChildren.map(child => (
        <PlanNodeRow key={child.id} node={child} depth={0} {...props} />
      ))}
    </div>
  )
}

interface PlanNodeRowProps extends PlanTreeProps {
  node: PlanNode
  depth: number
}

function PlanNodeRow(props: PlanNodeRowProps) {
  const { node, depth } = props
  const filter = props.statusFilter ?? 'all'
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.children.length > 0

  const status: SpecStatus = useMemo(() => {
    return inferStatusFor(node.title, props.statusByTitle)
  }, [node.title, props.statusByTitle])

  // Skip rendering this row entirely when a filter is active and neither
  // this node nor any descendant matches.
  if (filter !== 'all' && !subtreeMatchesStatus(node, filter, props.statusByTitle)) {
    return null
  }

  // When filtering, also filter the rendered children list so collapsed-open
  // parents don't reveal non-matching leaves.
  const renderedChildren = filter === 'all'
    ? node.children
    : node.children.filter(c => subtreeMatchesStatus(c, filter, props.statusByTitle))

  const isSelected = props.selectedId === node.id
  const isMultiChecked = props.selectedIds.has(node.id)
  const preview = node.body.replace(/\s+/g, ' ').slice(0, 80)
  const cockpitStatus = props.cockpitStatusByNodeId?.get(node.id)
  const cockpitTint = cockpitStatus ? COCKPIT_ROW_TINT[cockpitStatus] : ''

  return (
    <div className="border-l border-transparent">
      <div
        className={cn(
          'flex items-start gap-1 px-1.5 py-1.5 rounded-md transition-colors duration-200 hover:bg-slate-100 dark:hover:bg-slate-900/40 cursor-pointer group sm:gap-2 sm:px-2',
          isSelected && 'bg-slate-100 dark:bg-slate-900/60',
          cockpitTint,
        )}
        style={{ paddingLeft: `${0.5 + depth * 1.0}rem` }}
        onClick={() => props.onSelect(node)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            props.onSelect(node)
          } else if (e.key === 'ArrowRight') {
            setOpen(true)
          } else if (e.key === 'ArrowLeft') {
            setOpen(false)
          }
        }}
        tabIndex={0}
        role="treeitem"
        aria-expanded={hasChildren ? open : undefined}
        aria-selected={isSelected}
      >
        {props.multiSelect && (
          <Checkbox
            checked={isMultiChecked}
            onChange={(e) => {
              e.stopPropagation()
              props.onToggleSelected(node.id)
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${node.title}`}
          />
        )}
        <button
          type="button"
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) setOpen(o => !o)
          }}
          className={cn(
            'mt-0.5 size-4 inline-flex items-center justify-center text-slate-500',
            !hasChildren && 'opacity-0 pointer-events-none',
          )}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <span
          aria-hidden
          className={cn('mt-2 size-2 rounded-full shrink-0', STATUS_DOT[status])}
          title={STATUS_ICON[status]}
        />
        {/* Phase A.5: ⭐ badge for nodes Multi-Brain / Verifier recommended. */}
        {props.suggestedIds?.has(node.id) && (
          <span
            className="mt-1 inline-flex items-center text-amber-500"
            title="Suggested by Multi-Brain or Verifier"
          >
            <Star className="size-3 fill-current" aria-hidden />
            <span className="sr-only">Suggested by Multi-Brain or Verifier</span>
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className={cn('font-medium text-slate-900 dark:text-slate-100 truncate', node.level === 1 && 'text-base')}>
            {node.title}
          </div>
          {preview && (
            <div className="text-xs text-slate-500 truncate">{preview}{node.body.length > 80 ? '…' : ''}</div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 sm:flex-nowrap sm:gap-1.5">
          {props.onCockpitAction && (
            <PlanActionButtons
              node={node}
              onAction={props.onCockpitAction}
              isFollowing={props.followingIds?.has(node.id)}
              isRevisiting={props.revisitingIds?.has(node.id)}
              isBuilding={props.buildingIds?.has(node.id)}
              className="mr-0.5"
            />
          )}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Move up"
            onClick={(e) => { e.stopPropagation(); props.onMoveUp(node) }}
          >
            <ArrowUp className="size-3" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Move down"
            onClick={(e) => { e.stopPropagation(); props.onMoveDown(node) }}
          >
            <ArrowDown className="size-3" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Build now"
            onClick={(e) => { e.stopPropagation(); props.onBuildNow(node) }}
          >
            <Hammer className="size-3" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Discuss with Atlas"
            onClick={(e) => { e.stopPropagation(); props.onDiscuss(node) }}
          >
            <MessageSquare className="size-3" />
          </Button>
          {/* Phase A.2: state-mutation buttons. Each is conditional on its
              handler being passed AND the row's current state (e.g. Recover
              shows when voided, otherwise Void shows; Undeploy only on
              shipped). All tiny icon buttons to keep row density tight. */}
          {props.onAddToQueue && !props.queuedIds?.has(node.id) && !props.shippedIds?.has(node.id) && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Add to queue"
              onClick={(e) => { e.stopPropagation(); props.onAddToQueue!(node) }}
            >
              <Inbox className="size-3" />
            </Button>
          )}
          {props.onUndeploy && props.shippedIds?.has(node.id) && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Request undeploy"
              onClick={(e) => { e.stopPropagation(); props.onUndeploy!(node) }}
            >
              <Undo2 className="size-3" />
            </Button>
          )}
          {props.onChangePhase && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Change phase"
              onClick={(e) => { e.stopPropagation(); props.onChangePhase!(node) }}
            >
              <FolderInput className="size-3" />
            </Button>
          )}
          {props.voidedIds?.has(node.id)
            ? props.onRecover && (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Recover voided node"
                  onClick={(e) => { e.stopPropagation(); props.onRecover!(node) }}
                >
                  <Undo2 className="size-3 text-emerald-600" />
                </Button>
              )
            : props.onVoid && (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Void this node"
                  onClick={(e) => { e.stopPropagation(); props.onVoid!(node) }}
                >
                  <Trash2 className="size-3 text-rose-500" />
                </Button>
              )}
        </div>
      </div>
      {open && renderedChildren.length > 0 && (
        <div role="group">
          {renderedChildren.map(child => (
            <PlanNodeRow key={child.id} {...props} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function inferStatusFor(title: string, statusByTitle: Map<string, SpecStatus>): SpecStatus {
  const norm = title.toLowerCase()
  for (const [key, status] of statusByTitle.entries()) {
    if (norm.includes(key) || key.includes(norm)) return status
  }
  return 'planned'
}

// Suppresses "unused" warning in callsites that don't render the icon.
void Plus
