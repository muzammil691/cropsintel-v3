// 1.10bb-c Session 9B — failing-connection banner.
//
// Mounted at the top of AtlasCockpit. Polls GET /atlas/connections on mount
// and every 5 minutes. Surfaces a yellow banner per failing/expired
// connection with [Reconnect] + [Dismiss until next session] actions.
// Dismiss writes a per-connection sessionStorage key; on next browser session
// the banner re-appears for the same row.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TriangleAlert, X, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { listConnections, type AtlasConnection } from '@/lib/atlas-client'

const POLL_MS = 5 * 60 * 1000

function dismissKey(connectionId: string): string {
  return `atlas_banner_dismissed_${connectionId}`
}

function isDismissed(connectionId: string): boolean {
  if (typeof window === 'undefined') return false
  try { return window.sessionStorage.getItem(dismissKey(connectionId)) === 'true' }
  catch { return false }
}

function dismiss(connectionId: string): void {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.setItem(dismissKey(connectionId), 'true') }
  catch { /* private mode */ }
}

export function FailingConnectionBanner() {
  const [connections, setConnections] = useState<AtlasConnection[]>([])
  const [dismissedTick, setDismissedTick] = useState(0)
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    try {
      const rows = await listConnections()
      setConnections(rows)
    } catch {
      // Banner failing-to-fetch is non-fatal. Silent — cockpit logs will
      // already show the underlying network/401 issue if relevant.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  const failing = useMemo(() =>
    connections.filter((c) =>
      (c.last_verify_status === 'failing' || c.last_verify_status === 'expired') && !isDismissed(c.id),
    ),
    // dismissedTick busts the memo when the user dismisses one inline.
    [connections, dismissedTick],
  )

  if (failing.length === 0) return null

  const visible = failing.slice(0, 3)
  const remaining = failing.length - visible.length

  return (
    <div className="border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40" role="region" aria-label="Failing connections">
      <ul className="divide-y divide-amber-200/60 dark:divide-amber-900/40">
        {visible.map((c) => (
          <li
            key={c.id}
            className="px-3 sm:px-4 py-2 flex items-center gap-2 text-[12px] text-amber-900 dark:text-amber-200"
          >
            <TriangleAlert className="size-3.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
            <span className="flex-1 min-w-0 truncate">
              Your <span className="font-semibold capitalize">{c.provider}</span>
              {c.label ? ` (${c.label})` : ''} connection {c.last_verify_status === 'expired' ? 'has expired' : 'needs attention'}
              {c.last_verify_error ? <span className="text-amber-700 dark:text-amber-300/80"> — {c.last_verify_error.slice(0, 120)}</span> : ''}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => navigate(`/atlas/settings/connections?reconnect=${encodeURIComponent(c.id)}`)}
              className="h-7 px-2 text-[11px] border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
            >
              <RefreshCw className="size-3 mr-1" aria-hidden />
              Reconnect
            </Button>
            <button
              type="button"
              onClick={() => { dismiss(c.id); setDismissedTick((t) => t + 1) }}
              aria-label={`Dismiss ${c.provider} alert until next session`}
              title="Dismiss until next session"
              className="rounded p-1 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
            >
              <X className="size-3" aria-hidden />
            </button>
          </li>
        ))}
        {remaining > 0 && (
          <li className="px-3 sm:px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            +{remaining} more failing — see{' '}
            <button
              type="button"
              onClick={() => navigate('/atlas/settings/connections')}
              className="underline hover:text-amber-900 dark:hover:text-amber-100"
            >
              Settings → Connections
            </button>
            .
          </li>
        )}
      </ul>
    </div>
  )
}

export default FailingConnectionBanner
