import { useRef, type KeyboardEvent } from 'react'
import { Layers, Inbox, Activity, FileSearch, Workflow, Boxes, Users, Monitor, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AtlasTabKey = 'plan' | 'workshop' | 'queue' | 'agents' | 'audit' | 'workflows' | 'artifacts' | 'team' | 'preview'

export interface TabSpec {
  key: AtlasTabKey
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Optional badge: number → renders as counter; 'dot' → small dot; 'mute' → empty circle. */
  badge?: number | 'dot' | 'mute'
}

interface AtlasTabBarProps {
  active: AtlasTabKey
  onChange: (key: AtlasTabKey) => void
  badges: Partial<Record<AtlasTabKey, number | 'dot' | 'mute'>>
  /** Render in vertical orientation (mobile bottom-nav has 6 tabs in a row instead). */
  orientation?: 'horizontal' | 'vertical'
}

export const ATLAS_TABS: TabSpec[] = [
  { key: 'plan', label: 'Plan', icon: Layers },
  { key: 'workshop', label: 'Workshop', icon: Sparkles },
  { key: 'queue', label: 'Queue', icon: Inbox },
  { key: 'agents', label: 'Agents', icon: Activity },
  { key: 'audit', label: 'Audit', icon: FileSearch },
  { key: 'workflows', label: 'Workflows', icon: Workflow },
  { key: 'artifacts', label: 'Artifacts', icon: Boxes },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'preview', label: 'Preview', icon: Monitor },
]

export function AtlasTabBar({ active, onChange, badges, orientation = 'horizontal' }: AtlasTabBarProps) {
  // Refs for each tab button so keyboard nav can call .focus() after activating.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, currentIdx: number): void {
    let nextIdx: number | null = null
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIdx = (currentIdx + 1) % ATLAS_TABS.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIdx = (currentIdx - 1 + ATLAS_TABS.length) % ATLAS_TABS.length
        break
      case 'Home':
        nextIdx = 0
        break
      case 'End':
        nextIdx = ATLAS_TABS.length - 1
        break
      default:
        return
    }
    e.preventDefault()
    if (nextIdx !== null) {
      const nextKey = ATLAS_TABS[nextIdx].key
      onChange(nextKey)
      // Defer focus until after re-render so the new tab is the focusable one
      // (tabIndex flips from -1 to 0 on activation).
      requestAnimationFrame(() => tabRefs.current[nextIdx!]?.focus())
    }
  }

  return (
    <div
      role="tablist"
      aria-orientation={orientation}
      className={cn(
        'flex',
        orientation === 'horizontal'
          ? 'border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-x-auto'
          : 'flex-col border-r border-slate-200 dark:border-slate-800',
      )}
    >
      {ATLAS_TABS.map((t, idx) => {
        const Icon = t.icon
        const isActive = t.key === active
        const badge = badges[t.key]
        return (
          <button
            key={t.key}
            ref={(el) => { tabRefs.current[idx] = el }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={cn(
              'relative inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:ring-inset',
              isActive
                ? 'text-emerald-700 dark:text-emerald-300 border-b-2 border-emerald-500'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 border-b-2 border-transparent',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span>{t.label}</span>
            {badge !== undefined && <BadgeChip value={badge} active={isActive} />}
          </button>
        )
      })}
    </div>
  )
}

function BadgeChip({ value, active }: { value: number | 'dot' | 'mute'; active: boolean }) {
  if (value === 'mute') {
    return (
      <span
        aria-hidden
        className="ml-1 inline-block size-1.5 rounded-full bg-slate-300 dark:bg-slate-700"
      />
    )
  }
  if (value === 'dot') {
    return (
      <span
        aria-hidden
        className="ml-1 inline-block size-1.5 rounded-full bg-red-500"
      />
    )
  }
  if (typeof value === 'number' && value > 0) {
    return (
      <span
        className={cn(
          'ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums min-w-[18px] text-center',
          active
            ? 'bg-emerald-600 text-white'
            : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200',
        )}
      >
        {value > 99 ? '99+' : value}
      </span>
    )
  }
  return null
}
