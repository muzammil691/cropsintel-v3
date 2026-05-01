import { useEffect, useMemo, useState } from 'react'
import { AtSign } from 'lucide-react'
import { MENTION_AGENTS, type MentionAgent } from '@/lib/atlas-slash-commands'

interface MentionMenuProps {
  /** Text after `@`, used to filter the agent list. */
  query: string
  open: boolean
  onSelect: (agent: MentionAgent) => void
  onClose: () => void
}

export function MentionMenu({ query, open, onSelect, onClose }: MentionMenuProps) {
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return MENTION_AGENTS.filter((a) => a.toLowerCase().startsWith(q))
  }, [query])
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    setHighlight(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (!filtered.length) {
        if (e.key === 'Escape') onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => (h + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => (h - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        onSelect(filtered[highlight])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions)
  }, [open, filtered, highlight, onSelect, onClose])

  if (!open) return null
  return (
    <div
      role="listbox"
      aria-label="Mention an agent"
      className="absolute bottom-full left-0 right-0 mb-1 z-50 max-h-[220px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg"
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
        <AtSign className="size-3" /> Address an agent
      </div>
      {filtered.length === 0 ? (
        <div className="px-3 py-3 text-xs text-slate-500">No matching agent.</div>
      ) : (
        <ul className="py-1">
          {filtered.map((a, i) => (
            <li key={a}>
              <button
                type="button"
                onClick={() => onSelect(a)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-baseline gap-2 transition-colors duration-100 ${
                  i === highlight
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <code className="font-mono text-emerald-700 dark:text-emerald-400 shrink-0">
                  @{a}
                </code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
