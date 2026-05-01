// Phase 1.10ab — BrainNodeList
//
// Left rail of the /atlas-brain page. Shows search + category filter and the
// current set of brain_nodes with score badges. The selected row gets an
// emerald accent + ring; hover gets a subtle muted background.

import { Search } from 'lucide-react'
import type { BrainNode } from '@/lib/brain-client'
import { BrainScoreBadge } from './BrainScoreBadge'
import { cn } from '@/lib/utils'

export interface BrainNodeListProps {
  nodes: BrainNode[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  search: string
  onSearchChange: (s: string) => void
  category: string | null
  onCategoryChange: (c: string | null) => void
  categories: string[]
}

export function BrainNodeList({
  nodes,
  loading,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  category,
  onCategoryChange,
  categories,
}: BrainNodeListProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 space-y-2 border-b border-slate-200 dark:border-slate-800">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" aria-hidden />
          <input
            type="search"
            placeholder="Search nodes…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-7 pr-2 h-8 text-xs rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
            aria-label="Search brain nodes"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <CategoryChip label="All" active={category == null} onClick={() => onCategoryChange(null)} />
          {categories.map((c) => (
            <CategoryChip key={c} label={c} active={category === c} onClick={() => onCategoryChange(c)} />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" role="listbox" aria-label="Brain nodes">
        {loading && nodes.length === 0 ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 rounded-md bg-slate-100 dark:bg-slate-900 animate-pulse" />
            ))}
          </div>
        ) : nodes.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">No nodes match.</p>
        ) : (
          <ul className="py-1">
            {nodes.map((n) => {
              const selected = n.id === selectedId
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onSelect(n.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
                      'hover:bg-slate-100 dark:hover:bg-slate-900',
                      selected && 'bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-inset ring-emerald-500/30',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-xs font-medium truncate', selected ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-800 dark:text-slate-200')}>
                        {n.label}
                      </p>
                      <p className="text-[10px] text-slate-500 truncate">{n.node_key}</p>
                    </div>
                    <BrainScoreBadge score={n.score} size="sm" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-6 px-2 rounded-md text-[10px] uppercase tracking-wide font-medium transition-colors',
        active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800',
      )}
      aria-pressed={active}
    >
      {label}
    </button>
  )
}
