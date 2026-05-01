// Phase 1.10ab — /atlas-brain page (admin Multi-Brain debate UI).
//
// Two-pane on desktop (rail left, detail right), three tabs on mobile.
// RBAC: admin or team only — guarded inline since RouteGuard tier names
// pre-date the AuthGuard tier system used elsewhere.

import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Navigate } from 'react-router-dom'
import { Brain } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { LoadingScreen } from '@/components/auth/LoadingScreen'
import { useBrainNodes } from '@/hooks/useBrainNodes'
import { adjustNodeScore, fetchBrainCosts, type BrainCostSummary } from '@/lib/brain-client'
import { drAtlas } from '@/lib/drAtlas'
import { BrainNodeList } from '@/components/atlas-brain/BrainNodeList'
import { BrainNodeDetail } from '@/components/atlas-brain/BrainNodeDetail'
import { CostFooter } from '@/components/atlas-brain/CostFooter'
import { AtlasTopNav } from '@/components/atlas/AtlasTopNav'
import { cn } from '@/lib/utils'

type MobileTab = 'list' | 'detail'

export default function AtlasBrain() {
  const { user, isLoading, isAdmin, isTeam } = useAuth()
  const allowed = isAdmin || isTeam
  const {
    nodes,
    loading: nodesLoading,
    error: nodesError,
    refresh: refreshNodes,
    setSearch,
    setCategory,
    search,
    category,
    categories,
  } = useBrainNodes()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [costs, setCosts] = useState<BrainCostSummary | null>(null)
  const [costsLoading, setCostsLoading] = useState(true)
  const [lastDebateThread, setLastDebateThread] = useState<string | undefined>(undefined)
  const [mobileTab, setMobileTab] = useState<MobileTab>('list')

  // drAtlas: page mount
  useEffect(() => {
    if (!allowed) return
    drAtlas.log('feature_mount', 'ui', 'atlas-brain')
  }, [allowed])

  // Auto-select first node when list arrives
  useEffect(() => {
    if (!selectedId && nodes.length > 0) {
      setSelectedId(nodes[0].id)
    }
    // If the selected node was filtered out, fall back to first visible
    if (selectedId && !nodes.some((n) => n.id === selectedId) && nodes.length > 0) {
      setSelectedId(nodes[0].id)
    }
  }, [nodes, selectedId])

  // Refresh costs on mount + after every debate
  useEffect(() => {
    if (!allowed) return
    setCostsLoading(true)
    fetchBrainCosts(lastDebateThread)
      .then(setCosts)
      .finally(() => setCostsLoading(false))
  }, [allowed, lastDebateThread])

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId])
  const budgetExhausted = !!costs && costs.month_to_date >= costs.budget

  if (isLoading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!allowed) return <Navigate to="/" replace />

  const onScoreAdjust = async (newScore: number, reason: string) => {
    if (!selected || !user) return
    const result = await adjustNodeScore(selected, newScore, reason, user.id)
    drAtlas.log('score_adjust', 'atlas', `Score for ${selected.node_key} changed from ${result.before} to ${result.after}`, {
      metadata: { node_key: selected.node_key, before: result.before, after: result.after, reason },
    })
    await refreshNodes()
  }

  const onAfterDebate = (threadId: string | null) => {
    if (threadId) setLastDebateThread(threadId)
  }

  return (
    <>
      <Helmet><title>Atlas Brain — CropsIntel</title></Helmet>
      <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <AtlasTopNav />
        <header className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3">
          <Brain className="size-5 text-emerald-600" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">Atlas Brain</h1>
            <p className="text-[11px] text-slate-500 leading-tight">Multi-Brain debate console</p>
          </div>
          <div className="flex-1" />
          <span className="hidden sm:inline text-[11px] text-slate-400">{nodes.length} nodes</span>
        </header>

        {/* Mobile tab switcher (List / Detail) */}
        <nav
          className="md:hidden flex border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
          role="tablist"
          aria-label="Atlas Brain sections"
        >
          <TabButton active={mobileTab === 'list'} onClick={() => setMobileTab('list')}>
            Nodes
          </TabButton>
          <TabButton
            active={mobileTab === 'detail'}
            onClick={() => setMobileTab('detail')}
            disabled={!selected}
          >
            Detail{selected ? ` · ${selected.label}` : ''}
          </TabButton>
        </nav>

        {nodesError && (
          <div className="px-3 py-2 text-xs text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-400 border-b border-red-200 dark:border-red-900" role="alert">
            {nodesError}
          </div>
        )}

        <main className="flex-1 min-h-0 flex flex-col md:flex-row">
          <aside
            className={cn(
              'md:w-72 md:shrink-0 md:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 min-h-0',
              mobileTab === 'list' ? 'flex flex-col flex-1' : 'hidden md:flex md:flex-col',
            )}
            aria-label="Brain nodes rail"
          >
            <BrainNodeList
              nodes={nodes}
              loading={nodesLoading}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id)
                setMobileTab('detail')
              }}
              search={search}
              onSearchChange={setSearch}
              category={category}
              onCategoryChange={setCategory}
              categories={categories}
            />
          </aside>

          <section
            className={cn(
              'flex-1 min-h-0 bg-slate-50 dark:bg-slate-950',
              mobileTab === 'detail' ? 'flex flex-col flex-1' : 'hidden md:flex md:flex-col md:flex-1',
            )}
            aria-label="Selected node detail"
          >
            <BrainNodeDetail
              node={selected}
              onScoreAdjust={onScoreAdjust}
              onAfterDebate={onAfterDebate}
              budgetExhausted={budgetExhausted}
            />
          </section>
        </main>

        <CostFooter costs={costs} loading={costsLoading} />
      </div>
    </>
  )
}

function TabButton({
  children,
  active,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
        active
          ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
          : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      {children}
    </button>
  )
}
