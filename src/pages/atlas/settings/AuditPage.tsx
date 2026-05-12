// 1.10bb-c Session 9A — Audit page.
//
// Chronological event log for the current member. Filters: action, optional
// connection_id (drives the badge link from ConnectionCard in 9B). Limit caps
// at 500 server-side; we fetch 100 by default and add a Load more button.

import { useEffect, useState } from 'react'
import { ScrollText, RefreshCw, AlertTriangle, ShieldCheck, ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { listAuditEvents, type AtlasAuditEvent, type AtlasAuditAction } from '@/lib/atlas-client'
import { cn } from '@/lib/utils'

const ACTION_OPTIONS: Array<{ value: AtlasAuditAction | 'all'; label: string }> = [
  { value: 'all', label: 'All actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'rotate', label: 'Rotate' },
  { value: 'test', label: 'Test' },
  { value: 'reveal', label: 'Reveal' },
  { value: 'delete', label: 'Delete' },
  { value: 'wizard_complete', label: 'Wizard complete' },
]

export function AuditPage() {
  const [events, setEvents] = useState<AtlasAuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<AtlasAuditAction | 'all'>('all')
  const [limit, setLimit] = useState(100)

  const refresh = () => {
    setLoading(true)
    setError(null)
    listAuditEvents({ action: action === 'all' ? undefined : action, limit })
      .then(setEvents)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [action, limit])

  return (
    <div className="px-3 sm:px-5 py-4 max-w-5xl mx-auto w-full space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <ScrollText className="size-4 text-emerald-600" aria-hidden /> Audit
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            Every Settings action — create, rotate, test, reveal, delete — leaves a row here with IP + user agent.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as AtlasAuditAction | 'all')}
            className="text-xs h-8 px-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            aria-label="Filter by action"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={loading}
            className="text-xs h-8"
            aria-label="Refresh audit events"
          >
            <RefreshCw className={cn('size-3', loading && 'animate-spin')} aria-hidden />
          </Button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {!loading && events.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-6 py-10 text-center">
          <ScrollText className="size-5 mx-auto text-slate-400 mb-2" aria-hidden />
          <p className="text-sm text-slate-700 dark:text-slate-200 font-medium">No audit events yet.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Try creating or testing a connection — events will appear here.
          </p>
        </div>
      )}

      {events.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">When</th>
                <th className="text-left px-3 py-2 font-semibold">Action</th>
                <th className="text-left px-3 py-2 font-semibold">Result</th>
                <th className="text-left px-3 py-2 font-semibold">Connection</th>
                <th className="text-left px-3 py-2 font-semibold">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {events.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">
                    {new Date(ev.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5">
                    <code className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono">
                      {ev.action}
                    </code>
                  </td>
                  <td className="px-3 py-1.5">
                    {ev.result === 'success' && (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <ShieldCheck className="size-3" aria-hidden /> ok
                      </span>
                    )}
                    {ev.result === 'failure' && (
                      <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                        <ShieldX className="size-3" aria-hidden /> fail
                      </span>
                    )}
                    {ev.result === null && <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 dark:text-slate-400 font-mono text-[10px] truncate max-w-[12ch]" title={ev.connection_id ?? ''}>
                    {ev.connection_id ? ev.connection_id.slice(0, 8) + '…' : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-slate-500 dark:text-slate-500 font-mono text-[10px]">
                    {ev.ip ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {events.length >= limit && (
        <div className="flex justify-center">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLimit((l) => Math.min(500, l + 100))}
            disabled={loading}
            className="text-xs h-8"
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}

export default AuditPage
