import { useEffect, useState, useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import {
  FileText,
  Filter,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { computeYoY } from '@/lib/position-report-analytics'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

type PositionReport = Database['public']['Tables']['position_reports']['Row']

interface GroupedReports {
  [market: string]: PositionReport[]
}

type SortKey = 'report_date' | 'total_shipments_lbs' | 'total_inventory_lbs'
type SortOrder = 'asc' | 'desc'

const filterInputClass =
  'w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 sm:py-1.5 text-sm transition-colors duration-200 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:border-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed'

export default function PositionReports() {
  const [reports, setReports] = useState<PositionReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [marketFilter, setMarketFilter] = useState('')

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('report_date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  // Detail drawer
  const [selectedReport, setSelectedReport] = useState<PositionReport | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchReports() {
      try {
        setLoading(true)
        setError(null)

        const query = supabase
          .from('position_reports')
          .select('*')
          .order('report_date', { ascending: false })

        const { data, error: fetchError } = await query

        if (fetchError) throw fetchError

        if (!cancelled) {
          setReports(data || [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch position reports')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchReports()

    return () => {
      cancelled = true
    }
  }, [])

  // Filter and sort reports
  const filteredAndSortedReports = useMemo(() => {
    let filtered = [...reports]

    if (dateFrom) {
      filtered = filtered.filter((r) => r.report_date >= dateFrom)
    }
    if (dateTo) {
      filtered = filtered.filter((r) => r.report_date <= dateTo)
    }

    if (marketFilter) {
      const lowerFilter = marketFilter.toLowerCase()
      filtered = filtered.filter((r) =>
        r.source.toLowerCase().includes(lowerFilter)
      )
    }

    filtered.sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]

      if (aVal === null && bVal === null) return 0
      if (aVal === null) return 1
      if (bVal === null) return -1

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      return sortOrder === 'asc' ? comparison : -comparison
    })

    return filtered
  }, [reports, dateFrom, dateTo, marketFilter, sortKey, sortOrder])

  const groupedReports = useMemo(() => {
    const grouped: GroupedReports = {}
    for (const report of filteredAndSortedReports) {
      const market = report.source
      if (!grouped[market]) {
        grouped[market] = []
      }
      grouped[market].push(report)
    }
    return grouped
  }, [filteredAndSortedReports])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder('desc')
    }
  }

  if (loading) {
    return (
      <>
        <Helmet>
          <title>Position Reports — CropsIntel</title>
        </Helmet>
        <main className="min-h-screen bg-white dark:bg-slate-950 px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="mx-auto max-w-7xl">
            <PositionReportsSkeleton />
          </div>
        </main>
      </>
    )
  }

  if (error) {
    return (
      <>
        <Helmet>
          <title>Position Reports — CropsIntel</title>
        </Helmet>
        <main className="min-h-screen bg-white dark:bg-slate-950 px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="mx-auto max-w-7xl">
            <ErrorState message={error} />
          </div>
        </main>
      </>
    )
  }

  if (reports.length === 0) {
    return (
      <>
        <Helmet>
          <title>Position Reports — CropsIntel</title>
        </Helmet>
        <main className="min-h-screen bg-white dark:bg-slate-950 px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="mx-auto max-w-7xl">
            <EmptyState />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Helmet>
        <title>Position Reports — CropsIntel</title>
      </Helmet>
      <main className="min-h-screen bg-white dark:bg-slate-950 px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">
          <header className="space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="size-5 text-emerald-600 dark:text-emerald-400" />
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight">
                Position Reports
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
              Monthly market position reports showing shipments, inventory, and YoY trends
            </p>
          </header>

          {/* Filters */}
          <section
            aria-label="Filters"
            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 sm:p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Filter className="size-4 text-slate-500" />
              <span className="text-sm font-medium">Filters</span>
            </div>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label
                  htmlFor="date-from"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
                >
                  From Date
                </label>
                <input
                  type="date"
                  id="date-from"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={filterInputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="date-to"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
                >
                  To Date
                </label>
                <input
                  type="date"
                  id="date-to"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={filterInputClass}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <label
                  htmlFor="market"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
                >
                  Market
                </label>
                <input
                  type="text"
                  id="market"
                  placeholder="Search markets..."
                  value={marketFilter}
                  onChange={(e) => setMarketFilter(e.target.value)}
                  className={filterInputClass}
                />
              </div>
            </div>
          </section>

          {/* Results count */}
          <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
            Showing {filteredAndSortedReports.length} report
            {filteredAndSortedReports.length !== 1 ? 's' : ''} across{' '}
            {Object.keys(groupedReports).length} market
            {Object.keys(groupedReports).length !== 1 ? 's' : ''}
          </div>

          {/* Grouped tables */}
          {Object.keys(groupedReports).length === 0 ? (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-6 sm:p-8 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No reports match your filters
              </p>
            </div>
          ) : (
            <div className="space-y-4 sm:space-y-6">
              {Object.entries(groupedReports).map(([market, marketReports]) => (
                <section key={market} className="space-y-3">
                  <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2 flex-wrap">
                    <span>{market}</span>
                    <span className="text-xs font-normal text-slate-500">
                      ({marketReports.length} report{marketReports.length !== 1 ? 's' : ''})
                    </span>
                  </h2>

                  {/* Mobile: card list */}
                  <ul className="space-y-2 sm:hidden" aria-label={`${market} reports`}>
                    {marketReports.map((report, idx) => {
                      const priorReport =
                        idx < marketReports.length - 1 ? marketReports[idx + 1] : null
                      const yoyResult =
                        priorReport &&
                        report.total_shipments_lbs &&
                        priorReport.total_shipments_lbs
                          ? computeYoY(report.total_shipments_lbs, priorReport.total_shipments_lbs)
                          : null
                      return (
                        <li key={report.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedReport(report)}
                            className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 px-4 py-3 transition-colors duration-200 hover:bg-slate-50 dark:hover:bg-slate-900/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                  {new Date(report.report_date).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </p>
                                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                                  <dt className="text-slate-500 dark:text-slate-400">Shipments</dt>
                                  <dd className="text-right tabular-nums text-slate-900 dark:text-slate-100">
                                    {report.total_shipments_lbs?.toLocaleString() ?? '—'}
                                  </dd>
                                  <dt className="text-slate-500 dark:text-slate-400">Inventory</dt>
                                  <dd className="text-right tabular-nums text-slate-900 dark:text-slate-100">
                                    {report.total_inventory_lbs?.toLocaleString() ?? '—'}
                                  </dd>
                                </dl>
                              </div>
                              <div className="shrink-0">
                                {yoyResult ? (
                                  <YoYBadge result={yoyResult} />
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>

                  {/* Tablet/desktop: table */}
                  <div className="hidden sm:block rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <SortableHeader
                              label="Report Date"
                              sortKey="report_date"
                              currentSortKey={sortKey}
                              sortOrder={sortOrder}
                              onSort={toggleSort}
                            />
                            <SortableHeader
                              label="Total Shipments (lbs)"
                              sortKey="total_shipments_lbs"
                              currentSortKey={sortKey}
                              sortOrder={sortOrder}
                              onSort={toggleSort}
                            />
                            <SortableHeader
                              label="Total Inventory (lbs)"
                              sortKey="total_inventory_lbs"
                              currentSortKey={sortKey}
                              sortOrder={sortOrder}
                              onSort={toggleSort}
                            />
                            <th
                              scope="col"
                              className="px-4 py-3 text-left text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider"
                            >
                              YoY Δ
                            </th>
                            <th
                              scope="col"
                              className="px-4 py-3 text-right text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider"
                            >
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-slate-950 divide-y divide-slate-100 dark:divide-slate-900">
                          {marketReports.map((report, idx) => {
                            const priorReport =
                              idx < marketReports.length - 1 ? marketReports[idx + 1] : null
                            const yoyResult =
                              priorReport &&
                              report.total_shipments_lbs &&
                              priorReport.total_shipments_lbs
                                ? computeYoY(
                                    report.total_shipments_lbs,
                                    priorReport.total_shipments_lbs
                                  )
                                : null

                            return (
                              <tr
                                key={report.id}
                                className="transition-colors duration-200 hover:bg-slate-50 dark:hover:bg-slate-900/30"
                              >
                                <td className="px-4 py-3 font-medium">
                                  {new Date(report.report_date).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </td>
                                <td className="px-4 py-3 tabular-nums">
                                  {report.total_shipments_lbs?.toLocaleString() ?? '—'}
                                </td>
                                <td className="px-4 py-3 tabular-nums">
                                  {report.total_inventory_lbs?.toLocaleString() ?? '—'}
                                </td>
                                <td className="px-4 py-3">
                                  {yoyResult ? (
                                    <YoYBadge result={yoyResult} />
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedReport(report)}
                                    aria-label={`View details for report on ${new Date(
                                      report.report_date
                                    ).toLocaleDateString('en-US', {
                                      year: 'numeric',
                                      month: 'long',
                                      day: 'numeric',
                                    })}`}
                                    className="inline-flex items-center gap-1 rounded-md text-xs text-emerald-600 dark:text-emerald-400 transition-colors duration-200 hover:text-emerald-700 dark:hover:text-emerald-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 px-1 py-0.5"
                                  >
                                    Details
                                    <ExternalLink className="size-3" aria-hidden="true" />
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Detail Drawer — shadcn Sheet (Radix Dialog) gives focus trap, Escape, aria-modal */}
      <Sheet
        open={selectedReport !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedReport(null)
        }}
      >
        <SheetContent side="right">
          {selectedReport && <DetailDrawerBody report={selectedReport} />}
        </SheetContent>
      </Sheet>
    </>
  )
}

function SortableHeader({
  label,
  sortKey,
  currentSortKey,
  sortOrder,
  onSort,
}: {
  label: string
  sortKey: SortKey
  currentSortKey: SortKey
  sortOrder: SortOrder
  onSort: (key: SortKey) => void
}) {
  const isActive = currentSortKey === sortKey
  const ariaSort: 'ascending' | 'descending' | 'none' = isActive
    ? sortOrder === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'

  const directionLabel = isActive
    ? sortOrder === 'asc'
      ? 'sorted ascending, click to sort descending'
      : 'sorted descending, click to sort ascending'
    : 'not sorted, click to sort descending'

  const SortIcon = isActive ? (sortOrder === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className="px-4 py-3 text-left text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider"
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`${label}, ${directionLabel}`}
        className="inline-flex items-center gap-1 rounded-md transition-colors duration-200 hover:text-slate-900 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 px-1 py-0.5"
      >
        {label}
        <SortIcon
          className={cn(
            'size-3 shrink-0',
            isActive
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-slate-400 dark:text-slate-500'
          )}
          aria-hidden="true"
        />
      </button>
    </th>
  )
}

function YoYBadge({
  result,
}: {
  result: { value: number; trend: 'up' | 'down' | 'flat'; confidence: number }
}) {
  const { value, trend } = result
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus

  const toneClasses = {
    up: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/40',
    down: 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/40',
    flat: 'bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        toneClasses[trend]
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  )
}

function DetailDrawerBody({ report }: { report: PositionReport }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>Position Report Details</SheetTitle>
        <SheetDescription>
          {report.source} —{' '}
          {new Date(report.report_date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">
        <DetailField label="Source" value={report.source} />
        <DetailField
          label="Report Date"
          value={new Date(report.report_date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        />
        <DetailField
          label="Total Shipments"
          value={
            report.total_shipments_lbs
              ? `${report.total_shipments_lbs.toLocaleString()} lbs`
              : '—'
          }
        />
        <DetailField
          label="Total Inventory"
          value={
            report.total_inventory_lbs
              ? `${report.total_inventory_lbs.toLocaleString()} lbs`
              : '—'
          }
        />
        <DetailField
          label="Domestic Shipments"
          value={
            report.domestic_shipments_lbs
              ? `${report.domestic_shipments_lbs.toLocaleString()} lbs`
              : '—'
          }
        />
        <DetailField
          label="Export Shipments"
          value={
            report.export_shipments_lbs
              ? `${report.export_shipments_lbs.toLocaleString()} lbs`
              : '—'
          }
        />
        <DetailField label="Ingested At" value={new Date(report.ingested_at).toLocaleString()} />
        <DetailField label="Ingested By" value={report.ingested_by} />

        {report.report_url && (
          <div>
            <a
              href={report.report_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md text-sm text-emerald-600 dark:text-emerald-400 transition-colors duration-200 hover:text-emerald-700 dark:hover:text-emerald-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 px-1 py-0.5"
            >
              View Source Report
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
        )}

        {report.extracted && Object.keys(report.extracted).length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Extracted Data
            </h3>
            <pre className="text-xs bg-slate-50 dark:bg-slate-900 rounded-md p-3 overflow-x-auto border border-slate-200 dark:border-slate-800">
              {JSON.stringify(report.extracted, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-900 dark:text-slate-100 break-words">{value}</dd>
    </div>
  )
}

function PositionReportsSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6" aria-label="Loading position reports" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 sm:h-8 w-48 sm:w-64" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      {/* Filter card skeleton */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 sm:p-4 space-y-3">
        <Skeleton className="h-4 w-20" />
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      </div>
      {/* Group skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="space-y-px">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-none" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-6 sm:p-8 text-center"
    >
      <AlertCircle
        className="size-8 sm:size-10 text-red-600 dark:text-red-400 mx-auto mb-3"
        aria-hidden="true"
      />
      <h2 className="text-base sm:text-lg font-semibold text-red-900 dark:text-red-200 mb-2">
        Failed to Load Position Reports
      </h2>
      <p className="text-sm text-red-700 dark:text-red-300 break-words">{message}</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-8 sm:p-12 text-center">
      <FileText
        className="size-10 sm:size-12 text-slate-400 dark:text-slate-600 mx-auto mb-3"
        aria-hidden="true"
      />
      <h2 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
        No Position Reports Yet
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Position reports will appear here once Adela has ingested data from ABC and other sources.
      </p>
    </div>
  )
}
