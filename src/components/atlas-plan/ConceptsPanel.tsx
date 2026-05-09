import { useEffect, useMemo, useRef, useState } from 'react'
import { Lightbulb, Mic, Paperclip, Plus, RefreshCw, Search, Tag, Wand2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fetchConcepts, createConcept, type CockpitConcept } from '@/lib/atlas-client'

type IntakeMode = 'paste' | 'upload' | 'voice' | 'past-chat' | null

interface ConceptsPanelProps {
  onUseInPhase?: (concept: CockpitConcept) => void
  className?: string
}

export function ConceptsPanel({ onUseInPhase, className }: ConceptsPanelProps) {
  const [concepts, setConcepts] = useState<CockpitConcept[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [intake, setIntake] = useState<IntakeMode>(null)
  const [pasteText, setPasteText] = useState('')
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteTheme, setPasteTheme] = useState('')
  const [busy, setBusy] = useState(false)
  const [chatQuery, setChatQuery] = useState('')
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceTitle, setVoiceTitle] = useState('')
  const [recording, setRecording] = useState(false)
  const [filter, setFilter] = useState('')
  const [selectedConcept, setSelectedConcept] = useState<CockpitConcept | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    fetchConcepts()
      .then(setConcepts)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return concepts
    return concepts.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      (c.theme ?? '').toLowerCase().includes(q) ||
      (c.content ?? '').toLowerCase().includes(q),
    )
  }, [concepts, filter])

  const handlePasteSubmit = async () => {
    if (!pasteText.trim() || !pasteTitle.trim()) {
      setError('Title and content required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createConcept({
        title: pasteTitle.slice(0, 200),
        content: pasteText,
        sourceType: 'paste',
        theme: pasteTheme || undefined,
      })
      setPasteText('')
      setPasteTitle('')
      setPasteTheme('')
      setIntake(null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleFileSelected = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      // Read text-ish files inline; binary uploads we record metadata only.
      const isText = file.type.startsWith('text/') || /\.(md|txt|json)$/i.test(file.name)
      let content = `[uploaded file: ${file.name} (${file.type || 'unknown'}, ${file.size} bytes)]`
      if (isText && file.size < 200_000) {
        try { content = await file.text() } catch { /* keep placeholder */ }
      }
      await createConcept({
        title: file.name.slice(0, 200),
        content,
        sourceType: 'upload',
        sourceRef: file.name,
      })
      setIntake(null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleVoiceSubmit = async () => {
    if (!voiceTranscript.trim() || !voiceTitle.trim()) {
      setError('Transcript and title required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createConcept({
        title: voiceTitle.slice(0, 200),
        content: voiceTranscript,
        sourceType: 'voice',
      })
      setVoiceTitle('')
      setVoiceTranscript('')
      setIntake(null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handlePastChatSubmit = async () => {
    if (!chatQuery.trim()) {
      setError('Reference required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createConcept({
        title: chatQuery.slice(0, 80),
        content: `Linked from past chat: "${chatQuery}"`,
        sourceType: 'past-chat',
        sourceRef: chatQuery,
      })
      setChatQuery('')
      setIntake(null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside
      data-testid="concepts-panel"
      className={cn(
        'w-full sm:w-[280px] flex-shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 flex flex-col h-full overflow-hidden',
        className,
      )}
    >
      <div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
            <Lightbulb className="size-3.5" /> Concepts
          </h3>
          <p className="text-[11px] text-slate-500 truncate">
            Ideas come in. Tag, link, build.
          </p>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Refresh concepts"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'size-3 animate-spin' : 'size-3'} />
        </Button>
      </div>

      {/* Intake buttons */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-1 shrink-0">
        <Button
          size="sm"
          variant={intake === 'paste' ? 'default' : 'outline'}
          onClick={() => setIntake(intake === 'paste' ? null : 'paste')}
          className="text-xs h-7"
          aria-pressed={intake === 'paste'}
          aria-label="Paste concept"
        >
          <Plus className="size-3" /> Paste
        </Button>
        <Button
          size="sm"
          variant={intake === 'upload' ? 'default' : 'outline'}
          onClick={() => {
            setIntake(intake === 'upload' ? null : 'upload')
            if (intake !== 'upload') fileInputRef.current?.click()
          }}
          className="text-xs h-7"
          aria-pressed={intake === 'upload'}
          aria-label="Upload file"
        >
          <Paperclip className="size-3" /> Upload
        </Button>
        <Button
          size="sm"
          variant={intake === 'voice' ? 'default' : 'outline'}
          onClick={() => setIntake(intake === 'voice' ? null : 'voice')}
          className="text-xs h-7"
          aria-pressed={intake === 'voice'}
          aria-label="Record voice"
        >
          <Mic className="size-3" /> Voice
        </Button>
        <Button
          size="sm"
          variant={intake === 'past-chat' ? 'default' : 'outline'}
          onClick={() => setIntake(intake === 'past-chat' ? null : 'past-chat')}
          className="text-xs h-7"
          aria-pressed={intake === 'past-chat'}
          aria-label="Link past chat"
        >
          <Search className="size-3" /> Past chat
        </Button>
        <input
          type="file"
          ref={fileInputRef}
          accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.docx"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFileSelected(f)
            e.target.value = ''
          }}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {/* Intake form panel */}
      {intake === 'paste' && (
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 space-y-1.5 shrink-0">
          <input
            type="text"
            value={pasteTitle}
            onChange={(e) => setPasteTitle(e.target.value)}
            placeholder="Title"
            className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste a concept…"
            rows={4}
            className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          <input
            type="text"
            value={pasteTheme}
            onChange={(e) => setPasteTheme(e.target.value)}
            placeholder="Theme (e.g. auth, ui polish)"
            className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setIntake(null)} className="text-[11px] h-7">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handlePasteSubmit}
              disabled={busy}
              className="text-[11px] h-7"
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {intake === 'voice' && (
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 space-y-1.5 shrink-0">
          <input
            type="text"
            value={voiceTitle}
            onChange={(e) => setVoiceTitle(e.target.value)}
            placeholder="Voice memo title"
            className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          <textarea
            value={voiceTranscript}
            onChange={(e) => setVoiceTranscript(e.target.value)}
            placeholder="Transcript (recording → transcribed text)"
            rows={3}
            className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          <div className="flex justify-between items-center gap-1">
            <Button
              size="sm"
              variant={recording ? 'destructive' : 'outline'}
              onClick={() => setRecording((r) => !r)}
              className="text-[11px] h-7"
              aria-pressed={recording}
            >
              <Mic className="size-3" />
              {recording ? 'Stop' : 'Record'}
            </Button>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setIntake(null)} className="text-[11px] h-7">
                Cancel
              </Button>
              <Button size="sm" onClick={handleVoiceSubmit} disabled={busy} className="text-[11px] h-7">
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {intake === 'past-chat' && (
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 space-y-1.5 shrink-0">
          <input
            type="text"
            value={chatQuery}
            onChange={(e) => setChatQuery(e.target.value)}
            placeholder="Find concept from past Cowork or Atlas chat"
            className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setIntake(null)} className="text-[11px] h-7">
              Cancel
            </Button>
            <Button size="sm" onClick={handlePastChatSubmit} disabled={busy} className="text-[11px] h-7">
              Link
            </Button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter concepts…"
          className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
      </div>

      {/* Cards list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1.5">
        {error && (
          <div className="text-[11px] text-red-700 dark:text-red-400 px-2 py-1.5 rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30">
            {error}
          </div>
        )}
        {loading && filtered.length === 0 && (
          <div className="space-y-2 py-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="text-[11px] text-slate-500 italic px-2 py-3">
            No concepts yet. Paste, upload, voice, or link from chat to get started.
          </p>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            data-testid="concept-card"
            className={cn(
              'group rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-emerald-400 transition-colors duration-200 focus-within:ring-2 focus-within:ring-emerald-500/40',
              selectedConcept?.id === c.id && 'border-emerald-500 ring-1 ring-emerald-500/30',
            )}
          >
            <button
              type="button"
              onClick={() => setSelectedConcept(c)}
              className="block w-full text-left px-2 py-1.5 focus:outline-none"
              aria-label={`Open concept ${c.title}`}
            >
              <div className="flex items-start justify-between gap-1">
                <span className="text-[11px] font-medium text-slate-900 dark:text-slate-100 truncate flex-1">
                  {c.title}
                </span>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {c.source_type}
                </span>
              </div>
              {c.theme && (
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
                  <Tag className="size-2.5" /> {c.theme}
                </div>
              )}
            </button>
            <div className="px-2 pb-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('atlas:concept-to-wizard', { detail: c }))
                  if (onUseInPhase) onUseInPhase(c)
                }}
                data-testid="concept-use-in-wizard"
                className="text-[11px] h-6 w-full justify-start gap-1 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                aria-label={`Use ${c.title} in wizard`}
              >
                <Wand2 className="size-3" /> Use in wizard
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Detail drawer */}
      {selectedConcept && (
        <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-2 bg-white dark:bg-slate-950 shrink-0 max-h-[40%] overflow-y-auto">
          <div className="flex items-center justify-between gap-1 mb-1">
            <h4 className="text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate flex-1">
              {selectedConcept.title}
            </h4>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Close detail"
              onClick={() => setSelectedConcept(null)}
            >
              <X className="size-3" />
            </Button>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words mb-1.5">
            {selectedConcept.content.slice(0, 600)}
            {selectedConcept.content.length > 600 && '…'}
          </p>
          <Button
            size="sm"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('atlas:concept-to-wizard', { detail: selectedConcept }))
              if (onUseInPhase) onUseInPhase(selectedConcept)
            }}
            data-testid="concept-detail-use-in-wizard"
            className="text-[11px] h-7 w-full gap-1"
          >
            <Wand2 className="size-3" /> Use in wizard
          </Button>
        </div>
      )}
    </aside>
  )
}

export default ConceptsPanel
