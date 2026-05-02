import { Megaphone, GitCommit } from 'lucide-react'
import type { TeamPortalAnnouncements } from '@/lib/atlas-client'
import { cn } from '@/lib/utils'

interface AnnouncementsBannerProps {
  announcements: TeamPortalAnnouncements | null
  loading: boolean
}

const HEALTH_TONE: Record<TeamPortalAnnouncements['build_health']['overall'], string> = {
  ok: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900/40',
  degraded: 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-900/40',
  issue: 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 border-red-200 dark:border-red-900/40',
  unknown: 'bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800',
}

const HEALTH_DOT: Record<TeamPortalAnnouncements['build_health']['overall'], string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  issue: 'bg-red-500',
  unknown: 'bg-slate-400',
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ts
  }
}

export function AnnouncementsBanner({ announcements, loading }: AnnouncementsBannerProps) {
  if (loading && !announcements) {
    return (
      <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 sm:p-4">
        <div className="h-4 w-1/3 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
        <div className="mt-2 h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
      </div>
    )
  }

  if (!announcements) {
    return null
  }

  const { build_health, recent_ships, pinned_messages } = announcements

  return (
    <section className="space-y-2">
      <div
        className={cn(
          'rounded-md border px-3 py-2 sm:px-4 sm:py-3 flex items-start gap-2',
          HEALTH_TONE[build_health.overall],
        )}
      >
        <span className={cn('mt-1 size-2 rounded-full shrink-0', HEALTH_DOT[build_health.overall])} aria-hidden />
        <span className="sr-only">Build health: {build_health.overall}.</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {build_health.summary || 'Build status unavailable'}
          </p>
          <p className="text-[11px] mt-0.5 opacity-80 tabular-nums">
            ${build_health.cost_today_usd.toFixed(2)} today
            <> · {build_health.queue_depth} queued · {build_health.in_flight} in-flight</>
            {build_health.failed_24h > 0 && <> · {build_health.failed_24h} failed/24h</>}
            <> · as of {formatTime(build_health.captured_at)}</>
          </p>
        </div>
      </div>

      {(recent_ships.length > 0 || pinned_messages.length > 0) && (
        <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 sm:p-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 inline-flex items-center gap-1.5">
            <Megaphone className="size-3" /> Announcements from Atlas
          </h3>
          <ul className="mt-2 space-y-1.5 text-xs">
            {pinned_messages.map((m) => (
              <li key={m.id} className="text-slate-700 dark:text-slate-200">
                · {m.body}
                <span className="ml-1 text-[10px] text-slate-400">{formatTime(m.posted_at)}</span>
              </li>
            ))}
            {recent_ships.slice(0, 3).map((s, idx) => (
              <li key={s.sha ?? idx} className="text-slate-600 dark:text-slate-300 inline-flex items-start gap-1.5">
                <GitCommit className="size-3 mt-0.5 shrink-0" />
                <span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {s.sha ? s.sha.slice(0, 7) : '———'}
                  </span>{' '}
                  {s.summary}
                  <span className="ml-1 text-[10px] text-slate-400">{formatTime(s.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
