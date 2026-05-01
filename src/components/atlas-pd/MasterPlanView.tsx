// Phase 1.10ac — MasterPlanView
//
// Read-only viewer of the master plan markdown. We fetch the file from the
// dev/build root via /master-plan.md (Vite serves the public/ folder, and the
// build step copies the .agent/master-plan.md into public/ at build time).
// Falls back to a friendly error if the file isn't reachable.
//
// Anchor IDs are auto-derived from heading text so phase rows are deep-linkable
// (#phase-1-10w etc.). Current phase is read from atlas_snapshots.current_phase
// and highlighted at the top of the pane.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertCircle, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface ParsedMd {
  html: string
  headings: { id: string; text: string; level: number }[]
}

export function MasterPlanView() {
  const [md, setMd] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPhase, setCurrentPhase] = useState<string | null>(null)

  // Fetch the master plan markdown. Try /master-plan.md (public/) first, then
  // fall back to /.agent/master-plan.md (Vite dev server serves it under /).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const candidates = ['/master-plan.md', '/.agent/master-plan.md']
      for (const url of candidates) {
        try {
          const res = await fetch(url, { cache: 'no-cache' })
          if (res.ok) {
            const text = await res.text()
            if (!cancelled) {
              setMd(text)
              setError(null)
              setLoading(false)
            }
            return
          }
        } catch {
          // try next candidate
        }
      }
      if (!cancelled) {
        setMd(null)
        setError('Master plan file not reachable. Ensure /master-plan.md is published in /public.')
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Read the current phase from atlas_snapshots (most-recent row).
  // atlas_snapshots is not in generated database.types — cast through unknown.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as unknown as any
      const { data } = await client
        .from('atlas_snapshots')
        .select('current_phase')
        .order('taken_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!cancelled && data?.current_phase) {
        setCurrentPhase(String(data.current_phase))
      }
    })()
    return () => { cancelled = true }
  }, [])

  const parsed = useMemo<ParsedMd | null>(() => {
    if (!md) return null
    return renderMarkdown(md, currentPhase)
  }, [md, currentPhase])

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <style>{`.pd-current-phase{background-color:rgba(16,185,129,0.08);padding:4px 8px;border-radius:4px;}`}</style>
      {currentPhase && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900">
          <MapPin className="size-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden />
          <span className="text-xs text-emerald-800 dark:text-emerald-300">
            Current phase: <strong>{currentPhase}</strong>
          </span>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-12 justify-center">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading master plan…
        </div>
      )}

      {error && !loading && (
        <div className="flex items-start gap-2 px-3 py-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-sm" role="alert">
          <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Cannot load master plan</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        </div>
      )}

      {parsed && (
        <article
          className="prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: parsed.html }}
        />
      )}
    </div>
  )
}

// Minimal markdown renderer — supports headings, paragraphs, lists, code
// blocks, inline code, bold/italic, links. No external dependency. Adequate
// for the plan format we control.
function renderMarkdown(md: string, currentPhase: string | null): ParsedMd {
  const lines = md.split('\n')
  const out: string[] = []
  const headings: ParsedMd['headings'] = []
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
      flushPara(); closeList()
      const level = h[1].length
      const text = h[2].trim()
      const id = slugify(text)
      const isCurrent = !!currentPhase && text.toLowerCase().includes(currentPhase.toLowerCase())
      headings.push({ id, text, level })
      const cls = isCurrent ? ' class="pd-current-phase"' : ''
      out.push(`<h${level} id="${id}"${cls}>${inline(text)}</h${level}>`)
      continue
    }

    if (/^\s*$/.test(line)) {
      flushPara(); closeList()
      continue
    }

    const ul = /^[-*]\s+(.*)$/.exec(line)
    if (ul) {
      flushPara()
      if (!inList || listType !== 'ul') {
        closeList(); out.push('<ul>'); inList = true; listType = 'ul'
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line)
    if (ol) {
      flushPara()
      if (!inList || listType !== 'ol') {
        closeList(); out.push('<ol>'); inList = true; listType = 'ol'
      }
      out.push(`<li>${inline(ol[1])}</li>`)
      continue
    }

    closeList()
    para.push(line)
  }
  flushPara(); closeList()
  if (inCode) out.push('</code></pre>')

  return { html: out.join('\n'), headings }
}

function inline(t: string): string {
  // Escape first; then run patterns on the escaped string.
  let s = escapeHtml(t)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) =>
    `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
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
function escapeAttr(s: string): string { return escapeHtml(s) }

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

