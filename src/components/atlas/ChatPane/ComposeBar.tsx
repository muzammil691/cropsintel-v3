import { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, Send, Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MicButton } from '../MicButton'
import { useStt } from '@/hooks/useStt'
import {
  uploadChatAttachments,
  type ChatAttachment,
} from '@/lib/atlas-client'
import { AttachmentPreview, type PendingAttachment } from '../AttachmentPreview'
import { ShortcutHelpDialog } from '../ShortcutHelpDialog'
import { htmlToMarkdown, isClaudeCodeTranscript } from '@/lib/turndown'

interface ComposeBarProps {
  value: string
  onChange: (v: string) => void
  onSend: (attachments?: ChatAttachment[]) => void
  disabled: boolean
  prefill?: string
  onPrefillConsumed?: () => void
  threadId?: string
  // Optional callbacks for shortcuts whose targets live higher up the tree.
  onSearch?: () => void
  onCancel?: () => void
  onCopyLastReply?: () => void
  onToggleVoiceMode?: () => void
}

const ALLOWED_MIME_PREFIXES = ['image/', 'text/', 'audio/']
const ALLOWED_MIME_EXACT = new Set([
  'video/mp4', 'video/webm',
  'application/pdf', 'application/json', 'application/zip',
])
const MAX_BYTES = 25 * 1024 * 1024
const MAX_FILES_PER_MESSAGE = 10
const MAX_IMAGES_PER_MESSAGE = 4

function isAllowedMime(mime: string): boolean {
  const lc = mime.toLowerCase()
  if (!lc) return false
  if (ALLOWED_MIME_EXACT.has(lc)) return true
  return ALLOWED_MIME_PREFIXES.some(p => lc.startsWith(p))
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')

function modifierMatches(e: React.KeyboardEvent | KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}

export function ComposeBar({
  value,
  onChange,
  onSend,
  disabled,
  prefill,
  onPrefillConsumed,
  threadId = 'web-default',
  onSearch,
  onCancel,
  onCopyLastReply,
  onToggleVoiceMode,
}: ComposeBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stt = useStt()
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  useEffect(() => {
    if (prefill) {
      onChange(prefill)
      textareaRef.current?.focus()
      onPrefillConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  // Cleanup object URLs when attachments unmount or get removed.
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => {
      const removed = prev.find(p => p.localId === localId)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter(p => p.localId !== localId)
    })
  }, [])

  const enqueueFiles = useCallback(async (files: File[]) => {
    setGlobalError(null)
    if (files.length === 0) return
    const validated: File[] = []
    let imageCount = attachments.filter(a => a.file.type.startsWith('image/')).length
    for (const f of files) {
      if (attachments.length + validated.length >= MAX_FILES_PER_MESSAGE) {
        setGlobalError(`Max ${MAX_FILES_PER_MESSAGE} attachments per message.`)
        break
      }
      if (f.size === 0) {
        setGlobalError(`${f.name}: empty file.`)
        continue
      }
      if (f.size > MAX_BYTES) {
        setGlobalError(`${f.name}: exceeds 25 MB limit.`)
        continue
      }
      if (!isAllowedMime(f.type)) {
        setGlobalError(`${f.name}: unsupported type "${f.type || 'unknown'}".`)
        continue
      }
      if (f.type.startsWith('image/')) {
        if (imageCount >= MAX_IMAGES_PER_MESSAGE) {
          setGlobalError(`Max ${MAX_IMAGES_PER_MESSAGE} images per message.`)
          continue
        }
        imageCount++
      }
      validated.push(f)
    }
    if (validated.length === 0) return

    const pending: PendingAttachment[] = validated.map((file) => ({
      localId: genId(),
      file,
      status: 'uploading',
      previewUrl: file.type.startsWith('image/') || file.type.startsWith('video/')
        ? URL.createObjectURL(file)
        : undefined,
    }))
    setAttachments(prev => [...prev, ...pending])

    // Upload as a batch — server validates and returns AttachmentRecords for each.
    const result = await uploadChatAttachments(validated, threadId)
    setAttachments((prev) => {
      if (!result.ok) {
        const errMsg = result.error + (result.detail ? ` (${result.detail})` : '')
        setGlobalError(`Upload failed: ${errMsg}`)
        return prev.map(p =>
          pending.some(q => q.localId === p.localId) ? { ...p, status: 'error', error: errMsg } : p
        )
      }
      return prev.map((p) => {
        const idx = pending.findIndex(q => q.localId === p.localId)
        if (idx < 0) return p
        const remote = result.attachments[idx]
        return remote ? { ...p, status: 'ready' as const, remote } : p
      })
    })
  }, [attachments, threadId])

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    void enqueueFiles(files)
    if (e.target) e.target.value = ''
  }

  // ─── Drag + drop ──────────────────────────────────────────────────────────
  // Listen for drags anywhere within the chat document so the textarea isn't
  // the only drop zone. The visible overlay simply mirrors the drag state.
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer) return
      const types = Array.from(e.dataTransfer.types || [])
      if (types.includes('Files')) {
        setDragOver(true)
      }
    }
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return
      const types = Array.from(e.dataTransfer.types || [])
      if (types.includes('Files')) {
        e.preventDefault()
      }
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget == null) setDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return
      const types = Array.from(e.dataTransfer.types || [])
      if (!types.includes('Files')) return
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files || [])
      if (files.length) void enqueueFiles(files)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [enqueueFiles])

  // ─── Paste handler ────────────────────────────────────────────────────────
  // Three branches: files / images, rich HTML, plain text. We never log the
  // clipboard contents — only forward bytes to the upload endpoint.
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!e.clipboardData) return
    const files = Array.from(e.clipboardData.files || [])
    if (files.length > 0) {
      e.preventDefault()
      void enqueueFiles(files)
      return
    }
    // Detect images even when the clipboard reports them under items rather
    // than .files (Safari does this with screenshot pastes).
    const items = Array.from(e.clipboardData.items || [])
    const imageItems = items.filter(i => i.kind === 'file' && i.type.startsWith('image/'))
    if (imageItems.length > 0) {
      e.preventDefault()
      const imageFiles = imageItems
        .map(i => i.getAsFile())
        .filter((f): f is File => f != null)
      if (imageFiles.length > 0) void enqueueFiles(imageFiles)
      return
    }

    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    if (html && html.length > 16) {
      e.preventDefault()
      const md = htmlToMarkdown(html).trim() || text
      const insert = md
      const ta = textareaRef.current
      if (ta) {
        const start = ta.selectionStart ?? value.length
        const end = ta.selectionEnd ?? value.length
        const next = value.slice(0, start) + insert + value.slice(end)
        onChange(next)
      } else {
        onChange((value ? value + '\n' : '') + insert)
      }
      return
    }
    if (text && isClaudeCodeTranscript(text)) {
      e.preventDefault()
      const wrapped = '\n```\n' + text.trim() + '\n```\n'
      onChange((value ? value + '\n' : '') + wrapped)
      return
    }
    // Otherwise let the textarea handle plain text natively.
  }, [enqueueFiles, onChange, value])

  // ─── Send ─────────────────────────────────────────────────────────────────
  const doSend = useCallback(() => {
    if (disabled) return
    const allReady = attachments.every(a => a.status === 'ready')
    if (!allReady) {
      setGlobalError('Wait for attachments to finish uploading.')
      return
    }
    if (!value.trim() && attachments.length === 0) return
    const remoteList = attachments
      .map(a => a.remote)
      .filter((r): r is ChatAttachment => !!r)
    onSend(remoteList.length > 0 ? remoteList : undefined)
    // Cleanup local previews after send — they get re-rendered from the
    // optimistic message bubble using the signed URLs from remoteList.
    for (const a of attachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
    }
    setAttachments([])
  }, [attachments, disabled, onSend, value])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter — send.
    if (modifierMatches(e) && e.key === 'Enter') {
      e.preventDefault()
      doSend()
      return
    }
    // Plain Enter — send (preserve previous behaviour).
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      doSend()
      return
    }
    // Esc — cancel ongoing.
    if (e.key === 'Escape' && onCancel) {
      e.preventDefault()
      onCancel()
      return
    }
  }

  // ─── Global hotkeys (no react-hotkeys-hook dep) ───────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = modifierMatches(e)
      // Cmd+/ — open shortcut help.
      if (mod && e.key === '/') {
        e.preventDefault()
        setHelpOpen(o => !o)
        return
      }
      // Cmd+K — focus search.
      if (mod && (e.key === 'k' || e.key === 'K') && !e.shiftKey) {
        if (onSearch) {
          e.preventDefault()
          onSearch()
        }
        return
      }
      // Cmd+; — toggle voice mode.
      if (mod && e.key === ';') {
        if (onToggleVoiceMode) {
          e.preventDefault()
          onToggleVoiceMode()
        }
        return
      }
      // Cmd+Shift+C — copy last Atlas response.
      if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        if (onCopyLastReply) {
          e.preventDefault()
          onCopyLastReply()
        }
        return
      }
      // Cmd+Shift+V — paste as plain text.
      if (mod && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        // Read clipboard text and inject; runs only when textarea is focused.
        if (document.activeElement === textareaRef.current && navigator.clipboard?.readText) {
          e.preventDefault()
          void navigator.clipboard.readText().then((t) => {
            if (!t) return
            const ta = textareaRef.current
            if (!ta) return
            const start = ta.selectionStart ?? value.length
            const end = ta.selectionEnd ?? value.length
            onChange(value.slice(0, start) + t + value.slice(end))
          }).catch(() => { /* permission denied — no-op */ })
        }
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onChange, onCopyLastReply, onSearch, onToggleVoiceMode, value])

  function handleTranscript(text: string) {
    const trimmed = value.trim()
    onChange(trimmed ? `${trimmed} ${text}` : text)
    textareaRef.current?.focus()
  }

  return (
    <div
      className={`relative border-t border-slate-200 dark:border-slate-800 px-3 py-2.5 bg-white dark:bg-slate-950 ${dragOver ? 'ring-2 ring-emerald-500 ring-inset' : ''}`}
    >
      {/* Voice status (aria-live) */}
      <div role="status" aria-live="polite" className="sr-only">
        {stt.recording ? 'Recording. Speak now.'
          : stt.transcribing ? 'Transcribing audio.'
          : ''}
      </div>

      {dragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none rounded-md bg-emerald-50/90 dark:bg-emerald-950/80 border border-dashed border-emerald-500 text-sm text-emerald-700 dark:text-emerald-300 font-medium">
          Drop files to attach (max {MAX_FILES_PER_MESSAGE}, 25 MB each)
        </div>
      )}

      {(stt.lastError || globalError) && (
        <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {globalError ?? stt.lastError}
        </div>
      )}

      <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={handleFilePick}
          accept="image/*,video/mp4,video/webm,application/pdf,text/*,application/json,application/zip,audio/*"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Attach files"
          title="Attach files"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="shrink-0 mb-0.5"
        >
          <Paperclip className="size-4" />
        </Button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            stt.recording ? 'Listening…'
              : stt.transcribing ? 'Transcribing…'
              : 'Ask Atlas — Enter to send, Shift+Enter newline, Cmd+/ for shortcuts'
          }
          className="flex-1 resize-none rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-colors duration-150 max-h-40 overflow-y-auto placeholder:text-slate-400"
          style={{ fieldSizing: 'content' } as React.CSSProperties}
          disabled={disabled}
        />
        <MicButton stt={stt} onTranscript={handleTranscript} disabled={disabled} />
        <Button
          size="icon"
          variant="ghost"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (Cmd+/)"
          onClick={() => setHelpOpen(true)}
          className="shrink-0 mb-0.5"
        >
          <Keyboard className="size-4" />
        </Button>
        <Button
          size="icon"
          onClick={doSend}
          disabled={disabled || (!value.trim() && attachments.length === 0)}
          className="shrink-0 mb-0.5 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Send className="size-4" />
          <span className="sr-only">Send</span>
        </Button>
      </div>

      <ShortcutHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
