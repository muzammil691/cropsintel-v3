import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import {
  Activity,
  Clock,
  Database,
  ExternalLink,
  Hammer,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { drAtlas } from '@/lib/drAtlas'
import { fetchStatus, type AtlasStatus } from '@/lib/atlas-client'
import { cn } from '@/lib/utils'

interface RoadmapPhase {
  phase: string
  title: string
  status: 'live' | 'in-flight' | 'planned'
  blurb: string
}

const ROADMAP: RoadmapPhase[] = [
  {
    phase: '1.10',
    title: 'Atlas + 7-agent build pipeline',
    status: 'live',
    blurb: 'Council, Builder, Verifier, Designer, Memory, Adela, Atlas — all running on Railway.',
  },
  {
    phase: '1.30',
    title: 'Customer auth (email + WhatsApp)',
    status: 'planned',
    blurb: 'Four sign-in methods plus the V1/V2 user-migration bridge.',
  },
  {
    phase: '1.50+',
    title: 'Market intelligence dashboards',
    status: 'planned',
    blurb: 'Price trends, supply/demand, regional heatmaps — once Adela has filled the data lake.',
  },
  {
    phase: '2.x',
    title: 'CRM / BRM / SRM relationship graphs',
    status: 'planned',
    blurb: 'Typed node + edge models with drill-down. Ships after the data foundation locks.',
  },
]

export default function Dashboard() {
  const [status, setStatus] = useState<AtlasStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    drAtlas.log('feature_mount', 'ui', 'dashboard')
    let cancelled = false
    void (async () => {
      try {
        const s = await fetchStatus()
        if (!cancelled) setStatus(s)
      } catch (err) {
        if (!cancelled) setStatusError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const ships24h = status?.done_24h ?? 0
  const queued = status?.queued ?? 0
  const failed24h = status?.failed_24h ?? 0
  const trustMode = status?.trust_mode ?? 'unknown'

  return (
    <>
      <Helmet>
        <title>CropsIntel — build progress</title>
      </Helmet>
      <main className="min-h-screen bg-white dark:bg-slate-950 px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-8">
          <header className="space-y-2">
            <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold">
              <Sparkles className="size-3" aria-hidden />
              CropsIntel V3
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Almond market intelligence — building in the open
            </h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 max-w-2xl">
              The customer dashboard ships once Adela&apos;s scrapers have produced
              enough history. Until then, here&apos;s what the autonomous build pipeline
              is doing right now.
            </p>
          </header>

          <section
            aria-label="Pipeline activity"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Stat
              icon={<Hammer className="size-4" aria-hidden />}
              label="Ships (24h)"
              value={loading ? '…' : String(ships24h)}
              tone="emerald"
            />
            <Stat
              icon={<Clock className="size-4" aria-hidden />}
              label="In queue"
              value={loading ? '…' : String(queued)}
              tone="amber"
            />
            <Stat
              icon={<Activity className="size-4" aria-hidden />}
              label="Failed (24h)"
              value={loading ? '…' : String(failed24h)}
              tone={failed24h > 0 ? 'red' : 'slate'}
            />
            <Stat
              icon={<TrendingUp className="size-4" aria-hidden />}
              label="Trust mode"
              value={loading ? '…' : String(trustMode)}
              tone="slate"
            />
          </section>

          {statusError && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
            >
              Live status unavailable ({statusError}). Numbers above are best-effort.
            </div>
          )}

          <section
            aria-labelledby="roadmap-heading"
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 sm:p-5"
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2
                  id="roadmap-heading"
                  className="text-base sm:text-lg font-semibold tracking-tight"
                >
                  Roadmap
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Each phase ships when its dependencies are green.
                </p>
              </div>
              <Link
                to="/atlas"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
              >
                Open Atlas cockpit
                <ExternalLink className="size-3" aria-hidden />
              </Link>
            </div>
            <ol className="mt-4 space-y-2">
              {ROADMAP.map((p) => (
                <li
                  key={p.phase}
                  className="rounded-md border border-slate-100 dark:border-slate-800/50 px-3 py-2.5"
                >
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-slate-500">
                        {p.phase}
                      </span>
                      <span className="font-medium text-sm">{p.title}</span>
                    </div>
                    <PhaseBadge status={p.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{p.blurb}</p>
                </li>
              ))}
            </ol>
          </section>

          <section
            aria-label="Data foundation"
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4 sm:p-5"
          >
            <div className="flex items-start gap-3">
              <span className="grid place-items-center size-9 shrink-0 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                <Database className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">
                  Adela is feeding the data lake
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                  ABC almond position reports, Strata pricing, and global news flow
                  into Supabase on three crons (15 min / 1 h / 30 min).
                  When the historical depth is enough to chart trends and detect
                  anomalies, this page becomes the live dashboard.
                </p>
                <p className="mt-2 text-[11px] text-slate-500">
                  Memory chunks indexed:{' '}
                  <span className="font-mono tabular-nums">
                    {loading ? '…' : (status?.memory_chunk_count ?? 0).toLocaleString()}
                  </span>
                  {' · '}
                  Verifier pass rate:{' '}
                  <span className="font-mono tabular-nums">
                    {loading ? '…' : `${Math.round((status?.verifier_pass_rate ?? 0) * 100)}%`}
                  </span>
                </p>
              </div>
            </div>
          </section>

          <footer className="text-center text-[11px] text-slate-500 pt-4 border-t border-slate-200 dark:border-slate-800">
            CropsIntel V3 is built by autonomous agents per the master plan.
            Production-house agents ship first; customer surfaces follow.
          </footer>
        </div>
      </main>
    </>
  )
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'emerald' | 'amber' | 'red' | 'slate'
}) {
  const toneClasses: Record<typeof tone, string> = {
    emerald: 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200',
    amber: 'border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200',
    red: 'border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200',
    slate: 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100',
  }
  return (
    <div className={cn('rounded-md border p-3', toneClasses[tone])}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider opacity-80">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function PhaseBadge({ status }: { status: RoadmapPhase['status'] }) {
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
        <span className="size-1.5 rounded-full bg-emerald-500" /> Live
      </span>
    )
  }
  if (status === 'in-flight') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" /> In flight
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      Planned
    </span>
  )
}
