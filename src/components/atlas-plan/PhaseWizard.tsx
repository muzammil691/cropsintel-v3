import { useEffect, useMemo, useRef, useState } from 'react'
import { Wand2, Check, Loader2, X, MessageSquare, Send, Sparkles, Lightbulb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  followPhase as followPhaseApi,
  startDeepWizard,
  answerDeepWizard,
  findResumableDeepWizard,
  deleteDeepWizardSession,
  type WizardSession,
  type CockpitConcept,
} from '@/lib/atlas-client'

interface PhaseWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'add' | 'modify'
  parentTitle: string
  parentBody: string
  phaseId: string
  phaseHint: string
  planNodeId: string
  existingSpec?: string
  /** When true, this is a brand-new phase added via Add. */
  isNewPhase: boolean
  selectedConcepts: CockpitConcept[]
  onCompleted?: (result: { filename: string; markdown: string }) => void
}

type Stage = 'loading' | 'resume' | 'turns' | 'preview' | 'committed' | 'error'

const MAX_WIZARD_TURNS = 12

export function PhaseWizard(props: PhaseWizardProps) {
  const {
    open,
    onOpenChange,
    mode,
    parentTitle,
    parentBody,
    phaseId,
    phaseHint,
    planNodeId,
    existingSpec,
    isNewPhase,
    selectedConcepts,
    onCompleted,
  } = props

  const [stage, setStage] = useState<Stage>('loading')
  const [session, setSession] = useState<WizardSession | null>(null)
  const [resumable, setResumable] = useState<WizardSession | null>(null)
  const [pendingAnswer, setPendingAnswer] = useState('')
  const [pendingFreeText, setPendingFreeText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editedMarkdown, setEditedMarkdown] = useState('')
  const [committedSummary, setCommittedSummary] = useState<{ filename: string; pushed: boolean } | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const freeTextInputId = `wizard-freetext-${phaseId}`
  const specPreviewId = `wizard-spec-${phaseId}`

  // Phase 1.10ba — concept summaries are passed into startDeepWizard. After
  // a session is live, freshly-injected concepts (from ConceptsPanel "Use in
  // wizard") render as visible context cards above the transcript so Atlas's
  // next answer can reference them. Stable reference: serialized join means
  // useEffect below only re-fires when the concept set actually changes,
  // which prevents a render-loop when AtlasPlanTab re-emits state.
  const conceptSummariesKey = selectedConcepts
    .slice(0, 8)
    .map((c) => `${c.id}:${c.title}`)
    .join('|')
  const conceptSummaries = useMemo(
    () =>
      selectedConcepts.slice(0, 8).map((c) => `${c.title} — ${c.content.slice(0, 100).replace(/\s+/g, ' ')}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conceptSummariesKey],
  )

  // Reset on open + check for a resumable session.
  useEffect(() => {
    if (!open) return
    setStage('loading')
    setSession(null)
    setResumable(null)
    setPendingAnswer('')
    setPendingFreeText('')
    setError(null)
    setEditedMarkdown('')
    setCommittedSummary(null)
    let cancelled = false
    ;(async () => {
      try {
        const resume = await findResumableDeepWizard(phaseId).catch(() => ({ session: null }))
        if (cancelled) return
        if (resume.session) {
          setResumable(resume.session)
          setStage('resume')
          return
        }
        const start = await startDeepWizard({
          phaseId,
          parentTitle,
          parentBody,
          phaseHint,
          mode,
          existingSpec,
          conceptSummaries,
        })
        if (cancelled) return
        setSession(start.session)
        setStage(start.session.state.is_complete ? 'preview' : 'turns')
        if (start.session.state.is_complete && start.session.state.spec_draft) {
          setEditedMarkdown(start.session.state.spec_draft)
        }
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStage('error')
      }
    })()
    return () => { cancelled = true }
  }, [open, phaseId, parentTitle, parentBody, phaseHint, mode, existingSpec, conceptSummaries])

  // Auto-scroll the transcript to the bottom as new turns arrive.
  useEffect(() => {
    if (!transcriptRef.current) return
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
  }, [session?.state.history.length, session?.state.current_turn?.question, busy])

  const state = session?.state
  const currentTurn = state?.current_turn
  const clarity = state?.clarity_score ?? 0
  const totalTurns = state?.total_turns ?? 0
  const turnsRemaining = Math.max(0, MAX_WIZARD_TURNS - totalTurns)

  // Clarity-score color band (design tokens, no hex literals).
  const clarityBarClass =
    clarity >= 70 ? 'bg-emerald-600' : clarity >= 40 ? 'bg-amber-500' : 'bg-red-600'

  const sendAnswer = async (answer: string) => {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      const result = await answerDeepWizard({ sessionId: session.id, answer })
      setSession(result.session)
      setPendingAnswer('')
      setPendingFreeText('')
      if (result.session.state.is_complete && result.session.state.spec_draft) {
        setEditedMarkdown(result.session.state.spec_draft)
        setStage('preview')
      } else {
        setStage('turns')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitAnswer = async () => {
    const answer = pendingFreeText.trim() || pendingAnswer.trim()
    if (!answer) {
      setError('Pick an option or type a free-form answer')
      return
    }
    await sendAnswer(answer)
  }

  // Phase 1.10ba — when clarity is high enough, the user can ask Atlas to
  // wrap up. We send a sentinel "ready" answer; the multi-turn engine will
  // generate the spec_draft on its next turn (clarity_score >= 90).
  const generateSpecWhenReady = async () => {
    await sendAnswer('Ready — generate the spec from what we have.')
  }

  const handleResumeAccept = async () => {
    if (!resumable) return
    setSession(resumable)
    if (resumable.state.is_complete && resumable.state.spec_draft) {
      setEditedMarkdown(resumable.state.spec_draft)
      setStage('preview')
    } else {
      setStage('turns')
    }
  }

  const handleResumeDiscard = async () => {
    setBusy(true)
    setError(null)
    try {
      if (resumable) {
        await deleteDeepWizardSession(resumable.id).catch(() => undefined)
      }
      const start = await startDeepWizard({
        phaseId,
        parentTitle,
        parentBody,
        phaseHint,
        mode,
        existingSpec,
        conceptSummaries,
      })
      setResumable(null)
      setSession(start.session)
      setStage(start.session.state.is_complete ? 'preview' : 'turns')
      if (start.session.state.is_complete && start.session.state.spec_draft) {
        setEditedMarkdown(start.session.state.spec_draft)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('error')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveAndFollow = async () => {
    if (!session) return
    const markdown = editedMarkdown.trim() || session.state.spec_draft || ''
    if (!markdown) {
      setError('No spec to save')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await followPhaseApi({
        planNodeId,
        parentTitle,
        phaseId,
        phaseHint,
        mode,
        answers: session.state.history.map((h, i) => ({
          questionId: `t${i + 1}`,
          questionPrompt: h.question,
          answer: h.answer,
        })),
        conceptSummaries,
        existingSpec,
        isNewPhase,
        overrideSpecMarkdown: markdown,
      })
      if (!result.ok) {
        setError(result.reason ?? 'follow_failed')
        return
      }
      setCommittedSummary({ filename: result.filename, pushed: result.pushed })
      setStage('committed')
      onCompleted?.({ filename: result.filename, markdown })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Dynamic dialog description for screen readers — reflects current stage.
  const dialogDescriptionText = (() => {
    if (stage === 'loading') return 'Initializing wizard…'
    if (stage === 'resume') return 'An in-progress wizard session exists for this phase. Resume?'
    if (stage === 'turns') {
      return `Atlas is interviewing you. Question ${totalTurns + 1} of up to ${MAX_WIZARD_TURNS}. Each question depends on your previous answers.`
    }
    if (stage === 'preview') return 'Preview the generated spec, edit if needed, then Save & Add to Follow.'
    if (stage === 'committed') return 'Spec saved and queued.'
    if (stage === 'error') return 'The wizard hit an error. See details below.'
    return ''
  })()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="phase-wizard"
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Wand2 className="size-4 text-emerald-600" aria-hidden="true" />
            {mode === 'add' ? 'Add phase' : 'Modify phase'}
          </DialogTitle>
          <DialogDescription>{dialogDescriptionText}</DialogDescription>
          <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mt-1">
            {parentTitle}
          </h3>
        </DialogHeader>

        {stage === 'loading' && (
          <div
            className="space-y-3 py-2"
            data-testid="wizard-loading"
            aria-busy="true"
            aria-live="polite"
          >
            <span className="sr-only">Atlas is opening the interview…</span>
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-24 w-full" />
            <div className="flex flex-wrap gap-1.5">
              <Skeleton className="h-8 w-20 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-full" />
              <Skeleton className="h-8 w-16 rounded-full" />
            </div>
            <Skeleton className="h-10 w-32" />
          </div>
        )}

        {stage === 'error' && error && (
          <div
            className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300"
            role="alert"
          >
            {error}
          </div>
        )}

        {stage === 'resume' && resumable && (
          <div className="space-y-3 py-2" data-testid="wizard-resume">
            <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Resume? You started a wizard for this phase{' '}
              {new Date(resumable.updated_at).toLocaleString()} —{' '}
              {resumable.state.history.length} turns answered, clarity{' '}
              {Math.round(resumable.state.clarity_score)}%.
            </div>
            <div className="flex gap-2">
              <Button onClick={handleResumeAccept} disabled={busy} className="min-h-[44px]">
                Resume
              </Button>
              <Button
                variant="ghost"
                onClick={handleResumeDiscard}
                disabled={busy}
                className="min-h-[44px]"
              >
                Start over
              </Button>
            </div>
          </div>
        )}

        {stage === 'turns' && state && (
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span data-testid="wizard-clarity">
                Clarity: {Math.round(clarity)}%{turnsRemaining > 0 ? ` — ${turnsRemaining} more questions likely` : ''}.
              </span>
              <span>Turn {totalTurns + 1} of ≤{MAX_WIZARD_TURNS}</span>
            </div>
            <div
              className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden"
              role="progressbar"
              data-testid="wizard-clarity-bar"
              aria-label="Wizard clarity score"
              aria-valuenow={Math.round(clarity)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={cn('h-full transition-all duration-500', clarityBarClass)}
                style={{ width: `${Math.min(100, Math.max(0, clarity))}%` }}
              />
            </div>

            {/* Phase 1.10ba — injected-context cards from ConceptsPanel handoff.
                Renders above the transcript so Atlas's next reply can use them. */}
            {selectedConcepts.length > 0 && (
              <div
                data-testid="wizard-injected-concepts"
                className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-2 py-1.5 space-y-1"
                aria-label="Injected concept context"
              >
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                  <Lightbulb className="size-3" /> Concept context ({selectedConcepts.length})
                </div>
                {selectedConcepts.slice(0, 4).map((c) => (
                  <p key={c.id} className="text-[11px] text-emerald-900 dark:text-emerald-200 truncate">
                    <span className="font-medium">{c.title}</span>
                    {c.theme ? <span className="text-emerald-700/80 dark:text-emerald-400/80"> — {c.theme}</span> : null}
                  </p>
                ))}
                {selectedConcepts.length > 4 && (
                  <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 italic">
                    + {selectedConcepts.length - 4} more
                  </p>
                )}
              </div>
            )}

            <div
              ref={transcriptRef}
              className="max-h-[60vh] md:max-h-72 overflow-y-auto space-y-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2"
              data-testid="wizard-transcript"
              aria-live="polite"
              aria-atomic="false"
              aria-label="Wizard interview transcript"
            >
              {state.history.length === 0 && !currentTurn && (
                <div className="text-xs text-slate-500 italic">Atlas is composing the first question…</div>
              )}
              {state.history.map((h, i) => (
                <div key={`turn-${i}`} className="space-y-1.5" data-testid="wizard-turn">
                  {/* Atlas bubble — left aligned. */}
                  <div className="flex items-start gap-1.5">
                    <MessageSquare
                      className="size-3 text-emerald-600 mt-1.5 shrink-0"
                      aria-hidden="true"
                    />
                    <div className="max-w-[85%] rounded-md rounded-tl-none bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 px-2 py-1.5">
                      <p className="text-xs text-slate-900 dark:text-slate-100">{h.question}</p>
                    </div>
                  </div>
                  {/* User bubble — right aligned. */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-md rounded-tr-none bg-slate-200 dark:bg-slate-800 px-2 py-1.5">
                      <p className="text-xs text-slate-800 dark:text-slate-200">{h.answer}</p>
                    </div>
                  </div>
                </div>
              ))}
              {busy && (
                <div
                  className="flex items-center gap-1.5 text-[11px] text-slate-500"
                  data-testid="wizard-thinking"
                  role="status"
                >
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  <span>Atlas is thinking…</span>
                </div>
              )}
              {!busy && currentTurn && (
                <div className="space-y-1" role="status">
                  <div className="flex items-start gap-1.5">
                    <MessageSquare
                      className="size-3 text-emerald-600 mt-1.5 shrink-0"
                      aria-hidden="true"
                    />
                    <div className="max-w-[85%] rounded-md rounded-tl-none bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 px-2 py-1.5">
                      <p
                        className="text-xs font-medium text-slate-900 dark:text-slate-100"
                        data-testid="wizard-question"
                      >
                        {currentTurn.question}
                      </p>
                      {currentTurn.rationale && (
                        <p className="text-[11px] text-slate-500 italic mt-1">{currentTurn.rationale}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!busy && currentTurn && (
              <div className="space-y-2">
                <div
                  className="flex flex-wrap gap-1.5"
                  role="radiogroup"
                  aria-label="Answer options"
                >
                  {currentTurn.options.map((choice) => {
                    const selected = pendingAnswer === choice && !pendingFreeText
                    return (
                      <button
                        key={choice}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => { setPendingAnswer(choice); setPendingFreeText('') }}
                        className={cn(
                          'min-h-[44px] rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:ring-offset-2',
                          selected
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-emerald-400',
                        )}
                      >
                        {choice}
                      </button>
                    )
                  })}
                </div>
                {currentTurn.allow_freeform && (
                  <div>
                    <Label
                      htmlFor={freeTextInputId}
                      className="text-[11px] text-slate-500 block mb-1"
                    >
                      None of the above — let me describe it:
                    </Label>
                    <textarea
                      id={freeTextInputId}
                      value={pendingFreeText}
                      onChange={(e) => { setPendingFreeText(e.target.value); setPendingAnswer('') }}
                      rows={2}
                      className="w-full text-xs px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:ring-offset-2"
                    />
                  </div>
                )}
              </div>
            )}
            {error && (
              <p className="text-[11px] text-red-600 dark:text-red-400" role="alert">{error}</p>
            )}
          </div>
        )}

        {stage === 'preview' && state && (
          <div className="space-y-2 py-2">
            <div className="text-[11px] text-slate-500">
              Atlas reached {Math.round(state.clarity_score)}% clarity in {totalTurns} turns. Edit the spec below if needed; we&rsquo;ll save the edited version.
            </div>
            {state.summary_of_decisions && (
              <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-800 dark:text-emerald-300">
                {state.summary_of_decisions}
              </div>
            )}
            <Label htmlFor={specPreviewId} className="sr-only">
              Generated spec markdown — edit before saving
            </Label>
            <textarea
              id={specPreviewId}
              data-testid="wizard-spec-preview"
              value={editedMarkdown}
              onChange={(e) => setEditedMarkdown(e.target.value)}
              rows={16}
              className="w-full text-[11px] font-mono px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:ring-offset-2"
            />
            {error && (
              <p className="text-[11px] text-red-600 dark:text-red-400" role="alert">{error}</p>
            )}
          </div>
        )}

        {stage === 'committed' && committedSummary && (
          <div className="space-y-2 py-2">
            <div
              className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5"
              role="status"
            >
              <Check className="size-4" aria-hidden="true" />
              Spec <code className="font-mono">{committedSummary.filename}</code> saved.
              {committedSummary.pushed ? ' Pushed to main.' : ' Push pending.'}
            </div>
          </div>
        )}

        <DialogFooter className="pb-4 flex flex-wrap gap-2">
          {stage === 'turns' && currentTurn && (
            <>
              <Button
                onClick={submitAnswer}
                disabled={busy}
                data-testid="wizard-submit-answer"
                aria-label="Send answer"
                className="min-h-[44px]"
              >
                {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                Send answer
                <Send className="size-3.5" aria-hidden="true" />
              </Button>
              {/* Phase 1.10ba — once Atlas is confident enough, surface a
                  shortcut so the user can finalize without answering more. */}
              <Button
                onClick={generateSpecWhenReady}
                disabled={busy || clarity < 90}
                title={clarity < 90 ? `Available when Atlas reaches 90% clarity (currently ${Math.round(clarity)}%)` : 'Send a "ready" answer to wrap up the interview'}
                data-testid="wizard-generate-spec"
                aria-label="Generate spec when ready"
                variant="outline"
                className="min-h-[44px]"
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                Generate spec when ready
              </Button>
            </>
          )}
          {stage === 'preview' && (
            <>
              <Button
                variant="ghost"
                onClick={() => setStage('turns')}
                disabled={busy}
                className="min-h-[44px]"
              >
                Back to interview
              </Button>
              <Button
                onClick={handleSaveAndFollow}
                disabled={busy}
                data-testid="wizard-save-follow"
                aria-label="Save spec and add to follow list"
                className="min-h-[44px]"
              >
                {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                Save &amp; Add to Follow list
                <Check className="size-3.5" aria-hidden="true" />
              </Button>
            </>
          )}
          {(stage === 'committed' || stage === 'error') && (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              aria-label="Close wizard"
              className="min-h-[44px]"
            >
              <X className="size-3.5" aria-hidden="true" /> Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PhaseWizard
