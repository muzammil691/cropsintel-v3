import { Inbox } from 'lucide-react'
import { AssignmentRow } from './AssignmentRow'
import type { TeamAssignment } from '@/lib/atlas-client'

interface AssignmentListProps {
  assignments: TeamAssignment[]
  loading: boolean
  canAct: boolean
  onResolve: (id: string, status: 'fixed' | 'escalated' | 'dismissed', notes?: string) => Promise<void> | void
  busy?: boolean
}

export function AssignmentList({ assignments, loading, canAct, onResolve, busy }: AssignmentListProps) {
  if (loading && assignments.length === 0) {
    return (
      <ul className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <li
            key={i}
            className="h-16 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse"
          />
        ))}
      </ul>
    )
  }

  if (assignments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center gap-2 py-8 rounded-md border border-dashed border-slate-200 dark:border-slate-800">
        <span className="grid place-items-center size-9 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <Inbox className="size-4" />
        </span>
        <p className="text-sm font-medium">Nothing assigned to you</p>
        <p className="text-xs text-slate-500 max-w-[260px]">
          When the owner routes an issue your way, it'll show up here.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {assignments.map((a) => (
        <AssignmentRow
          key={a.id}
          assignment={a}
          canAct={canAct}
          onResolve={onResolve}
          busy={busy}
        />
      ))}
    </ul>
  )
}
