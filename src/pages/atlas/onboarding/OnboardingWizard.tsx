// 1.10bb-c Session 9B — Stack Gate wizard.
//
// Three steps:
//   1. Welcome    — pitch + visual of the 5 mandatory cards.
//   2. Connect    — stepper; each row opens AddConnectionSheet pre-scoped.
//   3. Done       — calls PATCH /atlas/user-state { onboarding_complete: true }.
//
// State is local (useState) — refresh restarts but lands on the right step
// because we compute step from current connection count on mount.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Brain,
  GitBranch,
  Database,
  Sparkles,
  ArrowRight,
  Loader2,
  CheckCircle2,
  Circle,
  ChevronLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AddConnectionSheet } from '@/components/atlas/AddConnectionSheet'
import {
  listConnections,
  updateUserState,
  getUserState,
  type AtlasConnection,
  type ConnectionProvider,
} from '@/lib/atlas-client'

interface StackItem {
  provider: ConnectionProvider
  display: string
  tagline: string
  Icon: typeof Brain
}

const STACK: StackItem[] = [
  { provider: 'anthropic', display: 'Anthropic', tagline: 'Claude Builder LLM', Icon: Brain },
  { provider: 'openai',    display: 'OpenAI',    tagline: 'Verifier (FRONTEND lens) + Builder fallback', Icon: Brain },
  { provider: 'gemini',    display: 'Gemini',    tagline: 'Verifier (RESEARCH lens)', Icon: Brain },
  { provider: 'github',    display: 'GitHub',    tagline: 'Code repo + Pages hosting', Icon: GitBranch },
  { provider: 'supabase',  display: 'Supabase',  tagline: 'Database + Storage', Icon: Database },
]

function hasVerified(connections: AtlasConnection[], provider: ConnectionProvider): boolean {
  return connections.some((c) => c.provider === provider && c.last_verify_status === 'verified')
}

type Step = 'welcome' | 'connect' | 'done'

export function OnboardingWizard() {
  const navigate = useNavigate()
  const [connections, setConnections] = useState<AtlasConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('welcome')
  const [sheetProvider, setSheetProvider] = useState<ConnectionProvider | null>(null)
  const [completing, setCompleting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const rows = await listConnections()
      setConnections(rows)
      return rows
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return [] as AtlasConnection[]
    }
  }, [])

  // On mount: bounce to cockpit if already onboarded; otherwise prime the
  // connection list so steps render correctly.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const state = await getUserState()
        if (state.onboarding_complete) {
          if (!cancelled) navigate('/atlas', { replace: true })
          return
        }
      } catch { /* surface via list error below */ }
      const rows = await refresh()
      if (cancelled) return
      // Land on Connect step if user already has any progress so they don't
      // re-read the welcome copy after refreshing.
      if (rows.some((c) => STACK.some((s) => s.provider === c.provider))) {
        setStep('connect')
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [navigate, refresh])

  const verifiedCount = useMemo(() =>
    STACK.filter((s) => hasVerified(connections, s.provider)).length,
    [connections],
  )
  const allFive = verifiedCount === STACK.length

  // Sort: not-done first, in-progress (any row exists, not verified) middle,
  // verified at the bottom.
  const orderedStack = useMemo(() => {
    return [...STACK].sort((a, b) => {
      const av = hasVerified(connections, a.provider) ? 2 : connections.some((c) => c.provider === a.provider) ? 1 : 0
      const bv = hasVerified(connections, b.provider) ? 2 : connections.some((c) => c.provider === b.provider) ? 1 : 0
      return av - bv
    })
  }, [connections])

  async function handleComplete() {
    setCompleting(true)
    try {
      await updateUserState({ onboarding_complete: true })
      setStep('done')
    } catch (err) {
      toast.error(`Failed to mark onboarding complete: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCompleting(false)
    }
  }

  function handleSkip() {
    toast.warning('Skipped — you can finish this from Settings → Connections any time. Project creation will be blocked until all 5 are connected.', { duration: 6000 })
    navigate('/atlas', { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-950">
        <div className="text-sm text-slate-500 dark:text-slate-400 inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading your stack…
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <header className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2">
        <Sparkles className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Atlas — Stack Gate</h1>
        <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          {verifiedCount}/{STACK.length} connected
        </span>
      </header>

      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-8 max-w-4xl w-full mx-auto">
        {error && (
          <div role="alert" className="mb-4 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {step === 'welcome' && <WelcomeStep onStart={() => setStep('connect')} />}

        {step === 'connect' && (
          <ConnectStep
            connections={connections}
            stack={orderedStack}
            onPick={(p) => setSheetProvider(p)}
            allFive={allFive}
            verifiedCount={verifiedCount}
            onContinue={handleComplete}
            onSkip={handleSkip}
            completing={completing}
          />
        )}

        {step === 'done' && (
          <DoneStep connections={connections} onOpen={() => navigate('/atlas', { replace: true })} />
        )}
      </main>

      <AddConnectionSheet
        open={sheetProvider !== null}
        initialProvider={sheetProvider ?? undefined}
        onClose={() => setSheetProvider(null)}
        onSaved={async () => {
          await refresh()
          setSheetProvider(null)
        }}
      />
    </div>
  )
}

// ─── Step 1 — Welcome ───────────────────────────────────────────────────

function WelcomeStep({ onStart }: { onStart: () => void }) {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Connect your stack</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
          Five connections unlock Atlas. We'll guide you through each. Takes about 5 minutes.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {STACK.map((item) => {
          const Icon = item.Icon
          return (
            <div
              key={item.provider}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-3 flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-1.5">
                <Icon className="size-4 text-slate-400" aria-hidden />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{item.display}</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{item.tagline}</p>
            </div>
          )
        })}
      </div>

      <div className="pt-2">
        <Button
          type="button"
          onClick={onStart}
          className="bg-emerald-700 hover:bg-emerald-800 text-white gap-2"
        >
          Get started <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </div>
    </section>
  )
}

// ─── Step 2 — Connect ───────────────────────────────────────────────────

interface ConnectStepProps {
  connections: AtlasConnection[]
  stack: StackItem[]
  onPick: (p: ConnectionProvider) => void
  allFive: boolean
  verifiedCount: number
  onContinue: () => void
  onSkip: () => void
  completing: boolean
}

function ConnectStep({ connections, stack, onPick, allFive, verifiedCount, onContinue, onSkip, completing }: ConnectStepProps) {
  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Connect each provider</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
          Click a row to add credentials. Each one is tested live before it counts as connected.
        </p>
      </header>

      <ol className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
        {stack.map((item) => {
          const Icon = item.Icon
          const verified = hasVerified(connections, item.provider)
          const inProgress = !verified && connections.some((c) => c.provider === item.provider)
          return (
            <li key={item.provider}>
              <button
                type="button"
                onClick={() => onPick(item.provider)}
                disabled={completing}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-3 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
                  verified
                    ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40',
                )}
              >
                {verified ? (
                  <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
                ) : (
                  <Circle className={cn('size-5 shrink-0', inProgress ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600')} aria-hidden />
                )}
                <Icon className="size-4 text-slate-500 dark:text-slate-400 shrink-0" aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.display}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{item.tagline}</div>
                </div>
                <span className={cn(
                  'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0',
                  verified
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200'
                    : inProgress
                      ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
                )}>
                  {verified ? 'connected' : inProgress ? 'needs test' : 'not connected'}
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSkip}
          disabled={completing}
          className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
        >
          Skip for now
        </Button>
        <Button
          type="button"
          onClick={onContinue}
          disabled={!allFive || completing}
          title={!allFive ? `${STACK.length - verifiedCount} more to go.` : undefined}
          className="bg-emerald-700 hover:bg-emerald-800 text-white gap-2"
        >
          {completing ? <><Loader2 className="size-3.5 animate-spin" aria-hidden /> Finalizing…</> : <>Continue <ArrowRight className="size-3.5" aria-hidden /></>}
        </Button>
      </div>
    </section>
  )
}

// ─── Step 3 — Done ──────────────────────────────────────────────────────

function DoneStep({ connections, onOpen }: { connections: AtlasConnection[]; onOpen: () => void }) {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">You're set.</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
          Atlas is ready to start building. Welcome to the cockpit.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {STACK.map((item) => {
          const Icon = item.Icon
          const conn = connections.find((c) => c.provider === item.provider && c.last_verify_status === 'verified')
          return (
            <div
              key={item.provider}
              className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 px-3 py-3 flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
                <Icon className="size-4 text-emerald-700 dark:text-emerald-300" aria-hidden />
                <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">{item.display}</span>
              </div>
              <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80 leading-snug truncate" title={conn?.label}>
                {conn?.label || 'connected'}
              </p>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => window.history.back()}
          className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
        >
          <ChevronLeft className="size-3.5 mr-1" aria-hidden /> Back
        </Button>
        <Button
          type="button"
          onClick={onOpen}
          className="ml-auto bg-emerald-700 hover:bg-emerald-800 text-white gap-2"
        >
          Open cockpit <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </div>
    </section>
  )
}

export default OnboardingWizard
