import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ExternalLink,
  Eye,
  Globe,
  ImageIcon,
  Monitor,
  RefreshCw,
  Search,
} from 'lucide-react'
import { TabFrame } from './AtlasPlanTab'
import { fetchRecentScreenshots, type DesignerScreenshotRow } from '@/lib/atlas-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type SubView = 'gh-pages' | 'live' | 'screenshots'

interface SubViewSpec {
  key: SubView
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const SUB_VIEWS: SubViewSpec[] = [
  { key: 'gh-pages', label: 'GH Pages', icon: Globe },
  { key: 'live', label: 'Live', icon: Eye },
  { key: 'screenshots', label: 'Designer screenshots', icon: ImageIcon },
]

const URLS: Record<Exclude<SubView, 'screenshots'>, string> = {
  'gh-pages': 'https://muzammil691.github.io/',
  live: 'https://cropsintel.com/',
}

// Sandbox: explicitly omit allow-top-navigation so the embedded app can never
// break out of the cockpit shell (per phase-1.10as NEVER list).
const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups'

const IFRAME_LOAD_TIMEOUT_MS = 5000

interface AtlasPreviewTabProps {
  onOpenAudit: () => void
}

export default function AtlasPreviewTab({ onOpenAudit }: AtlasPreviewTabProps) {
  // Default to GH Pages — DNS for cropsintel.com is still pending per spec.
  const [view, setView] = useState<SubView>('gh-pages')

  return (
    <TabFrame
      title="Preview"
      hint="See the live app from inside the cockpit. Compare with Designer screenshots."
      rightSlot={<SubViewToggle value={view} onChange={setView} />}
    >
      {view === 'screenshots' ? (
        <ScreenshotsView onOpenAudit={onOpenAudit} />
      ) : (
        <IframeView key={view} view={view} url={URLS[view]} onSwitchToGhPages={() => setView('gh-pages')} />
      )}
    </TabFrame>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-view toggle: pill buttons on ≥sm, native <select> on <sm.
// ──────────────────────────────────────────────────────────────────────────

function SubViewToggle({
  value,
  onChange,
}: {
  value: SubView
  onChange: (v: SubView) => void
}) {
  return (
    <>
      <div role="tablist" aria-label="Preview sub-view" className="hidden sm:inline-flex rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-0.5">
        {SUB_VIEWS.map((s) => {
          const Icon = s.icon
          const active = s.key === value
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(s.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded transition-colors duration-150',
                active
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {s.label}
            </button>
          )
        })}
      </div>

      <select
        aria-label="Preview sub-view"
        className="sm:hidden text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2 py-1.5"
        value={value}
        onChange={(e) => onChange(e.target.value as SubView)}
      >
        {SUB_VIEWS.map((s) => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Iframe view: Live / GH Pages. Includes refresh, open-in-new-tab, and a
// timeout fallback for X-Frame-Options blocked frames.
// ──────────────────────────────────────────────────────────────────────────

function IframeView({
  view,
  url,
  onSwitchToGhPages,
}: {
  view: 'live' | 'gh-pages'
  url: string
  onSwitchToGhPages: () => void
}) {
  const [reloadKey, setReloadKey] = useState(0)
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset state on each reload or view switch.
  useEffect(() => {
    setLoadState('loading')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setLoadState((s) => (s === 'loading' ? 'failed' : s))
    }, IFRAME_LOAD_TIMEOUT_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [reloadKey, url])

  const onLoad = useCallback(() => {
    setLoadState('loaded')
    setLastLoadedAt(new Date())
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const refresh = useCallback(() => setReloadKey((n) => n + 1), [])
  const openInNewTab = useCallback(() => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [url])

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <Toolbar
        url={url}
        lastLoadedAt={lastLoadedAt}
        onRefresh={refresh}
        onOpenInNewTab={openInNewTab}
      />
      <div className="relative flex-1 min-h-[400px] rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
        {loadState === 'loading' && <IframeSkeleton />}

        {loadState === 'failed' ? (
          <IframeFallback
            view={view}
            url={url}
            onRetry={refresh}
            onOpenInNewTab={openInNewTab}
            onSwitchToGhPages={view === 'live' ? onSwitchToGhPages : undefined}
          />
        ) : (
          <iframe
            key={reloadKey}
            src={url}
            title={view === 'live' ? 'CropsIntel live (cropsintel.com)' : 'CropsIntel GH Pages preview'}
            sandbox={IFRAME_SANDBOX}
            referrerPolicy="no-referrer"
            loading="lazy"
            onLoad={onLoad}
            className={cn(
              'absolute inset-0 w-full h-full border-0',
              loadState === 'loading' && 'opacity-0',
            )}
          />
        )}
      </div>
    </div>
  )
}

function IframeSkeleton() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-slate-50/60 dark:bg-slate-900/30">
      <div className="flex flex-col items-center gap-2 text-xs text-slate-500">
        <RefreshCw className="size-4 animate-spin" />
        <span>Loading preview…</span>
      </div>
    </div>
  )
}

function IframeFallback({
  view,
  url,
  onRetry,
  onOpenInNewTab,
  onSwitchToGhPages,
}: {
  view: 'live' | 'gh-pages'
  url: string
  onRetry: () => void
  onOpenInNewTab: () => void
  onSwitchToGhPages?: () => void
}) {
  const isLive = view === 'live'
  return (
    <div className="absolute inset-0 grid place-items-center p-4">
      <div className="max-w-sm w-full rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-center">
        <Monitor className="size-6 mx-auto text-amber-700 dark:text-amber-300" aria-hidden />
        <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
          {isLive ? 'cropsintel.com not responding' : 'GH Pages preview blocked'}
        </p>
        <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
          {isLive
            ? 'DNS may still be pending or the page refused to embed. Use the GH Pages preview instead.'
            : 'The host refused to embed this page (X-Frame-Options). Open it in a new tab.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {isLive && onSwitchToGhPages && (
            <Button size="sm" variant="default" onClick={onSwitchToGhPages} className="text-xs">
              Use GH Pages preview
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onRetry} className="text-xs">
            <RefreshCw className="size-3.5" /> Retry
          </Button>
          <Button size="sm" variant="ghost" onClick={onOpenInNewTab} className="text-xs">
            <ExternalLink className="size-3.5" /> Open {hostFromUrl(url)}
          </Button>
        </div>
      </div>
    </div>
  )
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Toolbar: refresh, open-in-new-tab, last-loaded timestamp, inspect commit.
// ──────────────────────────────────────────────────────────────────────────

function Toolbar({
  url,
  lastLoadedAt,
  onRefresh,
  onOpenInNewTab,
  onInspectCommit,
  inspectCommitDisabled,
}: {
  url?: string
  lastLoadedAt: Date | null
  onRefresh: () => void
  onOpenInNewTab?: () => void
  onInspectCommit?: () => void
  inspectCommitDisabled?: boolean
}) {
  // Iframe-side: read ?sha=... if the URL appends one, so the Inspect button
  // is enabled in that narrow case. Most of the time the param is absent and
  // the button stays disabled.
  const sha = useMemo(() => {
    if (!url) return null
    try {
      return new URL(url).searchParams.get('sha')
    } catch {
      return null
    }
  }, [url])
  const inspectEnabled = onInspectCommit ? !inspectCommitDisabled : !!sha
  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={onRefresh}
        className="text-xs h-7"
        title="Refresh"
      >
        <RefreshCw className="size-3.5" /> Refresh
      </Button>
      {onOpenInNewTab && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onOpenInNewTab}
          className="text-xs h-7"
          title="Open in new tab"
        >
          <ExternalLink className="size-3.5" /> Open in new tab
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={onInspectCommit}
        disabled={!inspectEnabled || !onInspectCommit}
        className="text-xs h-7"
        title={
          onInspectCommit
            ? 'Jump to Audit tab to inspect this commit'
            : sha
              ? `Inspect commit ${sha.slice(0, 7)}`
              : 'No commit-sha param on this URL'
        }
      >
        <Search className="size-3.5" /> Inspect commit
      </Button>
      <span className="ml-auto text-[11px] text-slate-500 tabular-nums" aria-live="polite">
        {lastLoadedAt ? `Last loaded: ${formatTime(lastLoadedAt)}` : '—'}
      </span>
    </div>
  )
}

function formatTime(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${hh}:${mm}`
}

// ──────────────────────────────────────────────────────────────────────────
// Designer screenshots view
// ──────────────────────────────────────────────────────────────────────────

function ScreenshotsView({ onOpenAudit }: { onOpenAudit: () => void }) {
  const [rows, setRows] = useState<DesignerScreenshotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
  const [openRow, setOpenRow] = useState<DesignerScreenshotRow | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchRecentScreenshots(12)
      .then((r) => {
        setRows(r)
        setLastLoadedAt(new Date())
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <Toolbar
        lastLoadedAt={lastLoadedAt}
        onRefresh={load}
        onInspectCommit={onOpenAudit}
        inspectCommitDisabled={rows.length === 0}
      />

      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          Failed to load screenshots: {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && rows.length === 0 ? (
          <ScreenshotsSkeleton />
        ) : rows.length === 0 ? (
          <EmptyScreenshotState />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((r) => (
              <ScreenshotCard key={r.id} row={r} onOpen={() => setOpenRow(r)} />
            ))}
          </div>
        )}
      </div>

      <ScreenshotDialog row={openRow} onClose={() => setOpenRow(null)} />
    </div>
  )
}

function ScreenshotCard({
  row,
  onOpen,
}: {
  row: DesignerScreenshotRow
  onOpen: () => void
}) {
  const verdict = (row.verdict || '').toLowerCase()
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors duration-150 text-left focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:outline-none"
      aria-label={`Open screenshot for task ${row.task_id}`}
    >
      <div className="aspect-video bg-slate-100 dark:bg-slate-900 overflow-hidden">
        <img
          src={row.screenshot_url}
          alt={`Designer screenshot for ${row.task_id}`}
          loading="lazy"
          className="w-full h-full object-cover object-top group-hover:scale-[1.01] transition-transform duration-200"
          onError={(e) => {
            // If the signed URL has expired, hide the broken-image icon.
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
          }}
        />
      </div>
      <div className="px-3 py-2 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-slate-700 dark:text-slate-200 truncate">
            {row.head_after ? row.head_after.slice(0, 7) : '—'}
          </span>
          <VerdictBadge verdict={verdict} />
        </div>
        <span className="text-[11px] text-slate-500 truncate">{row.task_id}</span>
        <span className="text-[10px] text-slate-400 tabular-nums">
          {formatRelative(row.created_at)}
        </span>
      </div>
    </button>
  )
}

function VerdictBadge({ verdict }: { verdict: string }) {
  if (verdict === 'pass') {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 hover:bg-emerald-100">
        pass
      </Badge>
    )
  }
  if (verdict === 'fail') {
    return (
      <Badge variant="destructive" className="hover:bg-destructive/15">fail</Badge>
    )
  }
  if (verdict === 'partial') {
    return (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-100">
        partial
      </Badge>
    )
  }
  return <Badge variant="outline">{verdict || 'unknown'}</Badge>
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const delta = Date.now() - t
  const mins = Math.round(delta / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function ScreenshotDialog({
  row,
  onClose,
}: {
  row: DesignerScreenshotRow | null
  onClose: () => void
}) {
  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs">
              {row?.head_after ? row.head_after.slice(0, 12) : '—'}
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-600 dark:text-slate-300 truncate">{row?.task_id}</span>
            {row && <VerdictBadge verdict={(row.verdict || '').toLowerCase()} />}
          </DialogTitle>
        </DialogHeader>
        {row && (
          <div className="rounded-md overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <img
              src={row.screenshot_url}
              alt={`Designer screenshot for ${row.task_id}`}
              className="w-full h-auto max-h-[70vh] object-contain"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ScreenshotsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-md border border-slate-200 dark:border-slate-800 overflow-hidden"
        >
          <div className="aspect-video bg-slate-100 dark:bg-slate-800 animate-pulse" />
          <div className="px-3 py-2 space-y-1.5">
            <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            <div className="h-2.5 w-2/3 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyScreenshotState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-12">
      <span className="grid place-items-center size-12 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <ImageIcon className="size-6" />
      </span>
      <div className="max-w-sm">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          No recent screenshots
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Designer hasn't captured screenshots recently. Trigger a full audit on a UI commit to populate this view.
        </p>
      </div>
    </div>
  )
}
