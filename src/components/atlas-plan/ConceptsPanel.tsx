// 1.10bb-c Session 7 — Concepts panel: full per-row action menu,
// type badges, folder upload, palette unified with DecisionLogPanel.
//
// Layout:
//   intake row (paste / upload-file / upload-folder / voice / past-chat)
//   intake form (when an intake mode is open)
//   filter
//   list — folder uploads collapse under a parent row
//   detail drawer (last selected concept)
//
// Folder upload uses <input webkitdirectory> (Chrome/Safari/Firefox). The
// client walks the FileList, strips binary / vendor / build noise, batches
// text files into /atlas/concepts/batch with parent_folder=<root>. The folder
// parent row carries source_type='folder' so it renders as the collapsible
// header in the list.

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Lightbulb,
  Mic,
  Paperclip,
  FolderUp,
  RefreshCw,
  Search,
  Tag,
  Wand2,
  X,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  Eye,
  Link2,
  Folder,
  FileText,
  FileType,
  Image as ImageIcon,
  Mic2,
  Clipboard,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  fetchConcepts,
  createConcept,
  createConceptsBatch,
  updateConcept,
  deleteConcept,
  linkConceptToPhase,
  fetchPlan,
  type CockpitConcept,
  type PlanNode,
  type ConceptSourceType,
} from '@/lib/atlas-client'

type IntakeMode = 'paste' | 'upload' | 'upload-folder' | 'voice' | 'past-chat' | null
type DisplayKind = 'paste' | 'voice' | 'past-chat' | 'folder' | 'pdf' | 'md' | 'image' | 'upload'

interface ConceptsPanelProps {
  onUseInPhase?: (concept: CockpitConcept) => void
  className?: string
}

// Hex extensions that should never become concept rows — we'd just bloat
// the table with binaries the LLM can't read.
const BINARY_EXTS = new Set<string>([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'tif',
  'mp3', 'mp4', 'mov', 'webm', 'wav', 'flac', 'm4a', 'ogg',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
  'exe', 'dll', 'so', 'dylib', 'a', 'o', 'class',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'wasm', 'pyc',
])

// Path-fragment denylist — vendor / build / version-control noise. Matched
// against any path segment (so `node_modules/foo/bar.js` is rejected on the
// first segment, no matter how deep the file).
const SKIPPED_SEGMENTS = new Set<string>([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  'coverage', '.cache', '.turbo', '.parcel-cache', '__pycache__',
  '.DS_Store', '.idea', '.vscode',
])

const SKIPPED_FILENAMES = new Set<string>([
  '.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'bun.lockb', 'Cargo.lock', 'composer.lock', 'Gemfile.lock', 'poetry.lock',
])

const MAX_FILE_BYTES = 200_000 // skip individual files larger than ~200 KB
const TEXT_EXT_HINTS = new Set<string>([
  'md', 'txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less',
  'html', 'htm', 'svg', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc',
  'php', 'lua', 'pl', 'r', 'sql', 'graphql', 'gql', 'proto',
  'env', 'gitignore', 'editorconfig', 'prettierrc', 'eslintrc',
])

const WORKSHOP_SELECTION_KEY = 'cockpit_workshop_selected_concept_ids'

// localStorage-backed "use in Workshop" set. PlanWorkshop's StartSessionForm
// reads the same key to pre-select concepts on new session.
function readWorkshopSelection(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(WORKSHOP_SELECTION_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set()
  } catch { return new Set() }
}

function writeWorkshopSelection(ids: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WORKSHOP_SELECTION_KEY, JSON.stringify(Array.from(ids)))
    window.dispatchEvent(new CustomEvent('atlas:workshop-selection-changed', { detail: Array.from(ids) }))
  } catch { /* private mode */ }
}

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function classifyForBadge(concept: CockpitConcept): DisplayKind {
  if (concept.source_type === 'folder') return 'folder'
  if (concept.source_type === 'paste') return 'paste'
  if (concept.source_type === 'voice') return 'voice'
  if (concept.source_type === 'past-chat') return 'past-chat'
  // 'upload' — infer from extension/title
  const ref = concept.source_ref ?? concept.title
  const ext = fileExt(ref)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return 'image'
  return 'upload'
}

const BADGE_META: Record<DisplayKind, { label: string; Icon: typeof Folder; className: string }> = {
  folder:    { label: 'folder', Icon: Folder,      className: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800' },
  paste:     { label: 'paste',  Icon: Clipboard,   className: 'bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800' },
  voice:     { label: 'voice',  Icon: Mic2,        className: 'bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-900/40 dark:text-violet-200 dark:border-violet-800' },
  'past-chat': { label: 'chat', Icon: Search,      className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
  pdf:       { label: 'pdf',    Icon: FileType,    className: 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-800' },
  md:        { label: 'md',     Icon: FileText,    className: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800' },
  image:     { label: 'image',  Icon: ImageIcon,   className: 'bg-pink-100 text-pink-900 border-pink-300 dark:bg-pink-900/40 dark:text-pink-200 dark:border-pink-800' },
  upload:    { label: 'file',   Icon: Paperclip,   className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
}

function TypeBadge({ kind }: { kind: DisplayKind }) {
  const meta = BADGE_META[kind]
  const Icon = meta.Icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide shrink-0',
        meta.className,
      )}
      aria-label={`Type: ${meta.label}`}
    >
      <Icon className="size-2.5" aria-hidden />
      {meta.label}
    </span>
  )
}

interface FolderUploadEntry {
  path: string         // full webkitRelativePath
  file: File
}

interface FolderProgress {
  total: number
  done: number
  rootName: string
}

export function ConceptsPanel({ onUseInPhase, className }: ConceptsPanelProps) {
  const [concepts, setConcepts] = useState<CockpitConcept[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [intake, setIntake] = useState<IntakeMode>(null)
  const [pasteText, setPasteText] = useState('')
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteTheme, setPasteTheme] = useState('')
  const [busy, setBusy] = useState(false)
  const [chatQuery, setChatQuery] = useState('')
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceTitle, setVoiceTitle] = useState('')
  const [recording, setRecording] = useState(false)
  const [filter, setFilter] = useState('')
  const [selectedConcept, setSelectedConcept] = useState<CockpitConcept | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [workshopSel, setWorkshopSel] = useState<Set<string>>(() => readWorkshopSelection())
  const [folderProgress, setFolderProgress] = useState<FolderProgress | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ title: string; theme: string; content: string }>({ title: '', theme: '', content: '' })
  const [linkingConcept, setLinkingConcept] = useState<CockpitConcept | null>(null)
  // 1.10bb-c Session 8C — pending Delete confirmation. Modal rendered at
  // the bottom of <aside>; null means no modal.
  const [confirmingDelete, setConfirmingDelete] = useState<CockpitConcept | null>(null)
  const [planNodes, setPlanNodes] = useState<PlanNode[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const menuRootRef = useRef<HTMLDivElement | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    fetchConcepts()
      .then(setConcepts)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Sync the Workshop-selection set across tabs / components that mutate it.
  useEffect(() => {
    const handler = () => setWorkshopSel(readWorkshopSelection())
    window.addEventListener('atlas:workshop-selection-changed', handler)
    return () => window.removeEventListener('atlas:workshop-selection-changed', handler)
  }, [])

  // Close action menu when clicking outside.
  useEffect(() => {
    if (!openMenuId) return
    function onDown(e: MouseEvent) {
      if (!menuRootRef.current?.contains(e.target as Node)) setOpenMenuId(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [openMenuId])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return concepts
    return concepts.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      (c.theme ?? '').toLowerCase().includes(q) ||
      (c.content ?? '').toLowerCase().includes(q) ||
      (c.parent_folder ?? '').toLowerCase().includes(q),
    )
  }, [concepts, filter])

  // Bucket concepts into (a) folder parents + their children, and (b) loose
  // rows that aren't part of any folder upload. Both go into a single ordered
  // list so the filter-bar still sees a flat result count.
  const grouped = useMemo(() => {
    const folderParents = new Map<string, CockpitConcept>() // folderName → parent row
    const childrenByFolder = new Map<string, CockpitConcept[]>()
    const loose: CockpitConcept[] = []
    for (const c of filtered) {
      if (c.source_type === 'folder') {
        folderParents.set(c.title, c)
      } else if (c.parent_folder) {
        const arr = childrenByFolder.get(c.parent_folder) ?? []
        arr.push(c)
        childrenByFolder.set(c.parent_folder, arr)
      } else {
        loose.push(c)
      }
    }
    return { folderParents, childrenByFolder, loose }
  }, [filtered])

  // ─── intake handlers ────────────────────────────────────────────────────

  const handlePasteSubmit = async () => {
    if (!pasteText.trim() || !pasteTitle.trim()) { setError('Title and content required'); return }
    setBusy(true); setError(null)
    try {
      await createConcept({
        title: pasteTitle.slice(0, 200),
        content: pasteText,
        sourceType: 'paste',
        theme: pasteTheme || undefined,
      })
      setPasteText(''); setPasteTitle(''); setPasteTheme(''); setIntake(null); load()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  const handleFileSelected = async (file: File) => {
    setBusy(true); setError(null)
    try {
      const isText = file.type.startsWith('text/') || /\.(md|txt|json|csv|yaml|yml)$/i.test(file.name)
      let content = `[uploaded file: ${file.name} (${file.type || 'unknown'}, ${file.size} bytes)]`
      if (isText && file.size < MAX_FILE_BYTES) {
        try { content = await file.text() } catch { /* keep placeholder */ }
      }
      await createConcept({
        title: file.name.slice(0, 200),
        content,
        sourceType: 'upload',
        sourceRef: file.name,
      })
      setIntake(null); load()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  // Folder upload — Chromium / Safari / Firefox all set webkitRelativePath on
  // FileList entries when input.webkitdirectory is true.
  const handleFolderSelected = async (fileList: FileList) => {
    const allFiles: FolderUploadEntry[] = []
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList.item(i)
      if (!f) continue
      // webkitRelativePath is "folderName/path/to/file.tsx" — first segment is root
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      allFiles.push({ path: rel, file: f })
    }
    if (allFiles.length === 0) { setError('Folder appeared empty'); return }

    const rootName = allFiles[0].path.split('/')[0] || 'folder'

    // Filter pass: drop denylisted segments, binary extensions, oversize.
    const kept: FolderUploadEntry[] = []
    for (const entry of allFiles) {
      const segments = entry.path.split('/')
      if (segments.some((s) => SKIPPED_SEGMENTS.has(s))) continue
      const base = segments[segments.length - 1] ?? entry.file.name
      if (SKIPPED_FILENAMES.has(base)) continue
      const ext = fileExt(base)
      if (BINARY_EXTS.has(ext)) continue
      if (entry.file.size === 0) continue
      if (entry.file.size > MAX_FILE_BYTES) continue
      // Hidden dotfiles other than well-known config: skip.
      if (base.startsWith('.') && !['.env', '.gitignore', '.editorconfig', '.eslintrc', '.prettierrc'].includes(base)) {
        continue
      }
      kept.push(entry)
    }

    if (kept.length === 0) {
      setError(`No ingestible files in ${rootName}/ (after filtering binaries, vendor dirs, lockfiles).`)
      return
    }

    setBusy(true); setError(null); setIntake(null)
    setFolderProgress({ total: kept.length, done: 0, rootName })

    try {
      // 1) Create the folder parent row first so children link to it via parent_folder.
      await createConcept({
        title: rootName,
        content: `Folder upload: ${rootName}/ (${kept.length} text files retained out of ${allFiles.length} total).`,
        sourceType: 'folder',
        sourceRef: rootName,
      })

      // 2) Stream-read files into batches. We chunk into groups of 25 so the
      //    UI can update progress without blowing the request body past
      //    ~500 KB and so a single failure doesn't lose 300 files of work.
      const BATCH_SIZE = 25
      let cursor = 0
      let inserted = 0
      while (cursor < kept.length) {
        const slice = kept.slice(cursor, cursor + BATCH_SIZE)
        const rows = await Promise.all(slice.map(async (entry) => {
          let content = ''
          try { content = await entry.file.text() } catch { content = '' }
          if (content.length > MAX_FILE_BYTES) content = content.slice(0, MAX_FILE_BYTES) + '\n\n[…truncated]'
          const ext = fileExt(entry.file.name)
          const sourceType: ConceptSourceType = 'upload'
          return {
            title: entry.path.slice(0, 200),
            content,
            sourceType,
            sourceRef: entry.path,
            theme: TEXT_EXT_HINTS.has(ext) ? ext : undefined,
          }
        }))
        const result = await createConceptsBatch({ parentFolder: rootName, concepts: rows })
        inserted += result.inserted
        cursor += BATCH_SIZE
        setFolderProgress({ total: kept.length, done: cursor, rootName })
      }

      setExpandedFolders((prev) => new Set(prev).add(rootName))
      setFolderProgress(null)
      load()
      if (inserted < kept.length) {
        setError(`Inserted ${inserted}/${kept.length} files. The rest were rejected server-side.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setFolderProgress(null)
    } finally {
      setBusy(false)
    }
  }

  const handleVoiceSubmit = async () => {
    if (!voiceTranscript.trim() || !voiceTitle.trim()) { setError('Transcript and title required'); return }
    setBusy(true); setError(null)
    try {
      await createConcept({
        title: voiceTitle.slice(0, 200),
        content: voiceTranscript,
        sourceType: 'voice',
      })
      setVoiceTitle(''); setVoiceTranscript(''); setIntake(null); load()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  const handlePastChatSubmit = async () => {
    if (!chatQuery.trim()) { setError('Reference required'); return }
    setBusy(true); setError(null)
    try {
      await createConcept({
        title: chatQuery.slice(0, 80),
        content: `Linked from past chat: "${chatQuery}"`,
        sourceType: 'past-chat',
        sourceRef: chatQuery,
      })
      setChatQuery(''); setIntake(null); load()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  // ─── per-row actions ───────────────────────────────────────────────────

  const toggleWorkshopSel = (id: string) => {
    setWorkshopSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      writeWorkshopSelection(next)
      return next
    })
  }

  const startEdit = (c: CockpitConcept) => {
    setEditingId(c.id)
    setEditDraft({ title: c.title, theme: c.theme ?? '', content: c.content })
    setOpenMenuId(null)
  }

  const saveEdit = async () => {
    if (!editingId) return
    setBusy(true); setError(null)
    try {
      const updated = await updateConcept(editingId, {
        title: editDraft.title.slice(0, 200),
        content: editDraft.content,
        theme: editDraft.theme || undefined,
      })
      setConcepts((prev) => prev.map((c) => c.id === editingId ? updated : c))
      setEditingId(null)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  // 1.10bb-c Session 8C — Delete bug fix.
  //
  // Replaced window.confirm() (which sporadically no-ops inside GitHub Pages'
  // service-worker-controlled context and can't be styled) with a proper
  // Dialog. The kebab "Delete" item now opens a confirm modal; the actual
  // mutation runs only when the user clicks the destructive Confirm button.
  const requestDelete = (c: CockpitConcept) => {
    setOpenMenuId(null)
    setConfirmingDelete(c)
  }

  const executeDelete = async () => {
    if (!confirmingDelete) return
    const target = confirmingDelete
    const childCount = target.source_type === 'folder'
      ? concepts.filter((c) => c.parent_folder === target.title).length
      : 0
    setBusy(true)
    setError(null)
    setConfirmingDelete(null)
    try {
      await deleteConcept(target.id)
      // Optimistic local update — drop the row (and any folder children)
      // before the refetch so the UI feels instant even on a slow network.
      setConcepts((prev) => prev.filter((c) => {
        if (c.id === target.id) return false
        if (target.source_type === 'folder' && c.parent_folder === target.title) return false
        return true
      }))
      if (selectedConcept?.id === target.id) setSelectedConcept(null)
      if (target.source_type === 'folder') {
        toast.success(`Deleted folder '${target.title}' and ${childCount} ${childCount === 1 ? 'file' : 'files'}`, { duration: 4000 })
      } else {
        toast.success(`Deleted '${target.title}'`, { duration: 4000 })
      }
      // Authoritative refetch — folds in anything the optimistic update
      // missed (server-side cascade counts can differ from client estimates).
      load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(`Failed to delete. ${msg}`, { duration: 6000 })
      // Refetch on failure to undo any optimistic mutation.
      load()
    } finally {
      setBusy(false)
    }
  }

  const openLinkPicker = async (c: CockpitConcept) => {
    setLinkingConcept(c)
    setOpenMenuId(null)
    if (planNodes.length === 0) {
      try {
        const r = await fetchPlan()
        setPlanNodes(r.flat ?? [])
      } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    }
  }

  const handleLinkToPhase = async (planNodeId: string) => {
    if (!linkingConcept) return
    setBusy(true); setError(null)
    try {
      await linkConceptToPhase(linkingConcept.id, planNodeId)
      setLinkingConcept(null)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  // ─── render ─────────────────────────────────────────────────────────────

  return (
    <aside
      data-testid="concepts-panel"
      className={cn(
        'w-full sm:w-[300px] flex-shrink-0 flex flex-col h-full overflow-hidden',
        'bg-amber-50/40 dark:bg-amber-950/10',
        'border-r border-amber-200/60 dark:border-amber-900/40',
        className,
      )}
    >
      <header className="px-3 py-2.5 border-b border-amber-200/60 dark:border-amber-900/40 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
            <Lightbulb className="size-3.5 text-amber-700 dark:text-amber-300" /> Concepts
            {workshopSel.size > 0 && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-700 text-white text-[9px] font-semibold px-1.5 py-0.5">
                <Wand2 className="size-2.5" aria-hidden /> {workshopSel.size}
              </span>
            )}
          </h3>
          <p className="text-[10px] text-amber-800/70 dark:text-amber-300/70 truncate">
            Ingest. Flag. Workshop reads selected.
          </p>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Refresh concepts"
          onClick={load}
          disabled={loading || busy}
        >
          <RefreshCw className={loading ? 'size-3 animate-spin' : 'size-3'} />
        </Button>
      </header>

      {/* Intake buttons — paste / upload / upload-folder / voice / past-chat */}
      <div className="px-3 py-2 border-b border-amber-200/60 dark:border-amber-900/40 grid grid-cols-2 gap-1 shrink-0">
        <Button
          size="sm"
          variant={intake === 'paste' ? 'default' : 'outline'}
          onClick={() => setIntake(intake === 'paste' ? null : 'paste')}
          className="text-[11px] h-7"
          aria-pressed={intake === 'paste'}
        >
          <Clipboard className="size-3" /> Paste
        </Button>
        <Button
          size="sm"
          variant={intake === 'upload' ? 'default' : 'outline'}
          onClick={() => {
            setIntake('upload')
            fileInputRef.current?.click()
          }}
          className="text-[11px] h-7"
          aria-pressed={intake === 'upload'}
        >
          <Paperclip className="size-3" /> Upload
        </Button>
        <Button
          size="sm"
          variant={intake === 'upload-folder' ? 'default' : 'outline'}
          onClick={() => {
            setIntake('upload-folder')
            folderInputRef.current?.click()
          }}
          className="text-[11px] h-7 col-span-2 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40 transition-colors duration-200"
          aria-pressed={intake === 'upload-folder'}
          title="Pick a folder. Vendor dirs (node_modules, .git, dist) + binaries auto-stripped."
        >
          <FolderUp className="size-3" /> Upload folder
        </Button>
        <Button
          size="sm"
          variant={intake === 'voice' ? 'default' : 'outline'}
          onClick={() => setIntake(intake === 'voice' ? null : 'voice')}
          className="text-[11px] h-7"
          aria-pressed={intake === 'voice'}
        >
          <Mic className="size-3" /> Voice
        </Button>
        <Button
          size="sm"
          variant={intake === 'past-chat' ? 'default' : 'outline'}
          onClick={() => setIntake(intake === 'past-chat' ? null : 'past-chat')}
          className="text-[11px] h-7"
          aria-pressed={intake === 'past-chat'}
        >
          <Search className="size-3" /> Past chat
        </Button>
        <Label htmlFor="concepts-file-upload-input" className="sr-only">
          Upload a single file (text, markdown, PDF, image, JSON, YAML, or CSV)
        </Label>
        <input
          id="concepts-file-upload-input"
          type="file"
          ref={fileInputRef}
          aria-label="Upload a single file as a concept"
          accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.docx,.json,.yaml,.yml,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFileSelected(f)
            e.target.value = ''
          }}
          className="sr-only"
          tabIndex={-1}
        />
        <Label htmlFor="folder-upload-input" className="sr-only">
          Upload folder (will process text files only)
        </Label>
        <input
          id="folder-upload-input"
          type="file"
          ref={folderInputRef}
          aria-label="Upload folder (will process text files only)"
          // @ts-expect-error — webkitdirectory is non-standard but supported in Chrome/Safari/Firefox.
          webkitdirectory=""
          directory=""
          multiple
          onChange={(e) => {
            const files = e.target.files
            if (files && files.length > 0) void handleFolderSelected(files)
            e.target.value = ''
          }}
          className="sr-only"
          tabIndex={-1}
        />
      </div>

      {/* Folder progress indicator */}
      {folderProgress && (
        <div className="px-3 py-1.5 border-b border-amber-200/60 dark:border-amber-900/40 bg-amber-100/50 dark:bg-amber-950/30 shrink-0">
          <p className="text-[10px] text-amber-900 dark:text-amber-200 font-medium tabular-nums">
            Uploading {folderProgress.done} of {folderProgress.total} files from {folderProgress.rootName}/…
          </p>
          <div className="mt-1 h-1 rounded bg-amber-200/60 dark:bg-amber-900/40 overflow-hidden">
            <div
              className="h-full bg-amber-700 dark:bg-amber-400 transition-all duration-200"
              style={{ width: `${Math.min(100, (folderProgress.done / folderProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Intake forms */}
      {intake === 'paste' && (
        <div className="px-3 py-2 border-b border-amber-200/60 dark:border-amber-900/40 space-y-1.5 shrink-0">
          <Label htmlFor="concept-paste-title" className="sr-only">Title</Label>
          <input id="concept-paste-title" type="text" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="Title" aria-label="Concept title"
            className="w-full text-[11px] px-2 py-1 rounded border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
          <Label htmlFor="concept-paste-content" className="sr-only">Concept content</Label>
          <textarea id="concept-paste-content" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste a concept…" rows={4} aria-label="Concept content"
            className="w-full text-[11px] px-2 py-1 rounded border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-950 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
          <Label htmlFor="concept-paste-theme" className="sr-only">Theme</Label>
          <input id="concept-paste-theme" type="text" value={pasteTheme} onChange={(e) => setPasteTheme(e.target.value)} placeholder="Theme (auth, ui polish, …)" aria-label="Concept theme"
            className="w-full text-[11px] px-2 py-1 rounded border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setIntake(null)} className="text-[11px] h-7">Cancel</Button>
            <Button size="sm" onClick={handlePasteSubmit} disabled={busy} className="text-[11px] h-7 bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200">Save</Button>
          </div>
        </div>
      )}

      {intake === 'voice' && (
        <div className="px-3 py-2 border-b border-amber-200/60 dark:border-amber-900/40 space-y-1.5 shrink-0">
          <Label htmlFor="concept-voice-title" className="sr-only">Voice memo title</Label>
          <input id="concept-voice-title" type="text" value={voiceTitle} onChange={(e) => setVoiceTitle(e.target.value)} placeholder="Voice memo title" aria-label="Voice memo title"
            className="w-full text-[11px] px-2 py-1 rounded border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
          <Label htmlFor="concept-voice-transcript" className="sr-only">Voice transcript</Label>
          <textarea id="concept-voice-transcript" value={voiceTranscript} onChange={(e) => setVoiceTranscript(e.target.value)} placeholder="Transcript (recording → transcribed text)" rows={3} aria-label="Voice transcript"
            className="w-full text-[11px] px-2 py-1 rounded border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-950 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
          <div className="flex justify-between items-center gap-1">
            <Button size="sm" variant={recording ? 'destructive' : 'outline'} onClick={() => setRecording((r) => !r)} className="text-[11px] h-7" aria-pressed={recording}>
              <Mic className="size-3" /> {recording ? 'Stop' : 'Record'}
            </Button>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setIntake(null)} className="text-[11px] h-7">Cancel</Button>
              <Button size="sm" onClick={handleVoiceSubmit} disabled={busy} className="text-[11px] h-7 bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200">Save</Button>
            </div>
          </div>
        </div>
      )}

      {intake === 'past-chat' && (
        <div className="px-3 py-2 border-b border-amber-200/60 dark:border-amber-900/40 space-y-1.5 shrink-0">
          <Label htmlFor="concept-past-chat-query" className="sr-only">Past chat search</Label>
          <input id="concept-past-chat-query" type="text" value={chatQuery} onChange={(e) => setChatQuery(e.target.value)} placeholder="Find concept from past Cowork or Atlas chat" aria-label="Past chat search query"
            className="w-full text-[11px] px-2 py-1 rounded border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setIntake(null)} className="text-[11px] h-7">Cancel</Button>
            <Button size="sm" onClick={handlePastChatSubmit} disabled={busy} className="text-[11px] h-7 bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200">Link</Button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="px-3 py-2 border-b border-amber-200/60 dark:border-amber-900/40 shrink-0">
        <Label htmlFor="concept-filter" className="sr-only">Filter concepts</Label>
        <input id="concept-filter" type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter concepts…" aria-label="Filter concepts"
          className="w-full text-[11px] px-2 py-1 rounded border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
      </div>

      {/* Cards list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1.5" ref={menuRootRef}>
        {error && (
          <div role="alert" className="text-[11px] text-red-700 dark:text-red-400 px-2 py-1.5 rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30">
            {error}
          </div>
        )}
        {loading && filtered.length === 0 && (
          <div className="space-y-2 py-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-amber-100/60 dark:bg-amber-950/30 rounded animate-pulse" />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="text-[11px] text-amber-800/70 dark:text-amber-300/70 italic px-2 py-3">
            No concepts yet. Paste, upload a file or folder, dictate, or link a chat.
          </p>
        )}

        {/* Folder parents (collapsible) */}
        {Array.from(grouped.folderParents.values()).map((parent) => {
          const children = grouped.childrenByFolder.get(parent.title) ?? []
          const isExpanded = expandedFolders.has(parent.title)
          return (
            <div key={parent.id} data-testid="folder-group" className="rounded-md border border-amber-200 dark:border-amber-900 bg-white/60 dark:bg-amber-950/30 overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setExpandedFolders((prev) => {
                    const next = new Set(prev)
                    if (next.has(parent.title)) next.delete(parent.title); else next.add(parent.title)
                    return next
                  })
                }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-amber-50 dark:hover:bg-amber-950/40 active:bg-amber-100 dark:active:bg-amber-900/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} folder ${parent.title}`}
              >
                {isExpanded ? <ChevronDown className="size-3 text-amber-700 dark:text-amber-300 shrink-0" aria-hidden /> : <ChevronRight className="size-3 text-amber-700 dark:text-amber-300 shrink-0" aria-hidden />}
                <TypeBadge kind="folder" />
                <span className="text-[11px] font-semibold text-amber-900 dark:text-amber-200 truncate flex-1">{parent.title}</span>
                <span className="text-[10px] text-amber-700/70 dark:text-amber-300/70 tabular-nums">{children.length}</span>
                <ConceptRowMenu
                  concept={parent}
                  open={openMenuId === parent.id}
                  onOpenChange={(open) => setOpenMenuId(open ? parent.id : null)}
                  onView={() => { setSelectedConcept(parent); setOpenMenuId(null) }}
                  onEdit={() => startEdit(parent)}
                  onDelete={() => requestDelete(parent)}
                  onUseInWorkshop={() => toggleWorkshopSel(parent.id)}
                  onLinkToPhase={() => openLinkPicker(parent)}
                  flaggedForWorkshop={workshopSel.has(parent.id)}
                />
              </button>
              {isExpanded && children.length > 0 && (
                <ul className="border-t border-amber-200/60 dark:border-amber-900/40 divide-y divide-amber-200/40 dark:divide-amber-900/30">
                  {children.map((c) => (
                    <li key={c.id}>
                      <ConceptRow
                        concept={c}
                        compact
                        flaggedForWorkshop={workshopSel.has(c.id)}
                        menuOpen={openMenuId === c.id}
                        editing={editingId === c.id}
                        editDraft={editDraft}
                        setEditDraft={setEditDraft}
                        onView={() => setSelectedConcept(c)}
                        onEdit={() => startEdit(c)}
                        onSaveEdit={() => void saveEdit()}
                        onCancelEdit={() => setEditingId(null)}
                        onDelete={() => requestDelete(c)}
                        onUseInWorkshop={() => toggleWorkshopSel(c.id)}
                        onLinkToPhase={() => openLinkPicker(c)}
                        onMenuOpenChange={(o) => setOpenMenuId(o ? c.id : null)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}

        {/* Loose rows (not part of any folder bundle) */}
        {grouped.loose.map((c) => (
          <ConceptRow
            key={c.id}
            concept={c}
            flaggedForWorkshop={workshopSel.has(c.id)}
            menuOpen={openMenuId === c.id}
            editing={editingId === c.id}
            editDraft={editDraft}
            setEditDraft={setEditDraft}
            onView={() => setSelectedConcept(c)}
            onEdit={() => startEdit(c)}
            onSaveEdit={() => void saveEdit()}
            onCancelEdit={() => setEditingId(null)}
            onDelete={() => requestDelete(c)}
            onUseInWorkshop={() => toggleWorkshopSel(c.id)}
            onLinkToPhase={() => openLinkPicker(c)}
            onMenuOpenChange={(o) => setOpenMenuId(o ? c.id : null)}
          />
        ))}
      </div>

      {/* Detail drawer */}
      {selectedConcept && (
        <div className="border-t border-amber-200/60 dark:border-amber-900/40 px-3 py-2 bg-white dark:bg-amber-950/40 shrink-0 max-h-[40%] overflow-y-auto">
          <div className="flex items-center justify-between gap-1 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <TypeBadge kind={classifyForBadge(selectedConcept)} />
              <h4 className="text-[11px] font-semibold text-amber-900 dark:text-amber-100 truncate">{selectedConcept.title}</h4>
            </div>
            <Button size="icon-xs" variant="ghost" aria-label="Close detail" onClick={() => setSelectedConcept(null)}>
              <X className="size-3" />
            </Button>
          </div>
          <p className="text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words mb-1.5 max-h-32 overflow-y-auto">
            {selectedConcept.content.slice(0, 1200)}
            {selectedConcept.content.length > 1200 && '…'}
          </p>
          <div className="flex gap-1">
            <Button
              size="sm"
              onClick={() => toggleWorkshopSel(selectedConcept.id)}
              className={cn(
                'text-[11px] h-7 flex-1 gap-1 transition-colors duration-200',
                workshopSel.has(selectedConcept.id)
                  ? 'bg-amber-700 hover:bg-amber-800 text-white'
                  : 'bg-amber-100 hover:bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 dark:text-amber-200',
              )}
            >
              {workshopSel.has(selectedConcept.id) ? <CheckCircle2 className="size-3" /> : <Wand2 className="size-3" />}
              {workshopSel.has(selectedConcept.id) ? 'Selected for Workshop' : 'Use in Workshop'}
            </Button>
            {onUseInPhase && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (onUseInPhase) onUseInPhase(selectedConcept)
                  window.dispatchEvent(new CustomEvent('atlas:concept-to-wizard', { detail: selectedConcept }))
                }}
                className="text-[11px] h-7"
              >
                <Wand2 className="size-3" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Link-to-phase picker (modal) */}
      {linkingConcept && (
        <LinkToPhasePicker
          concept={linkingConcept}
          nodes={planNodes}
          onPick={handleLinkToPhase}
          onCancel={() => setLinkingConcept(null)}
          busy={busy}
        />
      )}

      {/* Session 8C — Delete confirmation modal */}
      <DeleteConfirmDialog
        target={confirmingDelete}
        childCount={confirmingDelete?.source_type === 'folder'
          ? concepts.filter((c) => c.parent_folder === confirmingDelete.title).length
          : 0}
        onCancel={() => setConfirmingDelete(null)}
        onConfirm={() => void executeDelete()}
        busy={busy}
      />
    </aside>
  )
}

// ─── Delete confirm modal ────────────────────────────────────────────────

interface DeleteConfirmDialogProps {
  target: CockpitConcept | null
  childCount: number
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
}

function DeleteConfirmDialog({ target, childCount, onCancel, onConfirm, busy }: DeleteConfirmDialogProps) {
  const isFolder = target?.source_type === 'folder'
  const title = isFolder ? 'Delete folder?' : 'Delete concept?'
  const filename = target?.title ?? ''
  const body = isFolder
    ? `'${filename}' and all ${childCount} ${childCount === 1 ? 'file' : 'files'} inside will be permanently deleted. This cannot be undone.`
    : `'${filename}' will be permanently deleted. This cannot be undone.`
  const confirmLabel = isFolder
    ? `Delete folder and ${childCount} ${childCount === 1 ? 'file' : 'files'}`
    : 'Delete'

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400 shrink-0" aria-hidden />
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-600 dark:text-slate-300 leading-snug">
            {body}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            disabled={busy}
            className="bg-rose-600 hover:bg-rose-700 text-white border-rose-600"
          >
            <Trash2 className="size-3 mr-1.5" aria-hidden />
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── sub-components ──────────────────────────────────────────────────────

interface ConceptRowProps {
  concept: CockpitConcept
  compact?: boolean
  flaggedForWorkshop: boolean
  menuOpen: boolean
  editing: boolean
  editDraft: { title: string; theme: string; content: string }
  setEditDraft: (d: { title: string; theme: string; content: string }) => void
  onView: () => void
  onEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
  onUseInWorkshop: () => void
  onLinkToPhase: () => void
  onMenuOpenChange: (open: boolean) => void
}

function ConceptRow(props: ConceptRowProps) {
  const { concept, compact, flaggedForWorkshop, menuOpen, editing, editDraft, setEditDraft } = props
  const kind = classifyForBadge(concept)
  // Folder children display the relative path; trim leading folder/ for readability.
  const displayTitle = compact && concept.parent_folder
    ? concept.title.replace(new RegExp(`^${escapeRegex(concept.parent_folder)}/`), '')
    : concept.title

  if (editing) {
    const editIdPrefix = `concept-edit-${concept.id}`
    return (
      <div className="px-2 py-1.5 space-y-1 bg-amber-50/60 dark:bg-amber-950/40">
        <Label htmlFor={`${editIdPrefix}-title`} className="sr-only">Edit concept title</Label>
        <input
          id={`${editIdPrefix}-title`}
          type="text"
          value={editDraft.title}
          onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
          aria-label="Edit concept title"
          className="w-full text-[11px] px-2 py-1 rounded border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        />
        <Label htmlFor={`${editIdPrefix}-theme`} className="sr-only">Edit concept theme</Label>
        <input
          id={`${editIdPrefix}-theme`}
          type="text"
          value={editDraft.theme}
          onChange={(e) => setEditDraft({ ...editDraft, theme: e.target.value })}
          placeholder="Theme"
          aria-label="Edit concept theme"
          className="w-full text-[11px] px-2 py-1 rounded border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        />
        <Label htmlFor={`${editIdPrefix}-content`} className="sr-only">Edit concept content</Label>
        <textarea
          id={`${editIdPrefix}-content`}
          value={editDraft.content}
          onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })}
          rows={3}
          aria-label="Edit concept content"
          className="w-full text-[11px] px-2 py-1 rounded border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-950 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        />
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={props.onCancelEdit} className="text-[11px] h-6">Cancel</Button>
          <Button size="sm" onClick={props.onSaveEdit} className="text-[11px] h-6 bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200">Save</Button>
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="concept-row"
      className={cn(
        'group flex items-center gap-1.5 px-2 py-1.5 transition-colors duration-150',
        compact
          ? 'hover:bg-amber-50 dark:hover:bg-amber-950/40'
          : 'rounded-md border border-amber-200 dark:border-amber-900 bg-white/70 dark:bg-amber-950/30 hover:border-amber-400 dark:hover:border-amber-700',
        flaggedForWorkshop && !compact && 'ring-1 ring-amber-500/60',
      )}
    >
      <TypeBadge kind={kind} />
      <button
        type="button"
        onClick={props.onView}
        className="flex-1 min-w-0 text-left focus:outline-none"
        aria-label={`View concept ${displayTitle}`}
      >
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[11px] font-medium text-amber-900 dark:text-amber-100 truncate">
            {displayTitle}
          </span>
          {flaggedForWorkshop && (
            <CheckCircle2 className="size-3 text-amber-700 dark:text-amber-300 shrink-0" aria-label="Selected for Workshop" />
          )}
        </div>
        {concept.theme && !compact && (
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
            <Tag className="size-2.5" /> {concept.theme}
          </div>
        )}
      </button>
      <ConceptRowMenu
        concept={concept}
        open={menuOpen}
        onOpenChange={props.onMenuOpenChange}
        onView={props.onView}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onUseInWorkshop={props.onUseInWorkshop}
        onLinkToPhase={props.onLinkToPhase}
        flaggedForWorkshop={flaggedForWorkshop}
      />
    </div>
  )
}

interface ConceptRowMenuProps {
  concept: CockpitConcept
  open: boolean
  onOpenChange: (open: boolean) => void
  onView: () => void
  onEdit: () => void
  onDelete: () => void
  onUseInWorkshop: () => void
  onLinkToPhase: () => void
  flaggedForWorkshop: boolean
}

function ConceptRowMenu(props: ConceptRowMenuProps) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); props.onOpenChange(!props.open) }}
        className="rounded p-1 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 active:bg-amber-200 dark:active:bg-amber-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
        aria-label={`Actions for ${props.concept.title}`}
        aria-haspopup="menu"
        aria-expanded={props.open}
      >
        <MoreHorizontal className="size-3.5" aria-hidden />
      </button>
      {props.open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 z-30 rounded-md border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-950 shadow-lg overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem icon={<Eye className="size-3" />} onClick={() => { props.onView(); props.onOpenChange(false) }}>
            View
          </MenuItem>
          <MenuItem icon={<Pencil className="size-3" />} onClick={() => { props.onEdit(); props.onOpenChange(false) }}>
            Edit
          </MenuItem>
          <MenuItem
            icon={props.flaggedForWorkshop ? <CheckCircle2 className="size-3 text-amber-700" /> : <Wand2 className="size-3" />}
            onClick={() => { props.onUseInWorkshop(); props.onOpenChange(false) }}
            highlight={props.flaggedForWorkshop}
          >
            {props.flaggedForWorkshop ? 'Selected for Workshop' : 'Use in Workshop'}
          </MenuItem>
          <MenuItem icon={<Link2 className="size-3" />} onClick={() => { props.onLinkToPhase(); props.onOpenChange(false) }}>
            Link to phase…
          </MenuItem>
          <MenuItem icon={<Trash2 className="size-3 text-rose-600" />} onClick={() => { props.onDelete(); props.onOpenChange(false) }} danger>
            Delete
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, onClick, children, danger, highlight }: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  highlight?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 w-full px-2 py-1.5 text-[11px] text-left transition-colors duration-150 focus:outline-none',
        danger
          ? 'text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40'
          : highlight
            ? 'text-amber-900 bg-amber-50/60 hover:bg-amber-100 dark:text-amber-200 dark:bg-amber-950/40 dark:hover:bg-amber-900/40'
            : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900',
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

interface LinkToPhasePickerProps {
  concept: CockpitConcept
  nodes: PlanNode[]
  onPick: (planNodeId: string) => void
  onCancel: () => void
  busy: boolean
}

function LinkToPhasePicker({ concept, nodes, onPick, onCancel, busy }: LinkToPhasePickerProps) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return nodes.slice(0, 80)
    return nodes.filter((n) => n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)).slice(0, 80)
  }, [query, nodes])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Link ${concept.title} to a plan node`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="w-full max-w-md rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-950 shadow-xl overflow-hidden">
        <header className="px-3 py-2 border-b border-amber-200 dark:border-amber-900 bg-amber-100/60 dark:bg-amber-950/50 flex items-center gap-1.5">
          <Link2 className="size-3.5 text-amber-700 dark:text-amber-300" aria-hidden />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200 truncate flex-1">
            Link concept to plan node
          </h3>
          <Button size="icon-xs" variant="ghost" onClick={onCancel} aria-label="Cancel"><X className="size-3" /></Button>
        </header>
        <div className="px-3 py-2 border-b border-amber-200/60 dark:border-amber-900/40">
          <p className="text-[10px] text-slate-500 mb-1">
            Concept: <span className="font-medium text-slate-700 dark:text-slate-300">{concept.title}</span>
          </p>
          <Label htmlFor="link-phase-filter" className="sr-only">Filter plan nodes</Label>
          <input
            id="link-phase-filter"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter plan nodes by id or title…"
            aria-label="Filter plan nodes by id or title"
            className="w-full text-[11px] px-2 py-1 rounded border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            autoFocus
          />
        </div>
        <ul className="max-h-72 overflow-y-auto divide-y divide-amber-200/40 dark:divide-amber-900/30">
          {filtered.length === 0 && (
            <li className="text-[11px] text-slate-500 italic px-3 py-3">No plan nodes match.</li>
          )}
          {filtered.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onPick(n.id)}
                disabled={busy}
                className="w-full text-left px-3 py-1.5 text-[11px] text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-amber-950/40 focus:outline-none focus-visible:bg-amber-50 dark:focus-visible:bg-amber-950/40 transition-colors duration-150 disabled:opacity-50"
              >
                <code className="font-mono text-[9px] text-amber-700 dark:text-amber-400 mr-1.5">{n.id}</code>
                {n.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default ConceptsPanel
