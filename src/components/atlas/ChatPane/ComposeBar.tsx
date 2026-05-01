import { useEffect, useRef } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MicButton } from '../MicButton'
import { useStt } from '@/hooks/useStt'

interface ComposeBarProps {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  disabled: boolean
  prefill?: string
  onPrefillConsumed?: () => void
}

export function ComposeBar({
  value,
  onChange,
  onSend,
  disabled,
  prefill,
  onPrefillConsumed,
}: ComposeBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stt = useStt()

  useEffect(() => {
    if (prefill) {
      onChange(prefill)
      textareaRef.current?.focus()
      onPrefillConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  function handleTranscript(text: string) {
    const trimmed = value.trim()
    onChange(trimmed ? `${trimmed} ${text}` : text)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-2.5 bg-white dark:bg-slate-950">
      {/* Voice status (aria-live) */}
      <div role="status" aria-live="polite" className="sr-only">
        {stt.recording ? 'Recording. Speak now.'
          : stt.transcribing ? 'Transcribing audio.'
          : ''}
      </div>

      {stt.lastError && (
        <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {stt.lastError}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            stt.recording ? 'Listening…'
              : stt.transcribing ? 'Transcribing…'
              : 'Ask Atlas — Enter to send, Shift+Enter newline'
          }
          className="flex-1 resize-none rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-colors duration-150 max-h-40 overflow-y-auto placeholder:text-slate-400"
          style={{ fieldSizing: 'content' } as React.CSSProperties}
          disabled={disabled}
        />
        <MicButton stt={stt} onTranscript={handleTranscript} disabled={disabled} />
        <Button
          size="icon"
          onClick={onSend}
          disabled={disabled || !value.trim()}
          className="shrink-0 mb-0.5 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Send className="size-4" />
          <span className="sr-only">Send</span>
        </Button>
      </div>
    </div>
  )
}
