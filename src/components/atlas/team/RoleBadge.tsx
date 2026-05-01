import { cn } from '@/lib/utils'
import type { AtlasRole } from '@/lib/atlas-client'

const ROLE_STYLES: Record<AtlasRole, { bg: string; text: string; label: string }> = {
  owner:    { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-800 dark:text-emerald-200', label: 'Owner' },
  admin:    { bg: 'bg-sky-100 dark:bg-sky-900/40',         text: 'text-sky-800 dark:text-sky-200',         label: 'Admin' },
  operator: { bg: 'bg-amber-100 dark:bg-amber-900/40',     text: 'text-amber-800 dark:text-amber-200',     label: 'Operator' },
  viewer:   { bg: 'bg-slate-200 dark:bg-slate-800',        text: 'text-slate-700 dark:text-slate-200',     label: 'Viewer' },
}

export function RoleBadge({ role, className }: { role: AtlasRole; className?: string }) {
  const s = ROLE_STYLES[role]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        s.bg,
        s.text,
        className,
      )}
    >
      {s.label}
    </span>
  )
}
