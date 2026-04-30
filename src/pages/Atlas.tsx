import { useState } from 'react'
import { ChatPanel } from '@/components/atlas/ChatPanel'
import { StatusGrid } from '@/components/atlas/StatusGrid'
import { WizardBar } from '@/components/atlas/WizardBar'
import { TrustModeBadge } from '@/components/atlas/TrustModeBadge'
import { PwaInstallPrompt } from '@/components/PwaInstallPrompt'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useAtlasStatus } from '@/hooks/useAtlasStatus'
import type { TrustMode } from '@/lib/atlas-client'

export default function Atlas() {
  const { status, costs, loading, error } = useAtlasStatus()

  // Chat prefill — driven by WizardBar actions
  const [prefill, setPrefill] = useState<string | undefined>()

  // Local mode override (optimistic) until next status poll
  const [modeOverride, setModeOverride] = useState<TrustMode | undefined>()
  const displayMode: TrustMode = modeOverride ?? status?.trust_mode ?? 'passive'

  // Mobile tab selection
  const [tab, setTab] = useState<'chat' | 'status'>('chat')

  return (
    <div className="min-h-screen bg-background">
      {/* PWA install / offline banner */}
      <div className="px-4 md:px-6 pt-3 empty:hidden">
        <PwaInstallPrompt />
      </div>

      {/* Header */}
      <header className="border-b px-4 md:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 shrink-0">
          <h1 className="text-xl font-semibold">Atlas</h1>
          <TrustModeBadge mode={displayMode} />
        </div>
        <WizardBar
          onPrefill={setPrefill}
          currentMode={displayMode}
          onModeChange={(m) => setModeOverride(m)}
        />
      </header>

      {/* Mobile tab bar */}
      <nav className="md:hidden flex border-b text-sm font-medium">
        <button
          className={`flex-1 py-2 text-center transition-colors ${tab === 'chat' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
        <button
          className={`flex-1 py-2 text-center transition-colors ${tab === 'status' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setTab('status')}
        >
          Status
        </button>
      </nav>

      {/* Desktop: two-column layout. Mobile: tabbed. */}
      <main className="p-4 max-w-screen-2xl mx-auto">
        {/* Desktop grid */}
        <div className="hidden md:grid md:grid-cols-[1.5fr_1fr] gap-4">
          <section>
            <ErrorBoundary>
              <ChatPanel
                prefill={prefill}
                onPrefillConsumed={() => setPrefill(undefined)}
              />
            </ErrorBoundary>
          </section>
          <aside className="overflow-y-auto max-h-[calc(100vh-7rem)]">
            <ErrorBoundary>
              <StatusGrid status={status} costs={costs} loading={loading} error={error} />
            </ErrorBoundary>
          </aside>
        </div>

        {/* Mobile tabs */}
        <div className="md:hidden">
          {tab === 'chat' && (
            <ErrorBoundary>
              <ChatPanel
                prefill={prefill}
                onPrefillConsumed={() => setPrefill(undefined)}
              />
            </ErrorBoundary>
          )}
          {tab === 'status' && (
            <div className="pb-4">
              <ErrorBoundary>
                <StatusGrid status={status} costs={costs} loading={loading} error={error} />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
