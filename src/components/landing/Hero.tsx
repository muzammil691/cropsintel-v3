import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950" aria-hidden />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live almond market data
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Almond market intelligence,<br />
            <span className="bg-gradient-to-r from-emerald-700 to-emerald-500 bg-clip-text text-transparent">
              built for global trading houses
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
            Track shipments, monitor prices, manage relationships, and get AI-driven prescriptions —
            all in one CRM-grade workspace, made for importers, brokers, and growers across the global almond chain.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild size="lg">
              <Link to="/signup">Start free</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/insights">Browse market</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
