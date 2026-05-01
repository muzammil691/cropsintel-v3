import { Layers } from 'lucide-react'

/**
 * Skeleton wrapper that 1.10ak's PlanTree will plug into. Day-1 just shows a
 * placeholder so the cockpit isn't broken before the knowledge-authoring spec
 * ships. When 1.10ak lands, replace the body with `<PlanTree />` from
 * `@/components/atlas/plan/PlanTree`.
 */
export default function AtlasPlanTab() {
  return (
    <TabFrame
      title="Plan"
      hint="Knowledge tree of phases, sub-tasks, and ADRs. Edit + reorder inline."
    >
      <ComingSoon
        icon={Layers}
        feature="Plan tree"
        owner="1.10ak knowledge authoring"
      />
    </TabFrame>
  )
}

export function TabFrame({
  title,
  hint,
  rightSlot,
  children,
}: {
  title: string
  hint?: string
  rightSlot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            {title}
          </h2>
          {hint && <p className="text-[11px] text-slate-500 truncate">{hint}</p>}
        </div>
        {rightSlot}
      </div>
      <div className="flex-1 overflow-y-auto p-3 bg-slate-50/40 dark:bg-slate-900/20">{children}</div>
    </section>
  )
}

export function ComingSoon({
  icon: Icon,
  feature,
  owner,
}: {
  icon: React.ComponentType<{ className?: string }>
  feature: string
  owner: string
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-12">
      <span className="grid place-items-center size-12 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <Icon className="size-6" />
      </span>
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{feature}</p>
        <p className="text-xs text-slate-500 mt-0.5">Coming soon — ships in {owner}.</p>
      </div>
      <div className="grid grid-cols-3 gap-1.5 w-full max-w-xs">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" />
        ))}
      </div>
    </div>
  )
}
