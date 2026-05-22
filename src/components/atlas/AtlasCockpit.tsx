import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronUp, MessageCircle } from 'lucide-react'
import { AtlasTopNav } from './AtlasTopNav'
import { AtlasHeader } from './AtlasHeader'
import { AtlasTabBar, ATLAS_TABS, type AtlasTabKey } from './AtlasTabBar'
import { CockpitChat } from './CockpitChat'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PwaInstallPrompt } from '@/components/PwaInstallPrompt'
import { LiveModePanel } from './LiveModePanel'
import { VerifierDialogPopup } from '@/components/atlas-plan/VerifierDialogPopup'
import { FailingConnectionBanner } from '@/components/atlas/FailingConnectionBanner'
import { WorkshopErrorBoundary } from '@/components/atlas-plan/WorkshopErrorBoundary'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { useAtlasStatus } from '@/hooks/useAtlasStatus'
import { useArtifacts } from '@/hooks/useArtifacts'
import { useTts } from '@/hooks/useTts'
import { useLiveMode } from '@/hooks/useLiveMode'
import { useAgentHeartbeats } from '@/hooks/useAgentHeartbeats'
import { listPausedDispatches, type PausedDispatch, type TrustMode } from '@/lib/atlas-client'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Lazy-load each tab so the initial cockpit bundle stays small (per spec
// risk note — initial cockpit bundle stays under 100KB gzipped).
const AtlasPlanTab = lazy(() => import('./tabs/AtlasPlanTab'))
// 1.10bb-c Session 7 — PlanWorkshop is the heaviest tab chunk (~36 kB
// gzipped) AND the one that crashed in prod with "Importing a module script
// failed" after a GitHub Pages deploy. lazyWithRetry reloads the page once on
// chunk-load errors so a stale index.html → new asset hash mismatch self-heals.
const PlanWorkshop = lazyWithRetry(() => import('../atlas-plan/PlanWorkshop'), 'plan-workshop')
const AtlasQueueTab = lazy(() => import('./tabs/AtlasQueueTab'))
const AtlasAgentsTab = lazy(() => import('./tabs/AtlasAgentsTab'))
const AtlasAuditTab = lazy(() => import('./tabs/AtlasAuditTab'))
const AtlasWorkflowTab = lazy(() => import('./tabs/AtlasWorkflowTab'))
const AtlasArtifactsTab = lazy(() => import('./tabs/AtlasArtifactsTab'))
const AtlasTeamTab = lazy(() => import('./tabs/AtlasTeamTab'))
const AtlasPreviewTab = lazy(() => import('./tabs/AtlasPreviewTab'))

const VALID_TABS: ReadonlyArray<AtlasTabKey> = ATLAS_TABS.map((t) => t.key)
const DEFAULT_TAB: AtlasTabKey = 'plan'
const CHAT_COLLAPSED_KEY = 'atlas_cockpit_chat_collapsed'

/**
 * Unified cockpit shell (1.10an). Persistent left chat + tabbed right pane
 * on desktop; bottom-sheet chat + bottom tab bar on mobile.
 */
export function AtlasCockpit() {
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get('tab')
  const activeTab: AtlasTabKey = useMemo(() => {
    if (tabParam && (VALID_TABS as ReadonlyArray<string>).includes(tabParam)) {
      return tabParam as AtlasTabKey
    }
    return DEFAULT_TAB
  }, [tabParam])

  const setActiveTab = useCallback(
    (key: AtlasTabKey) => {
      const next = new URLSearchParams(searchParams)
      next.set('tab', key)
      setSearchParams(next, { replace: false })
    },
    [searchParams, setSearchParams],
  )

  // Backing data — same hooks as the legacy AtlasShell so we keep parity.
  const { status, costs, loading, error } = useAtlasStatus()
  const artifacts = useArtifacts()
  const tts = useTts()
  const liveMode = useLiveMode({ threadId: 'web-default', voiceId: tts.voiceId })
  const { heartbeats } = useAgentHeartbeats()

  // Trust mode lives on the server but we mirror it locally for instant UI
  // updates. The server is authoritative — useAtlasStatus pulls every 5s.
  const [trustOverride, setTrustOverride] = useState<TrustMode | undefined>()
  const trustMode: TrustMode = trustOverride ?? status?.trust_mode ?? 'passive'

  // Mobile bottom-sheet collapse state — persisted in localStorage.
  const [chatCollapsedMobile, setChatCollapsedMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(CHAT_COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_COLLAPSED_KEY, chatCollapsedMobile ? '1' : '0')
    } catch {
      // ignore
    }
  }, [chatCollapsedMobile])

  // 1.10bb-c Session 6 — live atlas_dispatches queued + building count.
  // Drives the Queue tab badge so operators see the autonomous-build pipeline
  // depth at a glance. Initial fetch + Postgres realtime keeps the number in
  // sync without polling. The count includes both 'queued' (waiting to be
  // picked up) and 'building' (actively running) rows — the operator cares
  // about total in-flight work, not just rows still in queue.
  //
  // 1.10be — the .in() whitelist below is the legacy_inert exclusion mechanism.
  // `legacy_inert` is the terminal status applied by migration phase_1_10be_orphan_archive
  // to the 8 orphan rows the pre-Step-3b /approve auto-dispatch path inserted
  // (tool='builder.workshop_diff_spec', initiated_by='workshop_diff_approval:…').
  // The Builder never consumed those rows (it reads filesystem queue, not
  // atlas_dispatches), but they were counted by the previous filter and inflated
  // the badge by 8. New terminal statuses introduced by future cleanup migrations
  // belong outside this whitelist by default; add to the IN array only for
  // actively-counted lifecycle states.
  const [dispatchQueueCount, setDispatchQueueCount] = useState(0)
  const refreshDispatchQueueCount = useCallback(async () => {
    try {
      // Cast: atlas_dispatches ships in migration 20260430000000 — not in
      // generated types until `supabase gen types` is rerun post-deploy.
      const client = supabase as unknown as {
        from: (t: string) => {
          select: (cols: string, opts: { count: 'exact'; head: true }) => {
            in: (col: string, vals: string[]) => Promise<{ count: number | null }>
          }
        }
      }
      const { count } = await client
        .from('atlas_dispatches')
        .select('id', { count: 'exact', head: true })
        .in('status', ['queued', 'building'])
      setDispatchQueueCount(count ?? 0)
    } catch {
      // Best-effort; realtime keeps it fresh.
    }
  }, [])
  useEffect(() => { void refreshDispatchQueueCount() }, [refreshDispatchQueueCount])
  useEffect(() => {
    const channel = supabase
      .channel('atlas-dispatches-queue-count')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'atlas_dispatches' },
        () => { void refreshDispatchQueueCount() },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [refreshDispatchQueueCount])

  // Tab badges live-update from existing 5s status + 15s artifact polls,
  // plus Session 6's realtime dispatch-queue count for the Queue tab.
  const badges = useMemo(() => {
    const pendingSpecsCount = artifacts.pendingSpecs.length
    const failed24h = status?.failed_24h ?? 0
    const pendingArtifacts =
      artifacts.pendingSpecs.length +
      artifacts.designAudits.length +
      artifacts.openForks.length
    return {
      plan: 'mute' as const,
      workshop: 'mute' as const,
      queue: dispatchQueueCount + pendingSpecsCount,
      agents: failed24h > 0 ? ('dot' as const) : ('mute' as const),
      audit: failed24h,
      workflows: 'mute' as const,
      artifacts: pendingArtifacts,
      team: 'mute' as const,
      preview: 'mute' as const,
    }
  }, [
    artifacts.pendingSpecs.length,
    artifacts.designAudits.length,
    artifacts.openForks.length,
    status?.failed_24h,
    dispatchQueueCount,
  ])

  // Handler invoked when a tool inside the chat needs to deep-link to a tab
  // (e.g. /plan, /workflow). The slash-menu routes navigation commands here.
  const handleSlashNavigate = useCallback(
    (tab: AtlasTabKey) => {
      setActiveTab(tab)
    },
    [setActiveTab],
  )

  // E.2: chat-rendered markdown links like `[View in Queue tab](#tab=queue)`
  // dispatch this CustomEvent. Listening here so the tab switch happens
  // without a full-page reload (anchor-default would lose chat state).
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<string>).detail
      if (typeof detail === 'string' && (VALID_TABS as ReadonlyArray<string>).includes(detail)) {
        setActiveTab(detail as AtlasTabKey)
      }
    }
    window.addEventListener('atlas:tab-navigate', handler as EventListener)
    return () => window.removeEventListener('atlas:tab-navigate', handler as EventListener)
  }, [setActiveTab])

  // 1.10bb-c Session 5 — Verifier-dialog paused-dispatch surveillance.
  // Initial fetch + Postgres realtime subscription on atlas_dispatches. Any
  // row carrying a non-null builder_pause_token surfaces the popup; once the
  // operator resumes / aborts, the token clears and the popup hides.
  const [pausedDispatches, setPausedDispatches] = useState<PausedDispatch[]>([])
  const refreshPaused = useCallback(async () => {
    try {
      const r = await listPausedDispatches()
      setPausedDispatches(r.paused)
    } catch {
      // Polling is best-effort; the realtime subscription is the live signal.
    }
  }, [])
  useEffect(() => {
    void refreshPaused()
  }, [refreshPaused])
  useEffect(() => {
    const channel = supabase
      .channel('atlas-dispatches-paused')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'atlas_dispatches' },
        () => { void refreshPaused() },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [refreshPaused])
  const currentPaused = pausedDispatches[0] ?? null
  const [popupDismissedId, setPopupDismissedId] = useState<string | null>(null)
  const popupTarget = currentPaused && currentPaused.id !== popupDismissedId ? currentPaused : null

  // Handler for the header's agent-dot click → open Agents tab.
  const openAgentsTab = useCallback(() => setActiveTab('agents'), [setActiveTab])
  // Phase 1.10as — Preview tab's "Inspect commit" jumps to the Audit tab.
  const openAuditTab = useCallback(() => setActiveTab('audit'), [setActiveTab])

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <div className="px-4 md:px-6 pt-3 empty:hidden">
        <PwaInstallPrompt />
      </div>

      <AtlasTopNav />

      <FailingConnectionBanner />

      <AtlasHeader
        status={status}
        costs={costs}
        loading={loading}
        trustMode={trustMode}
        onTrustModeChange={setTrustOverride}
        onOpenAgentsTab={openAgentsTab}
        heartbeats={heartbeats}
      />

      {/* Desktop / tablet: split-pane (chat fixed-width left, tabs right).
          `hidden md:flex` on the wrapper prevents it from claiming flex-1
          space on mobile. min-h-0 + overflow-hidden contain inner scroll
          so only the chat message list and the active tab content scroll —
          the page itself never scrolls. */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">
        <aside
          className={cn(
            'flex flex-col overflow-hidden border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950',
            // Tablet 768-1280: 320px. Desktop ≥1280: 380px.
            'md:w-[320px] xl:w-[380px] shrink-0',
          )}
        >
          <ErrorBoundary>
            <CockpitChat
              tts={tts}
              onSlashNavigate={handleSlashNavigate}
            />
          </ErrorBoundary>
        </aside>

        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <AtlasTabBar active={activeTab} onChange={setActiveTab} badges={badges} />
          <div className="flex-1 min-h-0 overflow-hidden">
            <ErrorBoundary>
              <Suspense fallback={<TabLoading />}>
                <ActiveTab
                  tab={activeTab}
                  status={status}
                  loading={loading}
                  artifacts={artifacts}
                  onOpenAgents={openAgentsTab}
                  onOpenAudit={openAuditTab}
                  heartbeats={heartbeats}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* Mobile (<768px): tab content on top, bottom-sheet chat below */}
      <div className="md:hidden flex-1 flex flex-col overflow-hidden">
        <AtlasTabBar active={activeTab} onChange={setActiveTab} badges={badges} />
        <main className="flex-1 min-h-0 overflow-hidden pb-[5rem]">
          <ErrorBoundary>
            <Suspense fallback={<TabLoading />}>
              <ActiveTab
                tab={activeTab}
                status={status}
                loading={loading}
                artifacts={artifacts}
                onOpenAgents={openAgentsTab}
                onOpenAudit={openAuditTab}
                heartbeats={heartbeats}
              />
            </Suspense>
          </ErrorBoundary>
        </main>

        <MobileChatSheet
          collapsed={chatCollapsedMobile}
          onToggle={() => setChatCollapsedMobile((v) => !v)}
          tts={tts}
          onSlashNavigate={handleSlashNavigate}
        />
      </div>

      {/* Atlas link error — visible on both desktop and mobile so users on
          either viewport see when the API is degraded. */}
      {error && (
        <div className="border-t border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-1.5 text-[11px] text-red-700 dark:text-red-300">
          Atlas link: {error}
        </div>
      )}

      {liveMode.active && (
        <ErrorBoundary>
          <LiveModePanel
            state={liveMode.state}
            level={liveMode.level}
            speakingLevel={liveMode.speakingLevel}
            errorMessage={liveMode.errorMessage}
            budgetBlocked={liveMode.budgetBlocked}
            sessionElapsedMs={liveMode.sessionElapsedMs}
            transcript={liveMode.transcript}
            reconnectAttempt={liveMode.reconnectAttempt}
            onEnd={liveMode.end}
          />
        </ErrorBoundary>
      )}

      <ErrorBoundary>
        <VerifierDialogPopup
          paused={popupTarget}
          onResolved={() => {
            setPopupDismissedId(null)
            void refreshPaused()
          }}
          onClose={() => {
            if (popupTarget) setPopupDismissedId(popupTarget.id)
          }}
        />
      </ErrorBoundary>
    </div>
  )
}

function TabLoading() {
  return (
    <div className="p-3 space-y-2">
      <div className="h-6 w-32 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
      <div className="h-20 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
      <div className="h-20 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
    </div>
  )
}

function ActiveTab({
  tab,
  status,
  loading,
  artifacts,
  onOpenAgents,
  onOpenAudit,
  heartbeats,
}: {
  tab: AtlasTabKey
  status: ReturnType<typeof useAtlasStatus>['status']
  loading: boolean
  artifacts: ReturnType<typeof useArtifacts>
  onOpenAgents: () => void
  onOpenAudit: () => void
  heartbeats: ReturnType<typeof useAgentHeartbeats>['heartbeats']
}) {
  switch (tab) {
    case 'plan':
      return <AtlasPlanTab />
    case 'workshop':
      // Session 7: dedicated boundary so chunk-load failures or runtime
      // crashes in PlanWorkshop don't poison the rest of the cockpit.
      return (
        <WorkshopErrorBoundary>
          <PlanWorkshop />
        </WorkshopErrorBoundary>
      )
    case 'queue':
      return <AtlasQueueTab heartbeats={heartbeats} />
    case 'agents':
      return <AtlasAgentsTab status={status} loading={loading} heartbeats={heartbeats} />
    case 'audit':
      return <AtlasAuditTab />
    case 'workflows':
      return <AtlasWorkflowTab status={status} onOpenAgents={onOpenAgents} heartbeats={heartbeats} />
    case 'artifacts':
      return <AtlasArtifactsTab artifacts={artifacts} />
    case 'team':
      return <AtlasTeamTab />
    case 'preview':
      return <AtlasPreviewTab onOpenAudit={onOpenAudit} />
  }
}

function MobileChatSheet({
  collapsed,
  onToggle,
  tts,
  onSlashNavigate,
}: {
  collapsed: boolean
  onToggle: () => void
  tts: ReturnType<typeof useTts>
  onSlashNavigate: (tab: AtlasTabKey) => void
}) {
  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-[0_-4px_18px_rgba(0,0,0,0.08)] transition-all duration-200',
        collapsed ? 'h-16' : 'h-[78vh]',
      )}
      role="dialog"
      aria-label="Atlas chat"
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors duration-150"
        aria-expanded={!collapsed}
      >
        <span className="inline-flex items-center gap-1.5">
          <MessageCircle className="size-4 text-emerald-600" />
          {collapsed ? 'Tap to expand chat' : 'Tap to collapse'}
        </span>
        <ChevronUp
          className={cn('size-4 transition-transform duration-200', collapsed ? '' : 'rotate-180')}
        />
      </button>
      {!collapsed && (
        <div className="h-[calc(100%-2.75rem)]">
          <ErrorBoundary>
            <CockpitChat tts={tts} onSlashNavigate={onSlashNavigate} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}
