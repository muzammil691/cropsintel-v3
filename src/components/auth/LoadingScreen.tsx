import { Skeleton } from '@/components/ui/skeleton'

export function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-950">
      <Skeleton className="h-12 w-32 rounded" />
      <Skeleton className="h-4 w-64" />
      <p className="text-sm text-slate-500 mt-2">Loading session…</p>
    </div>
  )
}
