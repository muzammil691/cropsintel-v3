// 1.10bb-c Session 9A — Connections vault page.
//
// Read+Test+Reveal+Delete surface for atlas_connections rows. Add /
// Edit / Rotate land in 9B (need the per-provider AddConnectionSheet
// forms). Cards group by category — AI Models, Code, Hosting, Database,
// Comms, Billing, Custom.

import { useEffect, useState } from 'react'
import { RefreshCw, Plug, AlertTriangle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnectionCard } from '@/components/atlas/ConnectionCard'
import { listConnections, type AtlasConnection, type ConnectionProvider } from '@/lib/atlas-client'
import { cn } from '@/lib/utils'

type Category = 'AI Models' | 'Code' | 'Hosting' | 'Database' | 'Comms' | 'Billing' | 'Custom'

const CATEGORY_ORDER: Category[] = ['AI Models', 'Code', 'Hosting', 'Database', 'Comms', 'Billing', 'Custom']

const CATEGORY_FOR_PROVIDER: Record<ConnectionProvider, Category> = {
  anthropic: 'AI Models', openai: 'AI Models', gemini: 'AI Models',
  github: 'Code',
  vercel: 'Hosting', netlify: 'Hosting', railway: 'Hosting',
  supabase: 'Database', neon: 'Database',
  twilio: 'Comms',
  stripe: 'Billing',
  custom: 'Custom',
}

export function ConnectionsPage() {
  const [connections, setConnections] = useState<AtlasConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    setLoading(true)
    setError(null)
    listConnections()
      .then(setConnections)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [])

  const byCategory: Record<Category, AtlasConnection[]> = {
    'AI Models': [], Code: [], Hosting: [], Database: [], Comms: [], Billing: [], Custom: [],
  }
  for (const c of connections) {
    byCategory[CATEGORY_FOR_PROVIDER[c.provider]].push(c)
  }

  return (
    <div className="px-3 sm:px-5 py-4 max-w-5xl mx-auto w-full space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <Plug className="size-4 text-emerald-600" aria-hidden /> Connections
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            Credentials Atlas uses to build, ship, and observe. Secrets are encrypted
            at rest via libsodium with a Railway-held key (ATLAS_VAULT_KEY).
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={loading}
            className="text-xs h-8"
            aria-label="Refresh"
          >
            <RefreshCw className={cn('size-3', loading && 'animate-spin')} aria-hidden />
            <span className="ml-1">Refresh</span>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled
            title="Add connection lands in Session 9B"
            className="text-xs h-8 bg-emerald-700 hover:bg-emerald-800 text-white"
          >
            <Plus className="size-3 mr-1" aria-hidden />
            Add connection
          </Button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {loading && connections.length === 0 && (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-36 rounded-lg bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && connections.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-6 py-10 text-center">
          <Plug className="size-5 mx-auto text-slate-400 mb-2" aria-hidden />
          <p className="text-sm text-slate-700 dark:text-slate-200 font-medium">No connections yet.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            The Add Connection flow lands in Session 9B. Until then, you can
            import existing credentials via the orchestrator's CLI.
          </p>
        </div>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const list = byCategory[cat]
        if (list.length === 0) return null
        return (
          <section key={cat} aria-labelledby={`cat-${cat}`}>
            <h2
              id={`cat-${cat}`}
              className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2"
            >
              {cat} <span className="tabular-nums text-slate-400">({list.length})</span>
            </h2>
            <div className="flex flex-wrap gap-3">
              {list.map((c) => (
                <ConnectionCard key={c.id} connection={c} onChanged={refresh} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export default ConnectionsPage
