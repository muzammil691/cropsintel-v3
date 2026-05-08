import { useEffect, useMemo, useState } from 'react'
import { Wand2, ChevronRight, Check, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  proposeWizard,
  finalizeWizard,
  followPhase as followPhaseApi,
  type WizardQuestion,
  type WizardAnswerInput,
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

type Stage = 'loading' | 'questions' | 'preview' | 'committed' | 'error'

interface AnswerState {
  questionId: string
  answer: string
  freeText: string
}

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
  const [questions, setQuestions] = useState<WizardQuestion[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [answers, setAnswers] = useState<AnswerState[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewMarkdown, setPreviewMarkdown] = useState('')
  const [previewFilename, setPreviewFilename] = useState('')
  const [busy, setBusy] = useState(false)
  const [committedSummary, setCommittedSummary] = useState<{ filename: string; pushed: boolean } | null>(null)

  const conceptSummaries = useMemo(
    () =>
      selectedConcepts.slice(0, 8).map((c) => `${c.title} — ${c.content.slice(0, 100).replace(/\s+/g, ' ')}`),
    [selectedConcepts],
  )

  // Reset on open
  useEffect(() => {
    if (!open) return
    setStage('loading')
    setQuestions([])
    setActiveIndex(0)
    setAnswers([])
    setError(null)
    setPreviewMarkdown('')
    setPreviewFilename('')
    setCommittedSummary(null)
    let cancelled = false
    proposeWizard({
      mode,
      parentTitle,
      parentBody,
      phaseHint,
      existingSpec,
      conceptSummaries,
    })
      .then((res) => {
        if (cancelled) return
        setQuestions(res.questions)
        setAnswers(res.questions.map((q) => ({ questionId: q.id, answer: '', freeText: '' })))
        setStage('questions')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStage('error')
      })
    return () => { cancelled = true }
  }, [open, mode, parentTitle, parentBody, phaseHint, existingSpec, conceptSummaries])

  const currentQuestion = questions[activeIndex]
  const currentAnswer = answers[activeIndex]
  const isLast = activeIndex === questions.length - 1

  const setAnswer = (answer: string) => {
    setAnswers((prev) => {
      const next = [...prev]
      next[activeIndex] = { ...next[activeIndex], answer, freeText: '' }
      return next
    })
  }
  const setFreeText = (freeText: string) => {
    setAnswers((prev) => {
      const next = [...prev]
      next[activeIndex] = { ...next[activeIndex], freeText, answer: 'free-text' }
      return next
    })
  }

  const handleNext = async () => {
    if (!currentQuestion) return
    if (!currentAnswer.answer && !currentAnswer.freeText) {
      setError('Pick an option or enter free text')
      return
    }
    setError(null)
    if (!isLast) {
      setActiveIndex((i) => i + 1)
      return
    }
    // Finalize → preview
    setBusy(true)
    try {
      const wizardAnswers: WizardAnswerInput[] = answers.map((a, i) => ({
        questionId: questions[i].id,
        questionPrompt: questions[i].prompt,
        answer: a.answer,
        freeText: a.freeText || undefined,
      }))
      const res = await finalizeWizard({
        parentTitle,
        phaseId,
        phaseHint,
        mode,
        answers: wizardAnswers,
        conceptSummaries,
        existingSpec,
      })
      setPreviewMarkdown(res.markdown)
      setPreviewFilename(res.filename)
      setStage('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handlePrev = () => {
    if (activeIndex === 0) return
    setActiveIndex((i) => i - 1)
  }

  const handleSaveAndFollow = async () => {
    setBusy(true)
    setError(null)
    try {
      const wizardAnswers: WizardAnswerInput[] = answers.map((a, i) => ({
        questionId: questions[i].id,
        questionPrompt: questions[i].prompt,
        answer: a.answer,
        freeText: a.freeText || undefined,
      }))
      const result = await followPhaseApi({
        planNodeId,
        parentTitle,
        phaseId,
        phaseHint,
        mode,
        answers: wizardAnswers,
        conceptSummaries,
        existingSpec,
        isNewPhase,
      })
      if (!result.ok) {
        setError(result.reason ?? 'follow_failed')
        return
      }
      setCommittedSummary({ filename: result.filename, pushed: result.pushed })
      setStage('committed')
      onCompleted?.({ filename: result.filename, markdown: previewMarkdown })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="phase-wizard"
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Wand2 className="size-4 text-emerald-600" />
            {mode === 'add' ? 'Add phase' : 'Modify phase'} — {parentTitle}
          </DialogTitle>
          <DialogDescription>
            {stage === 'questions' && questions.length > 0 && (
              <>Question {activeIndex + 1} of {questions.length}</>
            )}
            {stage === 'preview' && (
              <>Preview the generated spec, then Save &amp; Add to Follow.</>
            )}
            {stage === 'committed' && (
              <>Spec saved and queued.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {stage === 'loading' && (
          <div className="flex items-center justify-center py-8 gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Atlas is drafting questions…
          </div>
        )}

        {stage === 'error' && error && (
          <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {stage === 'questions' && currentQuestion && (
          <div className="space-y-3 py-2">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {currentQuestion.prompt}
            </p>
            {currentQuestion.rationale && (
              <p className="text-[11px] text-slate-500 italic">{currentQuestion.rationale}</p>
            )}
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {currentQuestion.choices.map((choice) => {
                const selected = currentAnswer?.answer === choice && !currentAnswer?.freeText
                return (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setAnswer(choice)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50',
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
            {currentQuestion.allowFreeText && (
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">
                  None of the above — let me describe it:
                </label>
                <textarea
                  value={currentAnswer?.freeText ?? ''}
                  onChange={(e) => setFreeText(e.target.value)}
                  rows={2}
                  className="w-full text-xs px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
            )}
            {error && (
              <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>
        )}

        {stage === 'preview' && (
          <div className="space-y-2 py-2">
            <div className="text-[11px] text-slate-500">
              Will save as <code className="font-mono text-emerald-700 dark:text-emerald-400">.agent/tasks/queued/{previewFilename}</code>
            </div>
            <pre className="text-[11px] whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-2 max-h-72 overflow-y-auto font-mono">
              {previewMarkdown}
            </pre>
            {error && (
              <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>
        )}

        {stage === 'committed' && committedSummary && (
          <div className="space-y-2 py-2">
            <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <Check className="size-4" />
              Spec <code className="font-mono">{committedSummary.filename}</code> saved.
              {committedSummary.pushed ? ' Pushed to main.' : ' Push pending.'}
            </div>
          </div>
        )}

        <DialogFooter>
          {stage === 'questions' && (
            <>
              <Button
                variant="ghost"
                onClick={handlePrev}
                disabled={activeIndex === 0 || busy}
              >
                Back
              </Button>
              <Button onClick={handleNext} disabled={busy}>
                {isLast ? 'Generate spec' : 'Next'}
                <ChevronRight className="size-3.5" />
              </Button>
            </>
          )}
          {stage === 'preview' && (
            <>
              <Button
                variant="ghost"
                onClick={() => setStage('questions')}
                disabled={busy}
              >
                Back
              </Button>
              <Button onClick={handleSaveAndFollow} disabled={busy}>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                Save &amp; Add to Follow list
              </Button>
            </>
          )}
          {(stage === 'committed' || stage === 'error') && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="size-3.5" /> Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PhaseWizard
