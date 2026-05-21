// Phase 1.10bb-c Session 4 — Plan Workshop top-level tab.
//
// The standing planning intelligence's UI surface. Replaces the per-phase
// PhaseWizard.tsx (deleted in this same commit). Layout:
//
//   ┌────────────────────────────────────────────────────────────────────┐
//   │ Header (workshop framing + stats)                                  │
//   ├──────────────┬────────────────────────────────┬───────────────────┤
//   │ Session list │ Active session                 │ Decision log      │
//   │ (left rail)  │  • multi-modal input @ start   │ + open questions  │
//   │              │  • chat thread + clarity bar   │ (right rail)      │
//   │              │  • plan diff preview @ end     │                   │
//   └──────────────┴────────────────────────────────┴───────────────────┘
//
// Architecture per Q-decisions baked into the build prompt:
//   • Q1: replaces wizard entirely
//   • Q2: diff-and-confirm mandatory (PlanDiffPreview gates approval)
//   • Q3: anti-drift via decision_log + open_questions (DecisionLogPanel)
//   • Q4: manual summon (this component is the surface; auto-summon arrives in Session 5)
//   • Q5: first-run output is plan diff that drives autonomous build (Session 6)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles,
  Send,
  Loader2,
  RefreshCw,
  Database,
  FileText,
  Quote,
  X,
  CheckCircle2,
  HelpCircle,
  Folder,
  ChevronDown,
  CheckSquare,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  startWorkshopSession,
  getWorkshopSession,
  submitTurnAnswer,
  finalizeWorkshopSession,
  getPlanDiff,
  fetchConcepts,
  type CockpitConcept,
  type WorkshopSessionDetail,
  type WorkshopTurnRecord,
  type WorkshopCitedSource,
  type PlanDiffRow,
} from '@/lib/atlas-client'
import { WorkshopSessionList } from './WorkshopSessionList'
import { DecisionLogPanel } from './DecisionLogPanel'
import { PlanDiffPreview } from './PlanDiffPreview'

const READY_THRESHOLD = 0.9

export function PlanWorkshop() {
  // ─── top-level state ──────────────────────────────────────────────────
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [showStartForm, setShowStartForm] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  function bumpRefresh() {
    setRefreshKey((k) => k + 1)
  }

  return (
    <section className="flex flex-col h-full overflow-hidden bg-white dark:bg-slate-950">
      <header className="px-3 sm:px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-amber-50/60 dark:bg-amber-950/30">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-amber-700 dark:text-amber-300" aria-hidden />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200">
            Plan Workshop
          </h2>
          <span className="text-[10px] text-amber-700 dark:text-amber-400 ml-1">
            standing planning intelligence
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
          Drop concepts and uploads, work through architectural questions, generate a plan diff for approval. Atlas reads the master plan, idea file, V1 + V3 codebases, and prior decision logs on every turn.
        </p>
      </header>

      {/*
        1.10bd-scroll-fix — `auto-rows-[minmax(0,1fr)]` pins the implicit
        grid row to fill the flex-1 height of this container. Without it,
        the row template defaults to `auto` (content-sized), so grid items
        with `h-full` resolve circularly against content height; PlanDiffPreview
        ends up taller than the viewport with no scroll because the parent
        bound is auto-grown. With the explicit minmax(0,1fr) the row tracks
        the container's bounded height and `<main>`'s `h-full` becomes
        definite for PlanDiffPreview's overflow-hidden + flex-1 body chain
        to scroll inside the pane.
      */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_280px] auto-rows-[minmax(0,1fr)] overflow-hidden">
        <WorkshopSessionList
          selectedSessionId={selectedSessionId}
          onSelect={(id) => {
            setShowStartForm(false)
            setSelectedSessionId(id)
          }}
          onStartNew={() => {
            setSelectedSessionId(null)
            setShowStartForm(true)
          }}
          refreshKey={refreshKey}
          className="hidden md:flex"
        />

        {/*
          1.10bd-scroll-fix — `overflow-y-auto` (not `overflow-hidden`) so if
          PlanDiffPreview's internal flex-1 scroll surface ever fails to bound
          (e.g. a header that's taller than the pane), the pane itself
          provides the scroll instead of clipping the action bar below the
          viewport.
        */}
        <main className="flex flex-col min-w-0 min-h-0 h-full overflow-y-auto">
          {showStartForm ? (
            <StartSessionForm
              onStarted={(id) => {
                setShowStartForm(false)
                setSelectedSessionId(id)
                bumpRefresh()
              }}
              onCancel={() => setShowStartForm(false)}
            />
          ) : selectedSessionId ? (
            <ActiveSession
              sessionId={selectedSessionId}
              refreshKey={refreshKey}
              onBumpList={bumpRefresh}
            />
          ) : (
            <EmptyState onStartNew={() => setShowStartForm(true)} />
          )}
        </main>

        {selectedSessionId && (
          <RightRailContainer sessionId={selectedSessionId} refreshKey={refreshKey} onBumpList={bumpRefresh} />
        )}
      </div>
    </section>
  )
}

// ─── Empty state ────────────────────────────────────────────────────────

function EmptyState({ onStartNew }: { onStartNew: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6 max-w-md mx-auto">
      <span className="grid place-items-center size-12 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-medium">Pick a session or start a new one.</p>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          The Workshop is where deep planning happens — multi-turn conversation, citation-grounded, diff-and-confirm.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={onStartNew}
        className="mt-1 bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200"
      >
        Start new workshop
      </Button>
    </div>
  )
}

// ─── Start-session form ────────────────────────────────────────────────

interface StartSessionFormProps {
  onStarted: (sessionId: string) => void
  onCancel: () => void
}

// 1.10bb-c Session 7 — pre-select from the localStorage list ConceptsPanel
// writes when the user clicks "Use in Workshop". Keeping the key in sync with
// ConceptsPanel.WORKSHOP_SELECTION_KEY (string literal duplicated here so
// PlanWorkshop has no circular import on ConceptsPanel).
const WORKSHOP_SELECTION_KEY = 'cockpit_workshop_selected_concept_ids'

function readPreselectedConceptIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(WORKSHOP_SELECTION_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set()
  } catch { return new Set() }
}

function StartSessionForm({ onStarted, onCancel }: StartSessionFormProps) {
  const [prompt, setPrompt] = useState('')
  const [pasteContent, setPasteContent] = useState('')
  const [conceptIds, setConceptIds] = useState<Set<string>>(() => readPreselectedConceptIds())
  const [v3Paths, setV3Paths] = useState('')
  const [v1Paths, setV1Paths] = useState('')
  const [v1Search, setV1Search] = useState('')

  const [concepts, setConcepts] = useState<CockpitConcept[]>([])
  const [conceptsLoading, setConceptsLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchConcepts()
      .then((rows) => {
        if (!cancelled) setConcepts(rows)
      })
      .catch(() => {
        if (!cancelled) setConcepts([])
      })
      .finally(() => {
        if (!cancelled) setConceptsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Stay in sync if the user flags more concepts in the Concepts panel
  // while the form is open.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string[]>).detail
      if (Array.isArray(detail)) setConceptIds(new Set(detail))
    }
    window.addEventListener('atlas:workshop-selection-changed', handler as EventListener)
    return () => window.removeEventListener('atlas:workshop-selection-changed', handler as EventListener)
  }, [])

  async function handleStart() {
    if (prompt.trim().length < 3) {
      setError('Framing prompt required (≥3 characters).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const uploads = pasteContent.trim().length > 0
        ? [
            {
              filename: 'pasted.txt',
              mime: 'text/plain',
              body: pasteContent,
              bytes: pasteContent.length,
            },
          ]
        : undefined
      const splitPaths = (s: string) =>
        s
          .split(/[\n,]/)
          .map((x) => x.trim())
          .filter(Boolean)
      const result = await startWorkshopSession({
        prompt: prompt.trim(),
        conceptIds: Array.from(conceptIds),
        uploads,
        v3Paths: splitPaths(v3Paths),
        v1Paths: splitPaths(v1Paths),
        v1SearchQueries: splitPaths(v1Search),
      })
      onStarted(result.sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          New workshop session
        </h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="text-xs h-7"
        >
          <X className="size-3 mr-1" aria-hidden /> Cancel
        </Button>
      </div>

      <WorkshopIntroCard />

      <FormSection
        label="Framing prompt"
        hint="What are we trying to plan? E.g. 'Refine V3 plan to V1.0-alpha launch.'"
      >
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Refine V3 plan to V1.0-alpha launch."
          className="text-sm"
        />
      </FormSection>

      <FormSection
        label="Paste content (optional)"
        hint="Drop relevant notes, doc snippets, or chat excerpts. Becomes one upload alongside the session context."
      >
        <Textarea
          value={pasteContent}
          onChange={(e) => setPasteContent(e.target.value)}
          rows={3}
          placeholder="(optional)"
          className="text-xs font-mono"
        />
      </FormSection>

      <ConceptMultiSelect
        concepts={concepts}
        conceptsLoading={conceptsLoading}
        selected={conceptIds}
        setSelected={setConceptIds}
      />


      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <FormSection
          label="V3 paths"
          hint="Comma- or newline-separated. e.g. `src/lib/atlas-client.ts`"
        >
          <Textarea
            value={v3Paths}
            onChange={(e) => setV3Paths(e.target.value)}
            rows={2}
            placeholder="(optional)"
            className="text-xs font-mono"
          />
        </FormSection>
        <FormSection
          label="V1 paths"
          hint="Files from muzammil69/almond-oracle (skipped without GITLAB_PAT)."
        >
          <Textarea
            value={v1Paths}
            onChange={(e) => setV1Paths(e.target.value)}
            rows={2}
            placeholder="(optional)"
            className="text-xs font-mono"
          />
        </FormSection>
        <FormSection label="V1 search queries" hint="e.g. `useGuestSession`, `verify_jwt`.">
          <Textarea
            value={v1Search}
            onChange={(e) => setV1Search(e.target.value)}
            rows={2}
            placeholder="(optional)"
            className="text-xs font-mono"
          />
        </FormSection>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2.5 py-1.5 text-[11px] text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy} className="text-xs h-8">
          Cancel
        </Button>
        {(() => {
          // 1.10bb-c Session 8C — submit button reflects selection count and
          // gates on (framing prompt OR ≥1 concept). Either input is enough
          // to kick off a session.
          const framingOk = prompt.trim().length > 0
          const selectedCount = conceptIds.size
          const submitDisabled = busy || (!framingOk && selectedCount === 0)
          const disabledReason = !framingOk && selectedCount === 0
            ? 'Add a framing prompt or select at least one concept.'
            : undefined
          const label = selectedCount > 0
            ? `Start workshop with ${selectedCount} concept${selectedCount === 1 ? '' : 's'}`
            : 'Start workshop'
          return (
            <Button
              type="button"
              size="sm"
              onClick={handleStart}
              disabled={submitDisabled}
              title={disabledReason}
              className="text-xs h-8 bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200"
            >
              {busy ? (
                <>
                  <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
                  Loading context + first turn…
                </>
              ) : (
                <>
                  <Sparkles className="size-3 mr-1" aria-hidden />
                  {label}
                </>
              )}
            </Button>
          )
        })()}
      </div>
    </div>
  )
}

// ─── ConceptMultiSelect ──────────────────────────────────────────────────
//
// 1.10bb-c Session 8C — multi-select w/ folder grouping, range select,
// Cmd+A, indeterminate state on partial folder selection.
//
// Selection model: concepts are flat in the DB but render as a 2-level tree
// in this widget — folder rows (source_type='folder') group children
// (parent_folder === folder.title). A "click on folder row" toggles the
// folder + every child atomically. The submit button at the bottom of the
// form passes the flat Set<conceptId> into startWorkshopSession.

interface ConceptMultiSelectProps {
  concepts: CockpitConcept[]
  conceptsLoading: boolean
  selected: Set<string>
  setSelected: (
    updater: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => void
}

function ConceptMultiSelect({
  concepts,
  conceptsLoading,
  selected,
  setSelected,
}: ConceptMultiSelectProps) {
  const [filter, setFilter] = useState('')
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null)
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false)
  const folderDropdownRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Group concepts: folder parents → their children, plus loose rows.
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matches = (c: CockpitConcept) =>
      !q ||
      c.title.toLowerCase().includes(q) ||
      (c.theme ?? '').toLowerCase().includes(q) ||
      (c.parent_folder ?? '').toLowerCase().includes(q)

    const folderParents: CockpitConcept[] = []
    const childrenByFolder = new Map<string, CockpitConcept[]>()
    const loose: CockpitConcept[] = []

    for (const c of concepts) {
      if (c.source_type === 'folder') {
        if (matches(c)) folderParents.push(c)
      } else if (c.parent_folder) {
        if (matches(c)) {
          const arr = childrenByFolder.get(c.parent_folder) ?? []
          arr.push(c)
          childrenByFolder.set(c.parent_folder, arr)
        }
      } else if (matches(c)) {
        loose.push(c)
      }
    }
    return { folderParents, childrenByFolder, loose }
  }, [concepts, filter])

  // Flat visible order — used by Shift+click range select + "Select all visible".
  // Parents come before their own children so the index space mirrors what the
  // user sees in the DOM.
  const visibleFlat = useMemo(() => {
    const out: CockpitConcept[] = []
    for (const parent of groups.folderParents) {
      out.push(parent)
      for (const child of groups.childrenByFolder.get(parent.title) ?? []) {
        out.push(child)
      }
    }
    for (const c of groups.loose) out.push(c)
    return out
  }, [groups])

  const visibleIds = useMemo(() => new Set(visibleFlat.map((c) => c.id)), [visibleFlat])
  const visibleCount = visibleFlat.length
  const allVisibleSelected = visibleCount > 0 && visibleFlat.every((c) => selected.has(c.id))

  const toggleSingle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [setSelected])

  const setRange = useCallback((startIdx: number, endIdx: number, value: boolean) => {
    const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
    setSelected((prev) => {
      const next = new Set(prev)
      for (let i = lo; i <= hi; i++) {
        const c = visibleFlat[i]
        if (!c) continue
        if (value) next.add(c.id)
        else next.delete(c.id)
      }
      return next
    })
  }, [setSelected, visibleFlat])

  // Atomic folder toggle: pick up the parent row + every child that shares
  // the parent_folder field. Same behaviour whether the user clicks the
  // parent's checkbox or picks the folder from the dropdown.
  const toggleFolder = useCallback((folderTitle: string, forceValue?: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const parent = concepts.find((c) => c.source_type === 'folder' && c.title === folderTitle)
      const children = concepts.filter((c) => c.parent_folder === folderTitle && c.source_type !== 'folder')
      const groupIds = parent ? [parent.id, ...children.map((c) => c.id)] : children.map((c) => c.id)
      // If forceValue isn't provided, toggle based on whether every group
      // member is currently selected.
      const everyOn = groupIds.length > 0 && groupIds.every((id) => prev.has(id))
      const target = forceValue ?? !everyOn
      for (const id of groupIds) {
        if (target) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [concepts, setSelected])

  const clearAll = useCallback(() => {
    setSelected(new Set())
    setLastClickedIdx(null)
  }, [setSelected])

  const selectAllVisible = useCallback(() => {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of visibleIds) next.delete(id)
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of visibleIds) next.add(id)
        return next
      })
    }
  }, [allVisibleSelected, setSelected, visibleIds])

  // Close folder dropdown on outside click.
  useEffect(() => {
    if (!folderDropdownOpen) return
    function onDown(e: MouseEvent) {
      if (!folderDropdownRef.current?.contains(e.target as Node)) {
        setFolderDropdownOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [folderDropdownOpen])

  // Cmd/Ctrl+A while the list is focused → "Select all visible".
  useEffect(() => {
    const node = listRef.current
    if (!node) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        selectAllVisible()
      }
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener('keydown', onKey)
  }, [selectAllVisible])

  const handleRowClick = useCallback((
    e: React.MouseEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
  ) => {
    const concept = visibleFlat[rowIndex]
    if (!concept) return
    if (e.shiftKey && lastClickedIdx !== null) {
      // Range select. Target value = whatever the anchor row's selection is
      // (intuitive: extending the prior toggle), but if the anchor wasn't
      // actually selected we treat shift-click as "add the range".
      const anchor = visibleFlat[lastClickedIdx]
      const target = anchor ? !selected.has(anchor.id) : true
      setRange(lastClickedIdx, rowIndex, target)
      setLastClickedIdx(rowIndex)
      return
    }
    // Cmd / Ctrl click is identical to a normal click here (toggle) — the
    // spec just calls it out for trackpad-explicit intent.
    if (concept.source_type === 'folder') {
      toggleFolder(concept.title)
    } else {
      toggleSingle(concept.id)
    }
    setLastClickedIdx(rowIndex)
  }, [lastClickedIdx, selected, setRange, toggleFolder, toggleSingle, visibleFlat])

  const folderState = useCallback((folderTitle: string): 'all' | 'some' | 'none' => {
    const parent = concepts.find((c) => c.source_type === 'folder' && c.title === folderTitle)
    const children = concepts.filter((c) => c.parent_folder === folderTitle && c.source_type !== 'folder')
    const ids = parent ? [parent.id, ...children.map((c) => c.id)] : children.map((c) => c.id)
    if (ids.length === 0) return 'none'
    const selectedCount = ids.filter((id) => selected.has(id)).length
    if (selectedCount === 0) return 'none'
    if (selectedCount === ids.length) return 'all'
    return 'some'
  }, [concepts, selected])

  return (
    <FormSection
      label="Concepts"
      hint="Select previously-saved concepts to ground the conversation. Atlas summarizes long ones with Haiku before injecting."
    >
      {conceptsLoading ? (
        <p className="text-xs text-slate-500 italic">Loading concepts…</p>
      ) : concepts.length === 0 ? (
        <p className="text-xs text-slate-500 italic">No concepts saved yet — Workshop runs without them.</p>
      ) : (
        <div className="space-y-2">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 -mx-1.5 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={selectAllVisible}
              className="text-[11px] h-7 gap-1"
              aria-label={allVisibleSelected
                ? `Deselect all ${visibleCount} visible concepts`
                : `Select all ${visibleCount} visible concepts`}
            >
              {allVisibleSelected
                ? <><X className="size-3" aria-hidden /> Deselect all visible ({visibleCount})</>
                : <><CheckSquare className="size-3" aria-hidden /> Select all visible ({visibleCount})</>}
            </Button>

            {groups.folderParents.length > 0 && (
              <div className="relative" ref={folderDropdownRef}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setFolderDropdownOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={folderDropdownOpen}
                  className="text-[11px] h-7 gap-1"
                >
                  <Folder className="size-3" aria-hidden /> Select folder
                  <ChevronDown className="size-3" aria-hidden />
                </Button>
                {folderDropdownOpen && (
                  <div
                    role="menu"
                    className="absolute left-0 top-full mt-1 z-20 min-w-[200px] max-h-60 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 shadow-lg py-1"
                  >
                    {groups.folderParents.map((p) => {
                      const childCount = concepts.filter((c) => c.parent_folder === p.title && c.source_type !== 'folder').length
                      const state = folderState(p.title)
                      return (
                        <button
                          key={p.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            toggleFolder(p.title, state !== 'all')
                            setFolderDropdownOpen(false)
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-200 flex items-center gap-1.5 focus:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800"
                        >
                          <Folder className="size-3 text-amber-700 dark:text-amber-300 shrink-0" aria-hidden />
                          <span className="flex-1 truncate">{p.title}</span>
                          <span className="text-[10px] text-slate-500 tabular-nums">
                            {childCount} file{childCount === 1 ? '' : 's'}
                          </span>
                          {state === 'all' && <CheckCircle2 className="size-3 text-amber-700 dark:text-amber-300" aria-hidden />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {selected.size > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearAll}
                className="text-[11px] h-7 gap-1 text-slate-600 dark:text-slate-300"
                aria-label={`Clear ${selected.size} selected`}
              >
                <X className="size-3" aria-hidden /> Clear ({selected.size} selected)
              </Button>
            )}

            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="ml-auto text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/40 w-32"
              aria-label="Filter concepts"
            />
          </div>

          {/* Checkbox list */}
          <div
            ref={listRef}
            tabIndex={0}
            role="listbox"
            aria-multiselectable="true"
            aria-label="Concepts (use Cmd+A to select all visible, Shift+click for range)"
            className="max-h-60 overflow-y-auto space-y-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
          >
            {visibleFlat.length === 0 && (
              <p className="text-xs text-slate-500 italic px-2 py-2">No concepts match the filter.</p>
            )}
            {(() => {
              const rows: React.ReactNode[] = []
              let visibleIdx = 0
              for (const parent of groups.folderParents) {
                const children = groups.childrenByFolder.get(parent.title) ?? []
                const childCount = concepts.filter((c) => c.parent_folder === parent.title && c.source_type !== 'folder').length
                const state = folderState(parent.title)
                rows.push(
                  <ConceptMultiSelectRow
                    key={parent.id}
                    index={visibleIdx}
                    concept={parent}
                    isFolder
                    childCount={childCount}
                    state={state}
                    onRowClick={handleRowClick}
                  />,
                )
                visibleIdx++
                for (const child of children) {
                  rows.push(
                    <ConceptMultiSelectRow
                      key={child.id}
                      index={visibleIdx}
                      concept={child}
                      childOf={parent.title}
                      state={selected.has(child.id) ? 'all' : 'none'}
                      onRowClick={handleRowClick}
                    />,
                  )
                  visibleIdx++
                }
              }
              for (const c of groups.loose) {
                rows.push(
                  <ConceptMultiSelectRow
                    key={c.id}
                    index={visibleIdx}
                    concept={c}
                    state={selected.has(c.id) ? 'all' : 'none'}
                    onRowClick={handleRowClick}
                  />,
                )
                visibleIdx++
              }
              return rows
            })()}
          </div>

          <p className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Info className="size-2.5" aria-hidden />
            Shift+click for range. Cmd/Ctrl+A while the list is focused selects all visible.
          </p>
        </div>
      )}
    </FormSection>
  )
}

interface ConceptMultiSelectRowProps {
  index: number
  concept: CockpitConcept
  isFolder?: boolean
  childOf?: string
  childCount?: number
  state: 'all' | 'some' | 'none'
  onRowClick: (
    e: React.MouseEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>,
    index: number,
  ) => void
}

function ConceptMultiSelectRow({
  index,
  concept,
  isFolder,
  childOf,
  childCount,
  state,
  onRowClick,
}: ConceptMultiSelectRowProps) {
  const cbRef = useRef<HTMLInputElement | null>(null)
  // Honour indeterminate via the DOM property — React props for checkbox
  // don't support tri-state. Sync on every render.
  useEffect(() => {
    if (cbRef.current) cbRef.current.indeterminate = state === 'some'
  }, [state])

  const checked = state === 'all'
  return (
    <label
      className={cn(
        'flex items-start gap-2 px-2 py-1 rounded cursor-pointer text-xs transition-colors duration-100',
        childOf && 'pl-6',
        checked
          ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100'
          : state === 'some'
            ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800/60',
      )}
      role="option"
      aria-selected={checked}
    >
      <input
        ref={cbRef}
        type="checkbox"
        checked={checked}
        onChange={() => { /* handled in onClick to capture shift / meta */ }}
        onClick={(e) => onRowClick(e, index)}
        className="mt-0.5"
        aria-label={isFolder
          ? `Select folder ${concept.title} and its ${childCount ?? 0} files`
          : `Select ${concept.title}`}
      />
      <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
        {isFolder && <Folder className="size-3 text-amber-700 dark:text-amber-300 shrink-0 self-center" aria-hidden />}
        <span className={cn('truncate', isFolder ? 'font-semibold' : 'font-medium')}>{
          childOf ? concept.title.replace(new RegExp('^' + childOf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/'), '') : concept.title
        }</span>
        {isFolder && (
          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
            {childCount} file{childCount === 1 ? '' : 's'}
          </span>
        )}
        {!isFolder && concept.theme && (
          <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">
            {concept.theme}
          </span>
        )}
      </span>
    </label>
  )
}

function FormSection({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
        {label}
      </label>
      {hint && <p className="text-[10px] text-slate-500 dark:text-slate-400">{hint}</p>}
      {children}
    </div>
  )
}

// ─── WorkshopIntroCard ──────────────────────────────────────────────────
//
// 1.10bb-c Session 8C — subtle info card explaining what happens after the
// user clicks "Start workshop". Dismissible via the ✕ in the corner; the
// dismiss state persists in localStorage under
// `atlas_workshop_intro_dismissed`. When dismissed, renders a tiny
// "ℹ How Workshop works" link that re-opens the card AND clears the
// localStorage key (so the next dismiss persists again).

const WORKSHOP_INTRO_DISMISSED_KEY = 'atlas_workshop_intro_dismissed'

function readIntroDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(WORKSHOP_INTRO_DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

function WorkshopIntroCard() {
  const [dismissed, setDismissed] = useState<boolean>(() => readIntroDismissed())

  const dismiss = useCallback(() => {
    try { window.localStorage.setItem(WORKSHOP_INTRO_DISMISSED_KEY, 'true') } catch { /* private mode */ }
    setDismissed(true)
  }, [])

  const reveal = useCallback(() => {
    try { window.localStorage.removeItem(WORKSHOP_INTRO_DISMISSED_KEY) } catch { /* private mode */ }
    setDismissed(false)
  }, [])

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={reveal}
        className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 rounded"
        aria-label="Show how Workshop works"
      >
        <Info className="size-3" aria-hidden />
        How Workshop works
      </button>
    )
  }

  return (
    <section
      aria-labelledby="workshop-intro-heading"
      className="relative rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 pr-9"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss instructions"
        className="absolute top-2 right-2 inline-flex items-center justify-center size-6 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 transition-colors duration-150"
      >
        <X className="size-3" aria-hidden />
      </button>
      <h4
        id="workshop-intro-heading"
        className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2"
      >
        How Workshop works
      </h4>
      <ol className="space-y-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed list-decimal pl-4">
        <li>Share a framing prompt and pick concepts that ground the conversation.</li>
        <li>Atlas asks clarifying questions back to you.</li>
        <li>Every decision logs to the Audit tab — nothing is implicit.</li>
        <li>Atlas produces a plan diff: the current plan vs the proposed one.</li>
        <li>You approve, edit, or reject the diff. Only approved diffs touch the Plan.</li>
      </ol>
      <p className="mt-2 text-xs italic text-slate-400 dark:text-slate-500">
        Typical session: about 8 minutes.
      </p>
    </section>
  )
}

// ─── Active session view ────────────────────────────────────────────────

interface ActiveSessionProps {
  sessionId: string
  refreshKey: number
  onBumpList: () => void
}

function ActiveSession({ sessionId, refreshKey, onBumpList }: ActiveSessionProps) {
  const [session, setSession] = useState<WorkshopSessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [diff, setDiff] = useState<PlanDiffRow | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const r = await getWorkshopSession(sessionId)
      setSession(r.session)
      // If session is awaiting_approval and has a plan_diff_id, fetch the diff.
      if (r.session.status === 'awaiting_approval' && r.session.plan_diff_id) {
        setDiffLoading(true)
        try {
          const d = await getPlanDiff(r.session.plan_diff_id)
          setDiff(d.diff)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setDiffLoading(false)
        }
      } else {
        setDiff(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [sessionId, reload, refreshKey])

  async function handleSubmitAnswer() {
    if (answer.trim().length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      await submitTurnAnswer(sessionId, answer.trim())
      setAnswer('')
      await reload()
      onBumpList()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFinalize() {
    setFinalizing(true)
    setError(null)
    try {
      await finalizeWorkshopSession(sessionId)
      await reload()
      onBumpList()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFinalizing(false)
    }
  }

  function handleDiffResolved(_kind: 'approved' | 'rejected' | 'revised') {
    void reload()
    onBumpList()
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-slate-500 gap-1.5">
        <RefreshCw className="size-3 animate-spin" aria-hidden /> Loading session…
      </div>
    )
  }
  if (error && !session) {
    return (
      <div className="flex-1 p-4">
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      </div>
    )
  }
  if (!session) return null

  // Awaiting approval → show plan diff preview.
  if (session.status === 'awaiting_approval') {
    if (diffLoading) {
      return (
        <div className="flex-1 flex items-center justify-center text-xs text-slate-500 gap-1.5">
          <RefreshCw className="size-3 animate-spin" aria-hidden /> Loading plan diff…
        </div>
      )
    }
    if (!diff) {
      return (
        <div className="flex-1 p-4">
          <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            Session is awaiting approval but the diff couldn&apos;t be loaded. Try Revise from the session list, or check the server logs.
          </div>
        </div>
      )
    }
    return <PlanDiffPreview diff={diff} onResolved={handleDiffResolved} />
  }

  // Active or completed/abandoned → show conversation thread.
  const turns = session.workshop_state?.turns ?? []
  const lastTurn = turns[turns.length - 1] ?? null
  const lastConfidence = session.workshop_state?.last_confidence ?? 0
  const isLive = session.status === 'active'
  const lastUnanswered = lastTurn && lastTurn.answer === null && lastTurn.question
  const readyToDraft = session.workshop_state?.ready_signaled || lastConfidence >= READY_THRESHOLD

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <SessionHeader session={session} />
      <ClarityBar value={lastConfidence} turns={turns.length} />

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {turns.length === 0 && (
          <p className="text-xs text-slate-500 italic px-1 py-2">
            No turns yet — first Atlas message is about to land.
          </p>
        )}
        {turns.map((t) => (
          <TurnRow key={t.index} turn={t} />
        ))}
        {error && (
          <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2.5 py-1.5 text-[11px] text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </div>

      {isLive && (
        <footer className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 space-y-2">
          {lastUnanswered ? (
            <>
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={2}
                placeholder="Type your answer… (Cmd+Enter to send)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void handleSubmitAnswer()
                  }
                }}
                className="text-sm resize-none"
                disabled={submitting}
              />
              <div className="flex items-center gap-1.5">
                {readyToDraft && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleFinalize}
                    disabled={finalizing || submitting}
                    className="text-xs h-8"
                  >
                    {finalizing ? (
                      <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-3 mr-1" aria-hidden />
                    )}
                    Generate plan diff
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSubmitAnswer}
                  disabled={submitting || answer.trim().length === 0}
                  className="text-xs h-8 ml-auto bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200"
                >
                  {submitting ? (
                    <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-3 mr-1" aria-hidden />
                  )}
                  Send
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-xs text-slate-600 dark:text-slate-300 flex-1">
                {readyToDraft
                  ? 'Atlas signaled ready to draft. Generate the plan diff when you want to gate approval.'
                  : 'Waiting for the next turn…'}
              </p>
              <Button
                type="button"
                size="sm"
                onClick={handleFinalize}
                disabled={finalizing}
                className="text-xs h-8 bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200"
              >
                {finalizing ? (
                  <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-3 mr-1" aria-hidden />
                )}
                Generate plan diff
              </Button>
            </div>
          )}
        </footer>
      )}
    </div>
  )
}

function SessionHeader({ session }: { session: WorkshopSessionDetail }) {
  const prompt = session.workshop_state?.prompt ?? '(no framing recorded)'
  const turns = session.workshop_state?.turns.length ?? 0
  const conceptCount = session.concepts_referenced.length
  return (
    <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
      <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-500">
        <Database className="size-3" aria-hidden />
        <span>
          📚 Atlas read: {conceptCount} concept{conceptCount === 1 ? '' : 's'} · master plan · idea · runtime state · V3 conventions
          {/* V1/V3 file counts are kept inside per-turn citations rather than inflated up here. */}
        </span>
      </div>
      <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 mr-1">prompt:</span>
        {prompt}
      </p>
      <div className="text-[10px] text-slate-400 mt-1 tabular-nums">
        {turns} turn{turns === 1 ? '' : 's'} · ${session.total_cost_usd.toFixed(4)}
      </div>
    </div>
  )
}

function ClarityBar({ value, turns }: { value: number; turns: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))
  const remaining = Math.max(0, Math.ceil((READY_THRESHOLD - value) * 10))
  const tone =
    pct >= 90
      ? 'bg-emerald-500'
      : pct >= 60
      ? 'bg-amber-500'
      : 'bg-amber-700'
  return (
    <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        <span className="uppercase tracking-wider font-semibold">Clarity</span>
        <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <div
            className={cn('h-full transition-all duration-300', tone)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="tabular-nums w-12 text-right">{pct}%</span>
        {turns > 0 && pct < 90 && (
          <span className="text-slate-400">~{remaining} Q to go</span>
        )}
      </div>
    </div>
  )
}

function TurnRow({ turn }: { turn: WorkshopTurnRecord }) {
  return (
    <div className="space-y-1.5">
      <article className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2">
        <header className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1">
          <Sparkles className="size-3" aria-hidden />
          Atlas · turn {turn.index} · confidence {Math.round(turn.confidence_at_propose * 100)}%
        </header>
        <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
          {turn.question}
        </p>
        {turn.options && turn.options.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {turn.options.map((o, i) => (
              <li key={i} className="text-xs text-slate-600 dark:text-slate-300 pl-3 relative">
                <span className="absolute left-0 text-slate-400">•</span>
                {o}
              </li>
            ))}
          </ul>
        )}
        {turn.cited_sources.length > 0 && <CitedSourcesChips sources={turn.cited_sources} />}
      </article>
      {turn.answer !== null && (
        <article className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 ml-6">
          <header className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            You
          </header>
          <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
            {turn.answer}
          </p>
        </article>
      )}
    </div>
  )
}

function CitedSourcesChips({ sources }: { sources: WorkshopCitedSource[] }) {
  const [expanded, setExpanded] = useState(false)
  if (sources.length === 0) return null
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[10px] text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 inline-flex items-center gap-1 transition-colors duration-200"
      >
        <Quote className="size-3" aria-hidden />
        cited: {sources.length} source{sources.length === 1 ? '' : 's'}
        <span className="text-slate-400 ml-0.5">[{expanded ? 'hide' : 'show'}]</span>
      </button>
      {expanded && (
        <ul className="mt-1 space-y-0.5">
          {sources.map((s, i) => {
            const Icon =
              s.kind === 'concept'
                ? Sparkles
                : s.kind === 'open_question'
                ? HelpCircle
                : FileText
            return (
              <li
                key={`${s.kind}-${s.ref}-${i}`}
                className="text-[10px] text-slate-600 dark:text-slate-300 pl-1 flex items-start gap-1.5"
              >
                <Icon className="size-2.5 mt-0.5 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0">
                  <span className="text-slate-400 mr-1">[{s.kind.replace('_', ' ')}]</span>
                  <span className="font-medium">{s.label}</span>
                  {s.excerpt && (
                    <span className="text-slate-500 dark:text-slate-400"> — {s.excerpt}</span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── Right rail container — fetches session for the rail (small re-fetch
//     just for decisions + open_questions; cheaper than threading state). ─

interface RightRailContainerProps {
  sessionId: string
  refreshKey: number
  onBumpList: () => void
}

function RightRailContainer({ sessionId, refreshKey, onBumpList }: RightRailContainerProps) {
  const [session, setSession] = useState<WorkshopSessionDetail | null>(null)

  useEffect(() => {
    let cancelled = false
    getWorkshopSession(sessionId)
      .then((r) => {
        if (cancelled) return
        setSession(r.session)
      })
      .catch(() => {
        if (cancelled) return
        setSession(null)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, refreshKey])

  const status = session?.status ?? 'active'
  const decisions = session?.decision_log ?? []
  const openQuestions = session?.open_questions ?? []

  return (
    <DecisionLogPanel
      decisions={decisions}
      openQuestions={openQuestions}
      status={status}
      // "Pause" today is a no-op-ish — leaves the session active. We bump the
      // session list so the user can switch to another session and come back.
      onPause={useMemo(() => () => onBumpList(), [onBumpList])}
      className="hidden lg:flex"
    />
  )
}

export default PlanWorkshop
