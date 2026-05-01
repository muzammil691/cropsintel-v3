import { useState } from 'react'
import { ChevronRight, ChevronDown, Wrench } from 'lucide-react'
import { AudioPlayer } from '../AudioPlayer'
import type { ChatMessage, ToolCallChip } from '@/lib/atlas-client'
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
// Collapsed by default (per research finding §7 Vercel v0). Click to expand.
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

interface MessageBubbleProps {
  msg: ChatMessage
  tts?: UseTtsResult
}

export function MessageBubble({ msg, tts }: MessageBubbleProps) {
  const isUser = msg.role === 'user'
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
          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="prose-sm">{renderMarkdown(msg.content)}</div>
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
      </div>
      <span className="text-[10px] text-slate-400 px-1 tabular-nums">
        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}
