// Phase 1.10al — IdeaFileDrawer
//
// Read-only drawer that renders `.agent/idea.md` (canonical product vision).
// Lets the operator skim the vision without leaving the cockpit. Editing still
// happens in VS Code in v1.2 — write-from-cockpit is intentionally out of scope.
//
// Hits GET /atlas/repo/idea via fetchIdeaFile(); on failure shows a helpful
// empty state pointing at the file path. Markdown rendering uses a small inline
// converter (mirrors MasterPlanView.tsx) — adding react-markdown for one drawer
// would be unjustified weight.

import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fetchIdeaFile, type IdeaFileResponse } from '@/lib/atlas-client'

interface IdeaFileDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function IdeaFileDrawer({ open, onOpenChange }: IdeaFileDrawerProps) {
  const [data, setData] = useState<IdeaFileResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    let cancelled = false
    fetchIdeaFile()
      .then((res) => {
        if (cancelled) return
        if (!res) {
          setError('Could not load idea file. Make sure `.agent/idea.md` exists.')
          setData(null)
        } else {
          setData(res)
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const html = useMemo(() => (data ? renderIdeaMarkdown(data.content) : ''), [data])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        data-testid="idea-file-drawer"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="size-4 text-emerald-600" />
            Product vision
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Canonical vision Atlas reads on every wizard run. Edit{' '}
            <code className="px-1 rounded bg-slate-100 dark:bg-slate-800 text-[10px]">.agent/idea.md</code>{' '}
            in VS Code — cockpit is read-only in v1.2.
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex-1 min-h-0 overflow-y-auto pr-1 text-sm leading-relaxed"
          data-testid="idea-file-content"
        >
          {loading && (
            <div className="flex items-center gap-2 text-slate-500 py-8 justify-center">
              <Loader2 className="size-4 animate-spin" />
              <span>Loading vision…</span>
            </div>
          )}
          {!loading && error && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-amber-800 dark:text-amber-200 text-xs">
              {error}
            </div>
          )}
          {!loading && !error && data && (
            <article
              className="idea-file-body prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>

        {data && (
          <div className="text-[10px] text-slate-400 border-t border-slate-200 dark:border-slate-800 pt-2">
            Source: {data.source}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Minimal markdown → HTML (mirrors MasterPlanView.tsx) ──────────────────
// Handles h1-h6, paragraphs, ul/ol, code fences, inline code, **bold**, *em*,
// links. Idea file is small (a few KB) so this is plenty.
export function renderIdeaMarkdown(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inCode = false
  let inList = false
  let listType: 'ul' | 'ol' | null = null
  let para: string[] = []

  const flushPara = () => {
    if (para.length === 0) return
    out.push(`<p>${inline(para.join(' '))}</p>`)
    para = []
  }
  const closeList = () => {
    if (inList && listType) {
      out.push(`</${listType}>`)
      inList = false
      listType = null
    }
  }

  for (const raw of lines) {
    const line = raw
    if (line.startsWith('```')) {
      flushPara()
      closeList()
      if (!inCode) {
        out.push('<pre><code>')
        inCode = true
      } else {
        out.push('</code></pre>')
        inCode = false
      }
      continue
    }
    if (inCode) {
      out.push(escapeHtml(line))
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      closeList()
      const level = h[1].length
      const text = h[2].trim()
      out.push(`<h${level}>${inline(text)}</h${level}>`)
      continue
    }
    if (/^\s*$/.test(line)) {
      flushPara()
      closeList()
      continue
    }
    if (line.startsWith('> ')) {
      flushPara()
      closeList()
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`)
      continue
    }
    const ul = /^[-*]\s+(.*)$/.exec(line)
    if (ul) {
      flushPara()
      if (!inList || listType !== 'ul') {
        closeList()
        out.push('<ul>')
        inList = true
        listType = 'ul'
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line)
    if (ol) {
      flushPara()
      if (!inList || listType !== 'ol') {
        closeList()
        out.push('<ol>')
        inList = true
        listType = 'ol'
      }
      out.push(`<li>${inline(ol[1])}</li>`)
      continue
    }
    closeList()
    para.push(line)
  }
  flushPara()
  closeList()
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}

function inline(t: string): string {
  let s = escapeHtml(t)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) =>
    `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  )
  return s
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
