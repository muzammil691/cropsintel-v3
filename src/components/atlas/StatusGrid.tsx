import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { CostMeter } from './CostMeter'
import { ForkList } from './ForkList'
import { RecentShips } from './RecentShips'
import type { AtlasStatus, AtlasCosts } from '@/lib/atlas-client'

interface KpiCardProps {
  label: string
  value: number | string
  sub?: string
  accent?: 'normal' | 'warn' | 'danger'
}

function KpiCard({ label, value, sub, accent = 'normal' }: KpiCardProps) {
  const valueColor =
    accent === 'danger'
      ? 'text-red-500'
      : accent === 'warn'
        ? 'text-amber-500'
        : 'text-foreground'
  return (
    <div className="rounded-lg border bg-card p-3 flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${valueColor}`}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  )
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {title && <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>}
      {children}
    </div>
  )
}

interface StatusGridProps {
  status: AtlasStatus | null
  costs: AtlasCosts | null
  loading: boolean
  error: string | null
}

export function StatusGrid({ status, costs, loading, error }: StatusGridProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Unable to reach Atlas: {error}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Phase heading */}
      <Card>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-muted-foreground">Current phase</span>
          {loading && !status ? (
            <div className="h-7 w-20 rounded bg-muted animate-pulse" />
          ) : (
            <span className="text-2xl font-bold">{status?.current_phase ?? '—'}</span>
          )}
        </div>
        {status && (
          <div className="text-xs text-muted-foreground">
            {status.memory_chunk_count.toLocaleString()} memory chunks
          </div>
        )}
      </Card>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-2">
        <KpiCard
          label="Queued"
          value={loading && !status ? '…' : (status?.queued ?? 0)}
        />
        <KpiCard
          label="In-flight"
          value={loading && !status ? '…' : (status?.in_flight ?? 0)}
          accent={status && status.in_flight > 3 ? 'warn' : 'normal'}
        />
        <KpiCard
          label="Done (24h)"
          value={loading && !status ? '…' : (status?.done_24h ?? 0)}
          accent="normal"
        />
        <KpiCard
          label="Failed (24h)"
          value={loading && !status ? '…' : (status?.failed_24h ?? 0)}
          accent={status && status.failed_24h > 0 ? 'danger' : 'normal'}
        />
      </div>

      {/* Cost meter */}
      <Card title="AI Cost">
        <CostMeter costs={costs} loading={loading} />
      </Card>

      {/* Verifier sparkline */}
      {(status?.verifier_history?.length ?? 0) > 0 && (
        <Card title={`Verifier pass rate — ${(status!.verifier_pass_rate * 100).toFixed(0)}%`}>
          <ResponsiveContainer width="100%" height={60}>
            <BarChart data={status!.verifier_history} margin={{ top: 0, bottom: 0, left: 0, right: 0 }}>
              <XAxis dataKey="t" hide />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null
                  const d = payload[0].payload as { t: string; pass: number; fail: number }
                  return (
                    <div className="rounded border bg-popover px-2 py-1 text-xs shadow">
                      <p>{d.t}</p>
                      <p className="text-emerald-600">pass: {d.pass}</p>
                      <p className="text-red-500">fail: {d.fail}</p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="pass" stackId="a" radius={[2, 2, 0, 0]}>
                {status!.verifier_history.map((_, i) => (
                  <Cell key={i} fill="rgb(16 185 129)" />
                ))}
              </Bar>
              <Bar dataKey="fail" stackId="a" radius={[2, 2, 0, 0]}>
                {status!.verifier_history.map((_, i) => (
                  <Cell key={i} fill="rgb(239 68 68)" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Open forks */}
      <Card title={`Open forks (${status?.forks?.length ?? 0})`}>
        <ForkList forks={status?.forks ?? []} />
      </Card>

      {/* Recent ships */}
      <Card title="Recent activity">
        <RecentShips ships={status?.recent_ships ?? []} loading={loading && !status} />
      </Card>
    </div>
  )
}
