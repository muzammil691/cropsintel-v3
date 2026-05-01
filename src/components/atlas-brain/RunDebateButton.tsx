// Phase 1.10ab — RunDebateButton
//
// Opens a small modal asking the admin for the debate prompt + optional context,
// then kicks off the SSE-streamed debate via the provided onSubmit handler.

import { useState } from 'react'
import { Brain, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const MAX_PROMPT = 8000

export interface RunDebateButtonProps {
  busy: boolean
  disabled?: boolean
  onSubmit: (prompt: string, context: string | undefined) => Promise<void> | void
  nodeLabel: string
}

export function RunDebateButton({ busy, disabled, onSubmit, nodeLabel }: RunDebateButtonProps) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [context, setContext] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const close = () => {
    if (submitting) return
    setOpen(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = prompt.trim()
    if (!text || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(text, context.trim() || undefined)
      setOpen(false)
      setPrompt('')
      setContext('')
    } finally {
      setSubmitting(false)
    }
  }

  const remaining = MAX_PROMPT - prompt.length

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        {busy ? (
          <>
            <Loader2 className="size-3.5 motion-safe:animate-spin" /> Debating…
          </>
        ) : (
          <>
            <Brain className="size-3.5" /> Run Multi-Brain
          </>
        )}
      </Button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Run Multi-Brain debate</DialogTitle>
            <DialogDescription>
              All three brains (Claude, GPT-4o, Gemini) will weigh in on{' '}
              <span className="font-medium text-foreground">{nodeLabel}</span>, then GPT-4o judges the consensus.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="brain-prompt" className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Prompt <span className="text-red-500">*</span>
              </label>
              <textarea
                id="brain-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT))}
                placeholder="What would you like the brains to debate?"
                rows={4}
                required
                autoFocus
                disabled={submitting}
                className="w-full p-2 text-sm rounded-md bg-background border border-border outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 resize-y"
              />
              <p className="mt-1 text-[10px] text-slate-400 text-right tabular-nums">{remaining} chars left</p>
            </div>
            <div>
              <label htmlFor="brain-context" className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Optional context
              </label>
              <textarea
                id="brain-context"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Background data, links, prior failure logs…"
                rows={3}
                disabled={submitting}
                className="w-full p-2 text-sm rounded-md bg-background border border-border outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 resize-y"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={close} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!prompt.trim() || submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="size-3.5 motion-safe:animate-spin" /> Starting…
                  </>
                ) : (
                  'Start debate'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
