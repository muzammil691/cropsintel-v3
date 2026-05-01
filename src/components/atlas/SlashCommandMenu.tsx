import { useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'lucide-react'
import {
  SLASH_COMMANDS,
  commandSignature,
  filterCommands,
  type SlashCommand,
} from '@/lib/atlas-slash-commands'

interface SlashCommandMenuProps {
  /** Current full text in the textarea (used to filter). */
  query: string
  open: boolean
  onSelect: (cmd: SlashCommand) => void
  onClose: () => void
  /** Anchor element (the textarea) — used only for positioning hints; menu is absolutely positioned by parent. */
}

/**
 * Popover that surfaces the available slash commands. Parent positions it
 * (typically `absolute bottom-full left-0`); this component only handles
 * filtering, keyboard nav, and selection.
 */
export function SlashCommandMenu({
  query,
  open,
  onSelect,
  onClose,
}: SlashCommandMenuProps) {
  const filtered = useMemo(() => {
    return query === '' ? SLASH_COMMANDS : filterCommands(query)
  }, [query])

  const [highlight, setHighlight] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

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
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onSelect(filtered[highlight])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        onSelect(filtered[highlight])
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions)
  }, [open, filtered, highlight, onSelect, onClose])

  if (!open) return null

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      className="absolute bottom-full left-0 right-0 mb-1 z-50 max-h-[280px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg"
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
        <Command className="size-3" /> Commands
      </div>
      {filtered.length === 0 ? (
        <div className="px-3 py-3 text-xs text-slate-500">No matching command.</div>
      ) : (
        <ul ref={listRef} className="py-1">
          {filtered.map((c, i) => (
            <li key={c.name}>
              <button
                type="button"
                onClick={() => onSelect(c)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-baseline gap-2 transition-colors duration-100 ${
                  i === highlight
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <code className="font-mono text-emerald-700 dark:text-emerald-400 shrink-0">
                  {commandSignature(c)}
                </code>
                <span className="text-slate-500 truncate">{c.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
