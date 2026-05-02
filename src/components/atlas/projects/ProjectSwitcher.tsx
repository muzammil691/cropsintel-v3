import { useEffect, useState } from 'react'
import { ChevronDown, FolderKanban, Plus, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  fetchAtlasProjects,
  selectAtlasProject,
  type AtlasProject,
  type AtlasProjectListResponse,
  type AtlasRole,
} from '@/lib/atlas-client'
import { NewProjectDialog } from './NewProjectDialog'

interface ProjectSwitcherProps {
  globalRole?: AtlasRole | null
}

/**
 * Phase 1.10av — project chip + popover in the cockpit header.
 *
 * Renders the current project name as a clickable chip. Click opens a popover
 * listing every project the member can access; selecting one POSTs to
 * /atlas/projects/<slug>/select and full-reloads the cockpit so all per-project
 * state (chat, plan, audits, queue) re-fetches against the new project_id.
 *
 * Owners (global role) see a "+ New project" button at the bottom of the popover.
 */
export function ProjectSwitcher({ globalRole }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<AtlasProjectListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)
  const [newDialogOpen, setNewDialogOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchAtlasProjects()
        if (!cancelled) {
          setData(res)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSelect(p: AtlasProject) {
    if (!data || p.slug === data.current.slug) {
      setOpen(false)
      return
    }
    setSwitching(p.slug)
    try {
      await selectAtlasProject(p.slug)
      // Full reload: cockpit needs to re-fetch every per-project resource
      // (chat history, plan tree, queue, audits) under the new project_id.
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSwitching(null)
    }
  }

  function handleProjectCreated(p: AtlasProject) {
    setData((prev) =>
      prev ? { ...prev, projects: [...prev.projects.filter((x) => x.slug !== p.slug), p] } : null,
    )
    // Auto-switch to the newly created project.
    void handleSelect(p)
  }

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target?.closest('[data-project-switcher-root]')) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = data?.projects.find((p) => p.slug === data.current.slug) ?? null

  return (
    <div className="relative" data-project-switcher-root>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors duration-150',
          'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900',
          'hover:bg-slate-100 dark:hover:bg-slate-800',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current ? `Project: ${current.display_name}` : 'Loading project'}
      >
        <FolderKanban className="size-3 shrink-0" aria-hidden />
        <span className="truncate max-w-[120px]">
          {loading ? 'Loading…' : current?.display_name ?? 'No project'}
        </span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 min-w-[260px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 shadow-lg p-1"
          role="menu"
        >
          {error && (
            <div className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</div>
          )}
          {!error && data?.projects.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-500">No projects yet.</div>
          )}
          {!error && data?.projects.map((p) => {
            const isCurrent = p.slug === data.current.slug
            const isSwitching = switching === p.slug
            return (
              <button
                key={p.slug}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={() => void handleSelect(p)}
                disabled={isSwitching}
                className={cn(
                  'w-full text-left rounded-sm px-2 py-1.5 text-xs transition-colors duration-150 flex items-center gap-2',
                  isCurrent
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                <span className="grid place-items-center size-4 shrink-0">
                  {isSwitching ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : isCurrent ? (
                    <Check className="size-3" />
                  ) : null}
                </span>
                <span className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.display_name}</div>
                  <div className="text-[10px] text-slate-500 truncate font-mono">{p.slug} · {p.role}</div>
                </span>
              </button>
            )
          })}
          {globalRole === 'owner' && (
            <>
              <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  setNewDialogOpen(true)
                }}
                className="w-full text-left rounded-sm px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150 flex items-center gap-2 text-slate-700 dark:text-slate-200"
              >
                <Plus className="size-3" aria-hidden />
                New project
              </button>
            </>
          )}
        </div>
      )}

      <NewProjectDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={handleProjectCreated}
      />
    </div>
  )
}
