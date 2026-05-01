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
import { useAtlasStatus } from '@/hooks/useAtlasStatus'
import { useArtifacts } from '@/hooks/useArtifacts'
import { useTts } from '@/hooks/useTts'
import { useLiveMode } from '@/hooks/useLiveMode'
import type { TrustMode } from '@/lib/atlas-client'
import { cn } from '@/lib/utils'

// Lazy-load each tab so the initial cockpit bundle stays small (per spec
// risk note — initial cockpit bundle stays under 100KB gzipped).
const AtlasPlanTab = lazy(() => import('./tabs/AtlasPlanTab'))
const AtlasQueueTab = lazy(() => import('./tabs/AtlasQueueTab'))
const AtlasAgentsTab = lazy(() => import('./tabs/AtlasAgentsTab'))
const AtlasAuditTab = lazy(() => import('./tabs/AtlasAuditTab'))
const AtlasWorkflowTab = lazy(() => import('./tabs/AtlasWorkflowTab'))
const AtlasArtifactsTab = lazy(() => import('./tabs/AtlasArtifactsTab'))
const AtlasTeamTab = lazy(() => import('./tabs/AtlasTeamTab'))

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

  // Tab badges live-update from existing 5s status + 15s artifact polls.
  const badges = useMemo(() => {
    const queueCount = artifacts.pendingSpecs.length
    const failed24h = status?.failed_24h ?? 0
    const pendingArtifacts =
      artifacts.pendingSpecs.length +
      artifacts.designAudits.length +
      artifacts.openForks.length
    return {
      plan: 'mute' as const,
      queue: queueCount,
      agents: failed24h > 0 ? ('dot' as const) : ('mute' as const),
      audit: failed24h,
      workflows: 'mute' as const,
      artifacts: pendingArtifacts,
      team: 'mute' as const,
    }
  }, [artifacts.pendingSpecs.length, artifacts.designAudits.length, artifacts.openForks.length, status?.failed_24h])

  // Handler invoked when a tool inside the chat needs to deep-link to a tab
  // (e.g. /plan, /workflow). The slash-menu routes navigation commands here.
  const handleSlashNavigate = useCallback(
    (tab: AtlasTabKey) => {
      setActiveTab(tab)
    },
    [setActiveTab],
  )

  // Handler for the header's agent-dot click → open Agents tab.
  const openAgentsTab = useCallback(() => setActiveTab('agents'), [setActiveTab])

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <div className="px-4 md:px-6 pt-3 empty:hidden">
        <PwaInstallPrompt />
      </div>

      <AtlasTopNav />

      <AtlasHeader
        status={status}
        costs={costs}
        loading={loading}
        trustMode={trustMode}
        onTrustModeChange={setTrustOverride}
        onOpenAgentsTab={openAgentsTab}
      />

      {/* Desktop / tablet: split-pane (chat fixed-width left, tabs right). */}
      {/* `hidden md:flex` on the wrapper prevents it from claiming flex-1
          space on mobile (where its children are also hidden) — without it,
          the parent column flex would split height between this empty
          wrapper and the mobile section below. */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        <aside
          className={cn(
            'flex border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950',
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
}: {
  tab: AtlasTabKey
  status: ReturnType<typeof useAtlasStatus>['status']
  loading: boolean
  artifacts: ReturnType<typeof useArtifacts>
}) {
  switch (tab) {
    case 'plan':
      return <AtlasPlanTab />
    case 'queue':
      return (
        <AtlasQueueTab
          pendingSpecs={artifacts.pendingSpecs}
          loading={loading}
          onDismiss={artifacts.dismissSpec}
        />
      )
    case 'agents':
      return <AtlasAgentsTab status={status} loading={loading} />
    case 'audit':
      return <AtlasAuditTab status={status} designAudits={artifacts.designAudits} loading={loading} />
    case 'workflows':
      return <AtlasWorkflowTab />
    case 'artifacts':
      return <AtlasArtifactsTab artifacts={artifacts} />
    case 'team':
      return <AtlasTeamTab />
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
