// 1.10bb-c Session 9A — Danger Zone (placeholder).
//
// 9B wires: "Wipe local cache", "Delete all connections" (type-the-word
// confirm), "Sign out everywhere".

import { AlertOctagon } from 'lucide-react'

export function DangerZonePage() {
  return (
    <div className="px-3 sm:px-5 py-4 max-w-3xl mx-auto w-full space-y-4">
      <header>
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <AlertOctagon className="size-4 text-rose-600" aria-hidden /> Danger Zone
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
          Bulk-destructive operations. Each requires a type-the-word confirm.
        </p>
      </header>
      <div className="rounded-lg border border-dashed border-rose-300 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/20 px-6 py-10 text-center">
        <AlertOctagon className="size-5 mx-auto text-rose-500 mb-2" aria-hidden />
        <p className="text-sm text-rose-900 dark:text-rose-200 font-medium">Coming in 9B</p>
        <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">
          Wipe-local-cache, delete-all-connections, sign-out-everywhere.
        </p>
      </div>
    </div>
  )
}

export default DangerZonePage
