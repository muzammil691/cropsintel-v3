import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircle, Layers, Activity, Sparkles, X, LogOut } from 'lucide-react'
import { AtlasTopNav } from './AtlasTopNav'
import { TrustModeBadge } from './TrustModeBadge'
import { VoiceToggle } from './VoiceToggle'
import { VoicePicker } from './VoicePicker'
import { LiveModeButton } from './LiveModeButton'
import { LiveModePanel } from './LiveModePanel'
import { WizardBar } from './WizardBar'
import { ChatPane } from './ChatPane/ChatPane'
import { ArtifactsPane } from './ArtifactsPane/ArtifactsPane'
import { StatusPane } from './StatusPane/StatusPane'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PwaInstallPrompt } from '@/components/PwaInstallPrompt'
import { Button } from '@/components/ui/button'
import { useAtlasStatus } from '@/hooks/useAtlasStatus'
import { useArtifacts } from '@/hooks/useArtifacts'
import { useTts } from '@/hooks/useTts'
import { useLiveMode } from '@/hooks/useLiveMode'
import { logoutAtlas, type TrustMode } from '@/lib/atlas-client'

type MobileTab = 'chat' | 'artifacts' | 'status'

export function AtlasShell() {
  const navigate = useNavigate()
  const { status, costs, loading, error } = useAtlasStatus()
  const artifacts = useArtifacts()
  const tts = useTts()
  const liveMode = useLiveMode({ threadId: 'web-default', voiceId: tts.voiceId })

  const [prefill, setPrefill] = useState<string | undefined>()
  const [modeOverride, setModeOverride] = useState<TrustMode | undefined>()
  const [loggingOut, setLoggingOut] = useState(false)
  const displayMode: TrustMode = modeOverride ?? status?.trust_mode ?? 'passive'

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logoutAtlas()
    } finally {
      navigate('/atlas/login', { replace: true })
    }
  }

  const [tab, setTab] = useState<MobileTab>('chat')
  const [tabletStatusOpen, setTabletStatusOpen] = useState(false)

  // Surface budget-block / TTS errors as an inline banner.
  const [ttsBanner, setTtsBanner] = useState<string | null>(null)
  useEffect(() => {
    if (tts.budgetBlocked) {
      setTtsBanner('TTS disabled — monthly cap approaching.')
    } else if (tts.lastError) {
      setTtsBanner(tts.lastError)
    } else {
      setTtsBanner(null)
    }
  }, [tts.budgetBlocked, tts.lastError])

  const artifactBadgeCount =
    artifacts.pendingSpecs.length +
    artifacts.designAudits.length +
    artifacts.openForks.length

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <div className="px-4 md:px-6 pt-3 empty:hidden">
        <PwaInstallPrompt />
      </div>

      <AtlasTopNav />

      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur sticky top-0 z-30">
        <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className="grid place-items-center size-7 rounded-md bg-emerald-600 text-white">
                <Sparkles className="size-4" />
              </span>
              <h1 className="text-base font-semibold tracking-tight">Atlas</h1>
            </div>
            <span className="hidden md:block h-5 w-px bg-slate-200 dark:bg-slate-800" />
            <TrustModeBadge mode={displayMode} />
            <div className="hidden md:flex items-center gap-2">
              <VoiceToggle
                enabled={tts.enabled}
                onToggle={tts.setEnabled}
                disabled={tts.budgetBlocked}
              />
              {tts.enabled && (
                <VoicePicker
                  voices={tts.voices}
                  voiceId={tts.voiceId}
                  onChange={tts.setVoiceId}
                  loading={tts.voicesLoading}
                  error={tts.voicesError}
                />
              )}
              <LiveModeButton
                active={liveMode.active}
                disabled={tts.budgetBlocked || liveMode.budgetBlocked}
                onClick={() => {
                  if (liveMode.active) liveMode.end()
                  else void liveMode.start()
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <WizardBar
              onPrefill={setPrefill}
              currentMode={displayMode}
              onModeChange={(m) => setModeOverride(m)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              aria-label="Sign out of Atlas"
              title="Sign out"
              className="hidden md:inline-flex"
            >
              <LogOut className="size-4" />
              <span className="ml-1.5 hidden lg:inline">{loggingOut ? 'Signing out…' : 'Sign out'}</span>
            </Button>
          </div>
        </div>

        {/* Mobile-only secondary toolbar (voice + live mode below the wizard row) */}
        <div className="md:hidden flex items-center gap-2 px-4 pb-2">
          <VoiceToggle
            enabled={tts.enabled}
            onToggle={tts.setEnabled}
            disabled={tts.budgetBlocked}
          />
          {tts.enabled && (
            <VoicePicker
              voices={tts.voices}
              voiceId={tts.voiceId}
              onChange={tts.setVoiceId}
              loading={tts.voicesLoading}
              error={tts.voicesError}
            />
          )}
          <LiveModeButton
            active={liveMode.active}
            disabled={tts.budgetBlocked || liveMode.budgetBlocked}
            onClick={() => {
              if (liveMode.active) liveMode.end()
              else void liveMode.start()
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            aria-label="Sign out of Atlas"
            className="ml-auto"
          >
            <LogOut className="size-4" />
          </Button>
        </div>

        {ttsBanner && (
          <div
            role="status"
            className="px-4 md:px-6 py-1.5 text-xs bg-amber-50 text-amber-900 border-t border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800"
          >
            {ttsBanner}
            <button
              type="button"
              onClick={() => setTtsBanner(null)}
              className="ml-2 underline hover:no-underline transition-colors duration-200"
              aria-label="Dismiss notice"
            >
              dismiss
            </button>
          </div>
        )}
      </header>

      {/* Tablet status toggle (768–1279px) */}
      <div className="hidden md:flex xl:hidden px-4 py-2 border-b border-slate-200 dark:border-slate-800 justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTabletStatusOpen(true)}
        >
          <Activity className="size-3.5 mr-1.5" />
          Status & costs
        </Button>
      </div>

      {/* Mobile tab nav */}
      <nav className="md:hidden flex border-b border-slate-200 dark:border-slate-800 text-sm font-medium bg-white dark:bg-slate-950 sticky top-[112px] z-20">
        <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} icon={MessageCircle}>
          Chat
        </TabButton>
        <TabButton active={tab === 'artifacts'} onClick={() => setTab('artifacts')} icon={Layers} badge={artifactBadgeCount}>
          Artifacts
        </TabButton>
        <TabButton active={tab === 'status'} onClick={() => setTab('status')} icon={Activity}>
          Status
        </TabButton>
      </nav>

      {/* ─── Layouts ────────────────────────────────────────────────────────── */}

      {/* Desktop: 3-pane (chat 2fr, artifacts 1fr, status 1fr) */}
      <main className="hidden xl:grid xl:grid-cols-[2fr_1fr_1fr] gap-4 p-4 max-w-screen-2xl mx-auto">
        <section className="min-w-0">
          <ErrorBoundary>
            <ChatPane
              prefill={prefill}
              onPrefillConsumed={() => setPrefill(undefined)}
              tts={tts}
            />
          </ErrorBoundary>
        </section>
        <section className="min-w-0">
          <ErrorBoundary>
            <ArtifactsPane artifacts={artifacts} />
          </ErrorBoundary>
        </section>
        <aside className="min-w-0">
          <ErrorBoundary>
            <StatusPane status={status} costs={costs} loading={loading} error={error} />
          </ErrorBoundary>
        </aside>
      </main>

      {/* Tablet (768–1279): 2-column chat + artifacts; status in slide-over */}
      <main className="hidden md:grid xl:hidden md:grid-cols-[3fr_2fr] gap-4 p-4 max-w-screen-xl mx-auto">
        <section className="min-w-0">
          <ErrorBoundary>
            <ChatPane
              prefill={prefill}
              onPrefillConsumed={() => setPrefill(undefined)}
              tts={tts}
            />
          </ErrorBoundary>
        </section>
        <section className="min-w-0">
          <ErrorBoundary>
            <ArtifactsPane artifacts={artifacts} />
          </ErrorBoundary>
        </section>
      </main>

      {/* Tablet status drawer */}
      {tabletStatusOpen && (
        <div className="hidden md:block xl:hidden fixed inset-0 z-40">
          <button
            aria-label="Close status drawer"
            className="absolute inset-0 bg-slate-950/40"
            onClick={() => setTabletStatusOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-lg overflow-y-auto motion-safe:transition-transform">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-950">
              <h2 className="text-sm font-semibold">Status & costs</h2>
              <button
                onClick={() => setTabletStatusOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-200"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="p-4">
              <ErrorBoundary>
                <StatusPane status={status} costs={costs} loading={loading} error={error} />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      )}

      {/* Mobile single-tab */}
      <main className="md:hidden p-3 pb-20">
        {tab === 'chat' && (
          <ErrorBoundary>
            <ChatPane
              prefill={prefill}
              onPrefillConsumed={() => setPrefill(undefined)}
              tts={tts}
            />
          </ErrorBoundary>
        )}
        {tab === 'artifacts' && (
          <ErrorBoundary>
            <ArtifactsPane artifacts={artifacts} />
          </ErrorBoundary>
        )}
        {tab === 'status' && (
          <ErrorBoundary>
            <StatusPane status={status} costs={costs} loading={loading} error={error} />
          </ErrorBoundary>
        )}
      </main>

      {/* Live conversation overlay */}
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
            onEnd={liveMode.end}
          />
        </ErrorBoundary>
      )}
    </div>
  )
}

interface TabButtonProps {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  badge?: number
  children: React.ReactNode
}

function TabButton({ active, onClick, icon: Icon, badge, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`relative flex-1 py-2.5 flex items-center justify-center gap-1.5 transition-colors duration-150 ${
        active
          ? 'border-b-2 border-emerald-600 text-emerald-700 dark:text-emerald-400'
          : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 transition-colors duration-200'
      }`}
    >
      <Icon className="size-4" />
      <span>{children}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-1 rounded-full bg-emerald-600 text-white text-[10px] font-semibold px-1.5 py-0.5 min-w-[16px] text-center">
          {badge}
        </span>
      )}
    </button>
  )
}
