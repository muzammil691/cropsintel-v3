import { useState } from 'react'
import { Inbox } from 'lucide-react'
import { TabFrame } from './AtlasPlanTab'
import type { PendingSpec } from '@/lib/atlas-client'

interface AtlasQueueTabProps {
  pendingSpecs: PendingSpec[]
  loading: boolean
  onDismiss?: (id: string) => void
}

/**
 * Queue list with multi-select + priority editor scaffold. The priority
 * editor backend lives in 1.10ak; until it ships the priority dropdown is a
 * local-only preview that resets on refresh — the cockpit doesn't lie about
 * what's persisted.
 */
export default function AtlasQueueTab({ pendingSpecs, loading, onDismiss }: AtlasQueueTabProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [priorities, setPriorities] = useState<Record<string, number>>({})

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <TabFrame
      title="Queue"
      hint="Specs waiting for a Builder pickup. Multi-select to bulk-edit priority (server-side wiring lands in 1.10ak)."
      rightSlot={
        selected.size > 0 ? (
          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 tabular-nums">
            {selected.size} selected
          </span>
        ) : null
      }
    >
      {loading && pendingSpecs.length === 0 ? (
        <ul className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="h-16 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </ul>
      ) : pendingSpecs.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center gap-3 py-12">
          <span className="grid place-items-center size-10 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <Inbox className="size-5" />
          </span>
          <p className="text-sm font-medium">Queue is empty</p>
          <p className="text-xs text-slate-500 max-w-[260px]">
            New specs land here when Atlas drafts them or you /spec from chat.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {pendingSpecs.map((spec) => {
            const isChecked = selected.has(spec.id)
            const pri = priorities[spec.id] ?? 5
            return (
              <li
                key={spec.id}
                className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3"
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(spec.id)}
                    aria-label={`Select ${spec.filename}`}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <code className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-100 truncate">
                        {spec.filename}
                      </code>
                      <span className="text-[10px] text-slate-400 ml-auto tabular-nums">
                        {new Date(spec.drafted_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                      {spec.spec_markdown.slice(0, 240)}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-[11px]">
                      <label className="text-slate-500">
                        Priority{' '}
                        <select
                          value={pri}
                          onChange={(e) =>
                            setPriorities((p) => ({ ...p, [spec.id]: Number(e.target.value) }))
                          }
                          className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-1.5 py-0.5 text-xs"
                        >
                          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                      {onDismiss && (
                        <button
                          type="button"
                          onClick={() => onDismiss(spec.id)}
                          className="ml-auto text-slate-400 hover:text-red-600 transition-colors duration-150"
                        >
                          dismiss
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </TabFrame>
  )
}
