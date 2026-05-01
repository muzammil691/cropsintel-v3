// Phase 1.10ac — /atlas-pd page (admin Project Development cockpit).
//
// Seven-tab orchestrator: Master Plan, Proposals, Approvals, Evidence,
// Decision Log, Validation, Benchmarks, Review Bundles. Tab + filter state
// persists in URL params so deep-links work (Linear-pattern from research).
// RBAC: admin or team only — gated inline like /atlas-brain.

import { useEffect, useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import { Navigate, useSearchParams } from 'react-router-dom'
import {
  ClipboardList,
  FileText,
  CheckSquare,
  Paperclip,
  History,
  ShieldCheck,
  Activity,
  PackageOpen,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { LoadingScreen } from '@/components/auth/LoadingScreen'
import { drAtlas } from '@/lib/drAtlas'
import { cn } from '@/lib/utils'
import { MasterPlanView } from '@/components/atlas-pd/MasterPlanView'
import { ProposalsTab } from '@/components/atlas-pd/ProposalsTab'
import { ApprovalsTab } from '@/components/atlas-pd/ApprovalsTab'
import { EvidenceTab } from '@/components/atlas-pd/EvidenceTab'
import { DecisionLogTab } from '@/components/atlas-pd/DecisionLogTab'
import { ValidationTab } from '@/components/atlas-pd/ValidationTab'
import { BenchmarksTab } from '@/components/atlas-pd/BenchmarksTab'
import { ReviewBundlesTab } from '@/components/atlas-pd/ReviewBundlesTab'
import { AtlasTopNav } from '@/components/atlas/AtlasTopNav'

type TabKey =
  | 'master-plan'
  | 'proposals'
  | 'approvals'
  | 'evidence'
  | 'decisions'
  | 'validation'
  | 'benchmarks'
  | 'bundles'

interface TabDef {
  key: TabKey
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const TABS: TabDef[] = [
  { key: 'master-plan', label: 'Master Plan', icon: ClipboardList },
  { key: 'proposals',   label: 'Proposals',   icon: FileText },
  { key: 'approvals',   label: 'Approvals',   icon: CheckSquare },
  { key: 'evidence',    label: 'Evidence',    icon: Paperclip },
  { key: 'decisions',   label: 'Decision Log', icon: History },
  { key: 'validation',  label: 'Validation',  icon: ShieldCheck },
  { key: 'benchmarks',  label: 'Benchmarks',  icon: Activity },
  { key: 'bundles',     label: 'Review Bundles', icon: PackageOpen },
]

export default function AtlasPD() {
  const { user, isLoading, isAdmin, isTeam } = useAuth()
  const allowed = isAdmin || isTeam
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey | null) ?? 'master-plan'
  const activeTab = useMemo<TabKey>(
    () => (TABS.some((t) => t.key === tab) ? tab : 'master-plan'),
    [tab],
  )

  useEffect(() => {
    if (!allowed) return
    drAtlas.log('feature_mount', 'ui', 'atlas-pd', { metadata: { tab: activeTab } })
  }, [allowed, activeTab])

  if (isLoading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!allowed) return <Navigate to="/" replace />

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }

  return (
    <>
      <Helmet><title>Atlas PD — CropsIntel</title></Helmet>
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <AtlasTopNav />
        <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3">
          <ClipboardList className="size-5 text-emerald-600" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">Atlas PD</h1>
            <p className="text-[11px] text-slate-500 leading-tight">Project development cockpit</p>
          </div>
        </header>

        <nav
          role="tablist"
          aria-label="Atlas PD tabs"
          className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto"
        >
          <div className="flex min-w-max">
            {TABS.map((t) => {
              const Icon = t.icon
              const active = activeTab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                    active
                      ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {t.label}
                </button>
              )
            })}
          </div>
        </nav>

        <main className="flex-1 min-h-0 overflow-auto">
          {activeTab === 'master-plan' && <MasterPlanView />}
          {activeTab === 'proposals'   && <ProposalsTab />}
          {activeTab === 'approvals'   && <ApprovalsTab />}
          {activeTab === 'evidence'    && <EvidenceTab />}
          {activeTab === 'decisions'   && <DecisionLogTab />}
          {activeTab === 'validation'  && <ValidationTab />}
          {activeTab === 'benchmarks'  && <BenchmarksTab />}
          {activeTab === 'bundles'     && <ReviewBundlesTab />}
        </main>
      </div>
    </>
  )
}
