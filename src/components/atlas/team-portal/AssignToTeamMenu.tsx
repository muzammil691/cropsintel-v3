import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { UserPlus2, ChevronDown, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  assignArtifactToTeam,
  fetchTeamMembers,
  type AtlasTeamMember,
  type TeamPortalArtifactKind,
} from '@/lib/atlas-client'
import { cn } from '@/lib/utils'

interface AssignToTeamMenuProps {
  artifactKind: TeamPortalArtifactKind
  artifactRef: string
  taskId?: string
  title?: string
  onAssigned?: (memberDisplay: string) => void
  onError?: (msg: string) => void
}

const ASSIGNABLE_ROLES = new Set(['admin', 'operator'])

export function AssignToTeamMenu({
  artifactKind,
  artifactRef,
  taskId,
  title,
  onAssigned,
  onError,
}: AssignToTeamMenuProps) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<AtlasTeamMember[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastAssignedId, setLastAssignedId] = useState<string | 'broadcast' | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const data = await fetchTeamMembers()
        if (cancelled) return
        setMembers(
          data.filter((m) => m.status === 'active' && ASSIGNABLE_ROLES.has(m.role)),
        )
      } catch (err) {
        if (!cancelled) onError?.(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, onError])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [open])

  // Auto-focus the first menu item once the menu opens. We defer until after
  // members have loaded so focus lands on a real entry rather than the
  // "Loading…" placeholder.
  useEffect(() => {
    if (!open) return
    if (loading) return
    requestAnimationFrame(() => itemRefs.current[0]?.focus())
  }, [open, loading, members.length])

  // ARIA menu pattern: ArrowDown/Up cycle, Home/End jump, Escape closes and
  // returns focus to the trigger. Tab/Shift-Tab traps focus inside the menu
  // by looping back to the trigger.
  function handleMenuKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (!open) return
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null)
    if (items.length === 0 && e.key !== 'Escape') return
    const activeEl = document.activeElement as HTMLElement | null
    const currentIdx = items.findIndex((el) => el === activeEl)

    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      case 'ArrowDown': {
        e.preventDefault()
        const next = currentIdx === -1 ? 0 : (currentIdx + 1) % items.length
        items[next]?.focus()
        return
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prev = currentIdx <= 0 ? items.length - 1 : currentIdx - 1
        items[prev]?.focus()
        return
      }
      case 'Home':
        e.preventDefault()
        items[0]?.focus()
        return
      case 'End':
        e.preventDefault()
        items[items.length - 1]?.focus()
        return
      case 'Tab': {
        // Loop focus back to the first item when tabbing past the last,
        // and to the last when shift-tabbing past the first. Keeps focus
        // contained while the menu is open.
        if (e.shiftKey && currentIdx === 0) {
          e.preventDefault()
          items[items.length - 1]?.focus()
        } else if (!e.shiftKey && currentIdx === items.length - 1) {
          e.preventDefault()
          items[0]?.focus()
        }
        return
      }
      default:
        return
    }
  }

  async function handlePick(memberId: string | null, label: string) {
    setBusy(true)
    try {
      await assignArtifactToTeam({
        artifact_kind: artifactKind,
        artifact_ref: artifactRef,
        assigned_to_member_id: memberId,
        title,
        task_id: taskId,
      })
      setLastAssignedId(memberId ?? 'broadcast')
      onAssigned?.(label)
      setOpen(false)
      triggerRef.current?.focus()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Reset item refs each render so stale entries from a previous member list
  // don't linger in the array.
  itemRefs.current = []

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <UserPlus2 className="size-3" /> Assign to team
        <ChevronDown className="size-3" />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 shadow-lg">
          <div
            role="menu"
            aria-label="Assign to team member"
            className="py-1 max-h-[60vh] sm:max-h-64 overflow-y-auto text-sm"
            onKeyDown={handleMenuKeyDown}
          >
            <button
              ref={(el) => { itemRefs.current[0] = el }}
              type="button"
              role="menuitem"
              onClick={() => void handlePick(null, 'all admins')}
              disabled={busy}
              className={cn(
                'w-full text-left px-3 py-1.5 transition-colors duration-200 hover:bg-slate-50 dark:hover:bg-slate-900 focus-visible:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800',
                lastAssignedId === 'broadcast' && 'bg-emerald-50 dark:bg-emerald-950/30',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">Broadcast to all admins</span>
                {lastAssignedId === 'broadcast' && <Check className="size-3 text-emerald-600" />}
              </div>
              <p className="text-[11px] text-slate-500">Any admin sees it in their portal</p>
            </button>
            <div role="separator" className="border-t border-slate-100 dark:border-slate-800 my-1" />
            {loading && (
              <p className="px-3 py-2 text-xs text-slate-500">Loading members…</p>
            )}
            {!loading && members.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-500">
                No assignable members. Invite an admin or operator.
              </p>
            )}
            {!loading && members.map((m, idx) => {
              const label = m.display_name || m.phone
              return (
                <button
                  key={m.id}
                  ref={(el) => { itemRefs.current[idx + 1] = el }}
                  type="button"
                  role="menuitem"
                  onClick={() => void handlePick(m.id, label)}
                  disabled={busy}
                  className={cn(
                    'w-full text-left px-3 py-1.5 transition-colors duration-200 hover:bg-slate-50 dark:hover:bg-slate-900 focus-visible:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800',
                    lastAssignedId === m.id && 'bg-emerald-50 dark:bg-emerald-950/30',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span>
                      {label}
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400">{m.role}</span>
                    </span>
                    {lastAssignedId === m.id && <Check className="size-3 text-emerald-600" />}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
