import { useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Wrench,
  FileText,
  ExternalLink,
  Volume2,
  Mic,
} from 'lucide-react'
import { AudioPlayer } from '../AudioPlayer'
import type { ChatMessage, ChatAttachment, ToolCallChip } from '@/lib/atlas-client'
import type { UseTtsResult } from '@/hooks/useTts'

// ─── Markdown (no external library; same rules as v1 chat panel) ─────────────
function inlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code
          key={i}
          className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-[12px] font-mono"
        >
          {part.slice(1, -1)}
        </code>
      )
    return part
  })
}

function renderMarkdown(text: string): React.ReactNode {
  const blocks = text.split(/\n\n+/)
  return blocks.map((block, bi) => {
    const codeMatch = block.match(/^```(\w*)\n([\s\S]*?)```$/)
    if (codeMatch) {
      return (
        <pre
          key={bi}
          className="my-2 rounded-md bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs overflow-x-auto font-mono"
        >
          <code>{codeMatch[2]}</code>
        </pre>
      )
    }

    if (/^[-*] /m.test(block)) {
      const items = block.split(/\n/).filter((l) => /^[-*] /.test(l))
      return (
        <ul key={bi} className="my-1.5 list-disc pl-4 space-y-0.5 text-sm">
          {items.map((item, i) => (
            <li key={i}>{inlineMarkdown(item.replace(/^[-*] /, ''))}</li>
          ))}
        </ul>
      )
    }

    const headingMatch = block.match(/^(#{1,3}) (.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const Tag = `h${level + 2}` as 'h3' | 'h4' | 'h5'
      const cls = level === 1 ? 'text-base font-semibold mt-3 mb-1' : 'text-sm font-semibold mt-2 mb-0.5'
      return <Tag key={bi} className={cls}>{inlineMarkdown(headingMatch[2])}</Tag>
    }

    const lines = block.split('\n')
    return (
      <p key={bi} className="my-1 text-sm leading-relaxed">
        {lines.map((line, li) => (
          <span key={li}>
            {inlineMarkdown(line)}
            {li < lines.length - 1 && <br />}
          </span>
        ))}
      </p>
    )
  })
}

// ─── Tool call chip ──────────────────────────────────────────────────────────
function ToolChip({ chip }: { chip: ToolCallChip }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left rounded-md"
        onClick={() => setOpen((v) => !v)}
      >
        <Wrench className="size-3 text-slate-500 shrink-0" />
        <span className="font-mono text-slate-600 dark:text-slate-300">{chip.name}</span>
        {open ? (
          <ChevronDown className="size-3 ml-auto text-slate-400" />
        ) : (
          <ChevronRight className="size-3 ml-auto text-slate-400" />
        )}
      </button>
      {open && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-2 py-1.5 space-y-1">
          <div>
            <span className="text-slate-500">args: </span>
            <code className="font-mono text-xs break-all">
              {JSON.stringify(chip.args, null, 2)}
            </code>
          </div>
          {chip.result !== undefined && (
            <div>
              <span className="text-slate-500">result: </span>
              <code className="font-mono text-xs break-all">
                {JSON.stringify(chip.result, null, 2)}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Attachment renderers ────────────────────────────────────────────────────

function ImageAttachment({ att }: { att: ChatAttachment }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 hover:opacity-90 transition-opacity"
      >
        <img
          src={att.signed_url}
          alt={att.name}
          className="max-h-48 w-auto object-cover"
        />
      </button>
      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 cursor-zoom-out"
        >
          <img
            src={att.signed_url}
            alt={att.name}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          />
        </div>
      )}
    </>
  )
}

function VideoAttachment({ att }: { att: ChatAttachment }) {
  return (
    <video
      src={att.signed_url}
      controls
      className="max-h-64 w-auto rounded-md border border-slate-200 dark:border-slate-700 bg-black"
    />
  )
}

function FileCard({ att }: { att: ChatAttachment }) {
  const sizeKb = Math.max(1, Math.round(att.size / 1024))
  const isPdf = att.mime === 'application/pdf'
  const Icon = FileText
  return (
    <a
      href={att.signed_url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors text-xs"
    >
      <Icon className="size-4 text-slate-500" />
      <span className="font-medium truncate max-w-[12rem]">{att.name}</span>
      <span className="text-[10px] text-slate-500">
        {sizeKb < 1024 ? `${sizeKb} KB` : `${(sizeKb / 1024).toFixed(1)} MB`}
        {isPdf && ' · PDF'}
      </span>
      <ExternalLink className="size-3 text-slate-400" />
    </a>
  )
}

function TextInline({ att }: { att: ChatAttachment }) {
  // Inline preview — fetched lazily to avoid cost on long threads.
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  return (
    <details
      onToggle={async (e) => {
        const isOpen = (e.target as HTMLDetailsElement).open
        setOpen(isOpen)
        if (isOpen && content === null && !loading) {
          setLoading(true)
          try {
            const r = await fetch(att.signed_url)
            const t = await r.text()
            setContent(t.slice(0, 64 * 1024))
          } catch (err) {
            setContent(`(failed to load ${err instanceof Error ? err.message : 'unknown error'})`)
          } finally {
            setLoading(false)
          }
        }
      }}
      className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
    >
      <summary className="px-2 py-1.5 cursor-pointer flex items-center gap-1.5">
        <FileText className="size-3 text-slate-500" />
        <span className="font-medium">{att.name}</span>
        <span className="text-[10px] text-slate-400 ml-1">{att.mime}</span>
      </summary>
      {open && (
        <pre className="border-t border-slate-200 dark:border-slate-700 px-2 py-1.5 overflow-x-auto font-mono text-[11px] max-h-72 overflow-y-auto">
          {loading ? 'Loading…' : content ?? ''}
        </pre>
      )}
    </details>
  )
}

function AttachmentList({ attachments }: { attachments: ChatAttachment[] }) {
  if (!attachments || attachments.length === 0) return null
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {attachments
          .filter(a => a.mime?.toLowerCase().startsWith('image/'))
          .map(a => <ImageAttachment key={a.id} att={a} />)}
      </div>
      <div className="flex flex-col gap-2">
        {attachments
          .filter(a => a.mime?.toLowerCase().startsWith('video/'))
          .map(a => <VideoAttachment key={a.id} att={a} />)}
      </div>
      <div className="flex flex-wrap gap-2">
        {attachments
          .filter(a => {
            const mime = a.mime?.toLowerCase() || ''
            return !mime.startsWith('image/') && !mime.startsWith('video/') &&
              !mime.startsWith('text/') && mime !== 'application/json'
          })
          .map(a => <FileCard key={a.id} att={a} />)}
      </div>
      <div className="flex flex-col gap-2">
        {attachments
          .filter(a => {
            const mime = a.mime?.toLowerCase() || ''
            return mime.startsWith('text/') || mime === 'application/json'
          })
          .map(a => <TextInline key={a.id} att={a} />)}
      </div>
    </div>
  )
}

function AudioReplay({ url, label, icon: Icon }: { url: string; label: string; icon: typeof Mic }) {
  const [audio] = useState(() => typeof Audio !== 'undefined' ? new Audio(url) : null)
  const [playing, setPlaying] = useState(false)
  if (!audio) return null
  return (
    <button
      type="button"
      onClick={() => {
        if (playing) {
          audio.pause()
          audio.currentTime = 0
          setPlaying(false)
        } else {
          audio.onended = () => setPlaying(false)
          void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
        }
      }}
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/60"
    >
      <Icon className="size-3" />
      <span>{playing ? 'Pause' : label}</span>
    </button>
  )
}

interface MessageBubbleProps {
  msg: ChatMessage
  tts?: UseTtsResult
}

export function MessageBubble({ msg, tts }: MessageBubbleProps) {
  const isUser = msg.role === 'user'
  const userAudio = msg.audio?.user
  const atlasAudio = msg.audio?.atlas
  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`rounded-lg px-4 py-2.5 max-w-[88%] shadow-sm ${
          isUser
            ? 'bg-emerald-600 text-white rounded-br-sm'
            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-bl-sm'
        }`}
      >
        {isUser ? (
          msg.content && <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="prose-sm">{renderMarkdown(msg.content)}</div>
        )}

        {msg.attachments && msg.attachments.length > 0 && (
          <AttachmentList attachments={msg.attachments} />
        )}

        {(msg.tool_calls ?? []).length > 0 && (
          <div className="mt-2 space-y-1">
            {msg.tool_calls!.map((chip) => (
              <ToolChip key={chip.id} chip={chip} />
            ))}
          </div>
        )}
        {!isUser && tts?.enabled && msg.content && (
          <AudioPlayer
            text={msg.content}
            voiceId={tts.voiceId}
            enabled={tts.enabled}
          />
        )}
        {(userAudio || atlasAudio) && (
          <div className="mt-1.5 flex items-center gap-2">
            {isUser && userAudio?.signed_url && (
              <AudioReplay url={userAudio.signed_url} label="Play your audio" icon={Mic} />
            )}
            {!isUser && atlasAudio?.signed_url && (
              <AudioReplay url={atlasAudio.signed_url} label="Play Atlas" icon={Volume2} />
            )}
          </div>
        )}
      </div>
      <span className="text-[10px] text-slate-400 px-1 tabular-nums">
        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}
