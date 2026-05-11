// Phase 1.10bb-c Session 4 — Plan Workshop top-level tab.
//
// The standing planning intelligence's UI surface. Replaces the per-phase
// PhaseWizard.tsx (deleted in this same commit). Layout:
//
//   ┌────────────────────────────────────────────────────────────────────┐
//   │ Header (workshop framing + stats)                                  │
//   ├──────────────┬────────────────────────────────┬───────────────────┤
//   │ Session list │ Active session                 │ Decision log      │
//   │ (left rail)  │  • multi-modal input @ start   │ + open questions  │
//   │              │  • chat thread + clarity bar   │ (right rail)      │
//   │              │  • plan diff preview @ end     │                   │
//   └──────────────┴────────────────────────────────┴───────────────────┘
//
// Architecture per Q-decisions baked into the build prompt:
//   • Q1: replaces wizard entirely
//   • Q2: diff-and-confirm mandatory (PlanDiffPreview gates approval)
//   • Q3: anti-drift via decision_log + open_questions (DecisionLogPanel)
//   • Q4: manual summon (this component is the surface; auto-summon arrives in Session 5)
//   • Q5: first-run output is plan diff that drives autonomous build (Session 6)

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Sparkles,
  Send,
  Loader2,
  RefreshCw,
  Database,
  FileText,
  Quote,
  X,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  startWorkshopSession,
  getWorkshopSession,
  submitTurnAnswer,
  finalizeWorkshopSession,
  getPlanDiff,
  fetchConcepts,
  type CockpitConcept,
  type WorkshopSessionDetail,
  type WorkshopTurnRecord,
  type WorkshopCitedSource,
  type PlanDiffRow,
} from '@/lib/atlas-client'
import { WorkshopSessionList } from './WorkshopSessionList'
import { DecisionLogPanel } from './DecisionLogPanel'
import { PlanDiffPreview } from './PlanDiffPreview'

const READY_THRESHOLD = 0.9

export function PlanWorkshop() {
  // ─── top-level state ──────────────────────────────────────────────────
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [showStartForm, setShowStartForm] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  function bumpRefresh() {
    setRefreshKey((k) => k + 1)
  }

  return (
    <section className="flex flex-col h-full overflow-hidden bg-white dark:bg-slate-950">
      <header className="px-3 sm:px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-amber-50/60 dark:bg-amber-950/30">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-amber-700 dark:text-amber-300" aria-hidden />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200">
            Plan Workshop
          </h2>
          <span className="text-[10px] text-amber-700 dark:text-amber-400 ml-1">
            standing planning intelligence
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
          Drop concepts and uploads, work through architectural questions, generate a plan diff for approval. Atlas reads the master plan, idea file, V1 + V3 codebases, and prior decision logs on every turn.
        </p>
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_280px] overflow-hidden">
        <WorkshopSessionList
          selectedSessionId={selectedSessionId}
          onSelect={(id) => {
            setShowStartForm(false)
            setSelectedSessionId(id)
          }}
          onStartNew={() => {
            setSelectedSessionId(null)
            setShowStartForm(true)
          }}
          refreshKey={refreshKey}
          className="hidden md:flex"
        />

        <main className="flex flex-col min-w-0 overflow-hidden">
          {showStartForm ? (
            <StartSessionForm
              onStarted={(id) => {
                setShowStartForm(false)
                setSelectedSessionId(id)
                bumpRefresh()
              }}
              onCancel={() => setShowStartForm(false)}
            />
          ) : selectedSessionId ? (
            <ActiveSession
              sessionId={selectedSessionId}
              refreshKey={refreshKey}
              onBumpList={bumpRefresh}
            />
          ) : (
            <EmptyState onStartNew={() => setShowStartForm(true)} />
          )}
        </main>

        {selectedSessionId && (
          <RightRailContainer sessionId={selectedSessionId} refreshKey={refreshKey} onBumpList={bumpRefresh} />
        )}
      </div>
    </section>
  )
}

// ─── Empty state ────────────────────────────────────────────────────────

function EmptyState({ onStartNew }: { onStartNew: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6 max-w-md mx-auto">
      <span className="grid place-items-center size-12 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-medium">Pick a session or start a new one.</p>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          The Workshop is where deep planning happens — multi-turn conversation, citation-grounded, diff-and-confirm.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={onStartNew}
        className="mt-1 bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200"
      >
        Start new workshop
      </Button>
    </div>
  )
}

// ─── Start-session form ────────────────────────────────────────────────

interface StartSessionFormProps {
  onStarted: (sessionId: string) => void
  onCancel: () => void
}

// 1.10bb-c Session 7 — pre-select from the localStorage list ConceptsPanel
// writes when the user clicks "Use in Workshop". Keeping the key in sync with
// ConceptsPanel.WORKSHOP_SELECTION_KEY (string literal duplicated here so
// PlanWorkshop has no circular import on ConceptsPanel).
const WORKSHOP_SELECTION_KEY = 'cockpit_workshop_selected_concept_ids'

function readPreselectedConceptIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(WORKSHOP_SELECTION_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set()
  } catch { return new Set() }
}

function StartSessionForm({ onStarted, onCancel }: StartSessionFormProps) {
  const [prompt, setPrompt] = useState('')
  const [pasteContent, setPasteContent] = useState('')
  const [conceptIds, setConceptIds] = useState<Set<string>>(() => readPreselectedConceptIds())
  const [v3Paths, setV3Paths] = useState('')
  const [v1Paths, setV1Paths] = useState('')
  const [v1Search, setV1Search] = useState('')

  const [concepts, setConcepts] = useState<CockpitConcept[]>([])
  const [conceptsLoading, setConceptsLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchConcepts()
      .then((rows) => {
        if (!cancelled) setConcepts(rows)
      })
      .catch(() => {
        if (!cancelled) setConcepts([])
      })
      .finally(() => {
        if (!cancelled) setConceptsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Stay in sync if the user flags more concepts in the Concepts panel
  // while the form is open.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string[]>).detail
      if (Array.isArray(detail)) setConceptIds(new Set(detail))
    }
    window.addEventListener('atlas:workshop-selection-changed', handler as EventListener)
    return () => window.removeEventListener('atlas:workshop-selection-changed', handler as EventListener)
  }, [])

  async function handleStart() {
    if (prompt.trim().length < 3) {
      setError('Framing prompt required (≥3 characters).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const uploads = pasteContent.trim().length > 0
        ? [
            {
              filename: 'pasted.txt',
              mime: 'text/plain',
              body: pasteContent,
              bytes: pasteContent.length,
            },
          ]
        : undefined
      const splitPaths = (s: string) =>
        s
          .split(/[\n,]/)
          .map((x) => x.trim())
          .filter(Boolean)
      const result = await startWorkshopSession({
        prompt: prompt.trim(),
        conceptIds: Array.from(conceptIds),
        uploads,
        v3Paths: splitPaths(v3Paths),
        v1Paths: splitPaths(v1Paths),
        v1SearchQueries: splitPaths(v1Search),
      })
      onStarted(result.sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          New workshop session
        </h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="text-xs h-7"
        >
          <X className="size-3 mr-1" aria-hidden /> Cancel
        </Button>
      </div>

      <FormSection
        label="Framing prompt"
        hint="What are we trying to plan? E.g. 'Refine V3 plan to V1.0-alpha launch.'"
      >
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Refine V3 plan to V1.0-alpha launch."
          className="text-sm"
        />
      </FormSection>

      <FormSection
        label="Paste content (optional)"
        hint="Drop relevant notes, doc snippets, or chat excerpts. Becomes one upload alongside the session context."
      >
        <Textarea
          value={pasteContent}
          onChange={(e) => setPasteContent(e.target.value)}
          rows={3}
          placeholder="(optional)"
          className="text-xs font-mono"
        />
      </FormSection>

      <FormSection
        label="Concepts"
        hint="Select previously-saved concepts to ground the conversation. Atlas summarizes long ones with Haiku before injecting."
      >
        {conceptsLoading ? (
          <p className="text-xs text-slate-500 italic">Loading concepts…</p>
        ) : concepts.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No concepts saved yet — Workshop runs without them.</p>
        ) : (
          <div className="max-h-40 overflow-y-auto space-y-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-1.5">
            {concepts.map((c) => {
              const checked = conceptIds.has(c.id)
              return (
                <label
                  key={c.id}
                  className={cn(
                    'flex items-start gap-2 px-2 py-1 rounded cursor-pointer text-xs transition-colors duration-100',
                    checked
                      ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800/60',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setConceptIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(c.id)) next.delete(c.id)
                        else next.add(c.id)
                        return next
                      })
                    }}
                    className="mt-0.5"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="font-medium truncate block">{c.title}</span>
                    {c.theme && (
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        {c.theme}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </FormSection>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <FormSection
          label="V3 paths"
          hint="Comma- or newline-separated. e.g. `src/lib/atlas-client.ts`"
        >
          <Textarea
            value={v3Paths}
            onChange={(e) => setV3Paths(e.target.value)}
            rows={2}
            placeholder="(optional)"
            className="text-xs font-mono"
          />
        </FormSection>
        <FormSection
          label="V1 paths"
          hint="Files from muzammil69/almond-oracle (skipped without GITLAB_PAT)."
        >
          <Textarea
            value={v1Paths}
            onChange={(e) => setV1Paths(e.target.value)}
            rows={2}
            placeholder="(optional)"
            className="text-xs font-mono"
          />
        </FormSection>
        <FormSection label="V1 search queries" hint="e.g. `useGuestSession`, `verify_jwt`.">
          <Textarea
            value={v1Search}
            onChange={(e) => setV1Search(e.target.value)}
            rows={2}
            placeholder="(optional)"
            className="text-xs font-mono"
          />
        </FormSection>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2.5 py-1.5 text-[11px] text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy} className="text-xs h-8">
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleStart}
          disabled={busy}
          className="text-xs h-8 bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200"
        >
          {busy ? (
            <>
              <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
              Loading context + first turn…
            </>
          ) : (
            <>
              <Sparkles className="size-3 mr-1" aria-hidden />
              Start workshop
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

function FormSection({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
        {label}
      </label>
      {hint && <p className="text-[10px] text-slate-500 dark:text-slate-400">{hint}</p>}
      {children}
    </div>
  )
}

// ─── Active session view ────────────────────────────────────────────────

interface ActiveSessionProps {
  sessionId: string
  refreshKey: number
  onBumpList: () => void
}

function ActiveSession({ sessionId, refreshKey, onBumpList }: ActiveSessionProps) {
  const [session, setSession] = useState<WorkshopSessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [diff, setDiff] = useState<PlanDiffRow | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const r = await getWorkshopSession(sessionId)
      setSession(r.session)
      // If session is awaiting_approval and has a plan_diff_id, fetch the diff.
      if (r.session.status === 'awaiting_approval' && r.session.plan_diff_id) {
        setDiffLoading(true)
        try {
          const d = await getPlanDiff(r.session.plan_diff_id)
          setDiff(d.diff)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setDiffLoading(false)
        }
      } else {
        setDiff(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [sessionId, reload, refreshKey])

  async function handleSubmitAnswer() {
    if (answer.trim().length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      await submitTurnAnswer(sessionId, answer.trim())
      setAnswer('')
      await reload()
      onBumpList()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFinalize() {
    setFinalizing(true)
    setError(null)
    try {
      await finalizeWorkshopSession(sessionId)
      await reload()
      onBumpList()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFinalizing(false)
    }
  }

  function handleDiffResolved(_kind: 'approved' | 'rejected' | 'revised') {
    void reload()
    onBumpList()
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-slate-500 gap-1.5">
        <RefreshCw className="size-3 animate-spin" aria-hidden /> Loading session…
      </div>
    )
  }
  if (error && !session) {
    return (
      <div className="flex-1 p-4">
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      </div>
    )
  }
  if (!session) return null

  // Awaiting approval → show plan diff preview.
  if (session.status === 'awaiting_approval') {
    if (diffLoading) {
      return (
        <div className="flex-1 flex items-center justify-center text-xs text-slate-500 gap-1.5">
          <RefreshCw className="size-3 animate-spin" aria-hidden /> Loading plan diff…
        </div>
      )
    }
    if (!diff) {
      return (
        <div className="flex-1 p-4">
          <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            Session is awaiting approval but the diff couldn&apos;t be loaded. Try Revise from the session list, or check the server logs.
          </div>
        </div>
      )
    }
    return <PlanDiffPreview diff={diff} onResolved={handleDiffResolved} />
  }

  // Active or completed/abandoned → show conversation thread.
  const turns = session.workshop_state?.turns ?? []
  const lastTurn = turns[turns.length - 1] ?? null
  const lastConfidence = session.workshop_state?.last_confidence ?? 0
  const isLive = session.status === 'active'
  const lastUnanswered = lastTurn && lastTurn.answer === null && lastTurn.question
  const readyToDraft = session.workshop_state?.ready_signaled || lastConfidence >= READY_THRESHOLD

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <SessionHeader session={session} />
      <ClarityBar value={lastConfidence} turns={turns.length} />

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {turns.length === 0 && (
          <p className="text-xs text-slate-500 italic px-1 py-2">
            No turns yet — first Atlas message is about to land.
          </p>
        )}
        {turns.map((t) => (
          <TurnRow key={t.index} turn={t} />
        ))}
        {error && (
          <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2.5 py-1.5 text-[11px] text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </div>

      {isLive && (
        <footer className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 space-y-2">
          {lastUnanswered ? (
            <>
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={2}
                placeholder="Type your answer… (Cmd+Enter to send)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void handleSubmitAnswer()
                  }
                }}
                className="text-sm resize-none"
                disabled={submitting}
              />
              <div className="flex items-center gap-1.5">
                {readyToDraft && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleFinalize}
                    disabled={finalizing || submitting}
                    className="text-xs h-8"
                  >
                    {finalizing ? (
                      <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-3 mr-1" aria-hidden />
                    )}
                    Generate plan diff
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSubmitAnswer}
                  disabled={submitting || answer.trim().length === 0}
                  className="text-xs h-8 ml-auto bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200"
                >
                  {submitting ? (
                    <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-3 mr-1" aria-hidden />
                  )}
                  Send
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-xs text-slate-600 dark:text-slate-300 flex-1">
                {readyToDraft
                  ? 'Atlas signaled ready to draft. Generate the plan diff when you want to gate approval.'
                  : 'Waiting for the next turn…'}
              </p>
              <Button
                type="button"
                size="sm"
                onClick={handleFinalize}
                disabled={finalizing}
                className="text-xs h-8 bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200"
              >
                {finalizing ? (
                  <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-3 mr-1" aria-hidden />
                )}
                Generate plan diff
              </Button>
            </div>
          )}
        </footer>
      )}
    </div>
  )
}

function SessionHeader({ session }: { session: WorkshopSessionDetail }) {
  const prompt = session.workshop_state?.prompt ?? '(no framing recorded)'
  const turns = session.workshop_state?.turns.length ?? 0
  const conceptCount = session.concepts_referenced.length
  return (
    <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
      <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-500">
        <Database className="size-3" aria-hidden />
        <span>
          📚 Atlas read: {conceptCount} concept{conceptCount === 1 ? '' : 's'} · master plan · idea · runtime state · V3 conventions
          {/* V1/V3 file counts are kept inside per-turn citations rather than inflated up here. */}
        </span>
      </div>
      <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 mr-1">prompt:</span>
        {prompt}
      </p>
      <div className="text-[10px] text-slate-400 mt-1 tabular-nums">
        {turns} turn{turns === 1 ? '' : 's'} · ${session.total_cost_usd.toFixed(4)}
      </div>
    </div>
  )
}

function ClarityBar({ value, turns }: { value: number; turns: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))
  const remaining = Math.max(0, Math.ceil((READY_THRESHOLD - value) * 10))
  const tone =
    pct >= 90
      ? 'bg-emerald-500'
      : pct >= 60
      ? 'bg-amber-500'
      : 'bg-amber-700'
  return (
    <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        <span className="uppercase tracking-wider font-semibold">Clarity</span>
        <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <div
            className={cn('h-full transition-all duration-300', tone)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="tabular-nums w-12 text-right">{pct}%</span>
        {turns > 0 && pct < 90 && (
          <span className="text-slate-400">~{remaining} Q to go</span>
        )}
      </div>
    </div>
  )
}

function TurnRow({ turn }: { turn: WorkshopTurnRecord }) {
  return (
    <div className="space-y-1.5">
      <article className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2">
        <header className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1">
          <Sparkles className="size-3" aria-hidden />
          Atlas · turn {turn.index} · confidence {Math.round(turn.confidence_at_propose * 100)}%
        </header>
        <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
          {turn.question}
        </p>
        {turn.options && turn.options.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {turn.options.map((o, i) => (
              <li key={i} className="text-xs text-slate-600 dark:text-slate-300 pl-3 relative">
                <span className="absolute left-0 text-slate-400">•</span>
                {o}
              </li>
            ))}
          </ul>
        )}
        {turn.cited_sources.length > 0 && <CitedSourcesChips sources={turn.cited_sources} />}
      </article>
      {turn.answer !== null && (
        <article className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 ml-6">
          <header className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            You
          </header>
          <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
            {turn.answer}
          </p>
        </article>
      )}
    </div>
  )
}

function CitedSourcesChips({ sources }: { sources: WorkshopCitedSource[] }) {
  const [expanded, setExpanded] = useState(false)
  if (sources.length === 0) return null
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[10px] text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 inline-flex items-center gap-1 transition-colors duration-200"
      >
        <Quote className="size-3" aria-hidden />
        cited: {sources.length} source{sources.length === 1 ? '' : 's'}
        <span className="text-slate-400 ml-0.5">[{expanded ? 'hide' : 'show'}]</span>
      </button>
      {expanded && (
        <ul className="mt-1 space-y-0.5">
          {sources.map((s, i) => {
            const Icon =
              s.kind === 'concept'
                ? Sparkles
                : s.kind === 'open_question'
                ? HelpCircle
                : FileText
            return (
              <li
                key={`${s.kind}-${s.ref}-${i}`}
                className="text-[10px] text-slate-600 dark:text-slate-300 pl-1 flex items-start gap-1.5"
              >
                <Icon className="size-2.5 mt-0.5 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0">
                  <span className="text-slate-400 mr-1">[{s.kind.replace('_', ' ')}]</span>
                  <span className="font-medium">{s.label}</span>
                  {s.excerpt && (
                    <span className="text-slate-500 dark:text-slate-400"> — {s.excerpt}</span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── Right rail container — fetches session for the rail (small re-fetch
//     just for decisions + open_questions; cheaper than threading state). ─

interface RightRailContainerProps {
  sessionId: string
  refreshKey: number
  onBumpList: () => void
}

function RightRailContainer({ sessionId, refreshKey, onBumpList }: RightRailContainerProps) {
  const [session, setSession] = useState<WorkshopSessionDetail | null>(null)

  useEffect(() => {
    let cancelled = false
    getWorkshopSession(sessionId)
      .then((r) => {
        if (cancelled) return
        setSession(r.session)
      })
      .catch(() => {
        if (cancelled) return
        setSession(null)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, refreshKey])

  const status = session?.status ?? 'active'
  const decisions = session?.decision_log ?? []
  const openQuestions = session?.open_questions ?? []

  return (
    <DecisionLogPanel
      decisions={decisions}
      openQuestions={openQuestions}
      status={status}
      // "Pause" today is a no-op-ish — leaves the session active. We bump the
      // session list so the user can switch to another session and come back.
      onPause={useMemo(() => () => onBumpList(), [onBumpList])}
      className="hidden lg:flex"
    />
  )
}

export default PlanWorkshop
