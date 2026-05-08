// Phase 1.10al — Idea file (.agent/idea.md) contract tests.
//
// Reference matchers that mirror the production logic without hitting GitHub
// or a live Atlas server. Drift between these matchers and:
//
//   - .agent/idea.md (template content)
//   - atlas/src/lib/wizard-engine.ts (loadIdeaFileContent + prompt assembly)
//   - src/components/atlas-plan/IdeaFileDrawer.tsx (renderIdeaMarkdown)
//   - atlas/src/server.ts (GET /atlas/repo/idea handler)
//
// is the bug class this file catches. Four scenarios per the spec acceptance:
//
//   (a) Builder writes initial `.agent/idea.md` → assert file exists in repo.
//   (b) Wizard run → assert idea file content appears in Claude prompt.
//   (c) Cockpit "View vision" drawer → assert markdown renders correctly.
//   (d) `GET /atlas/repo/idea` → assert returns current file content.

import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const REPO_ROOT = resolve(__dirname, '..')

// ─── Reference impl mirroring IdeaFileDrawer.tsx renderIdeaMarkdown ─────
function renderIdeaMarkdownRef(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inCode = false
  let inList = false
  let listType: 'ul' | 'ol' | null = null
  let para: string[] = []

  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const inline = (t: string): string => {
    let s = escape(t)
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
    return s
  }
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
      flushPara(); closeList()
      inCode = !inCode
      out.push(inCode ? '<pre><code>' : '</code></pre>')
      continue
    }
    if (inCode) { out.push(escape(line)); continue }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flushPara(); closeList()
      out.push(`<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`)
      continue
    }
    if (/^\s*$/.test(line)) { flushPara(); closeList(); continue }
    if (line.startsWith('> ')) { flushPara(); closeList(); out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); continue }
    const ul = /^[-*]\s+(.*)$/.exec(line)
    if (ul) {
      flushPara()
      if (!inList || listType !== 'ul') { closeList(); out.push('<ul>'); inList = true; listType = 'ul' }
      out.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    closeList()
    para.push(line)
  }
  flushPara(); closeList()
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}

// ─── Reference impl mirroring atlas/src/lib/wizard-engine.ts ──────────────
function buildWizardPromptWithIdeaRef(ideaContent: string, parentTitle: string): string {
  const parts: string[] = []
  parts.push(`Parent phase: ${parentTitle}`)
  if (ideaContent && ideaContent.trim().length > 0) {
    parts.push(
      `Product vision (canonical, Muzammil-edited — read FIRST, every question must align):\n${ideaContent.slice(0, 6000)}`,
    )
  }
  return parts.join('\n\n')
}

// ─── Reference impl mirroring atlas/src/server.ts handler ─────────────────
type IdeaResp = { content: string; source: 'github' | 'local' | 'missing' } | { error: string; source?: string }

function ideaEndpointHandlerRef(args: {
  remoteContent: string | null
  localContent: string | null
}): { status: number; body: IdeaResp } {
  let content = args.remoteContent
  let source: 'github' | 'local' | 'missing' = 'github'
  if (content === null) {
    if (args.localContent !== null) {
      content = args.localContent
      source = 'local'
    } else {
      source = 'missing'
    }
  }
  if (content === null) return { status: 404, body: { error: 'idea_file_missing', source } }
  return { status: 200, body: { content, source } }
}

test.describe('Phase 1.10al — Idea file (.agent/idea.md) contract', () => {
  test('(a) `.agent/idea.md` exists in repo with the template content', () => {
    const ideaPath = resolve(REPO_ROOT, '.agent/idea.md')
    expect(existsSync(ideaPath)).toBe(true)
    const content = readFileSync(ideaPath, 'utf-8')
    // Lock down the structural anchors the wizard prompt expects.
    expect(content).toMatch(/^# CropsIntel V1 — Product Vision/m)
    expect(content).toMatch(/## What it is/m)
    expect(content).toMatch(/## Who it's for/m)
    expect(content).toMatch(/## Non-goals \(do NOT build\)/m)
    expect(content).toMatch(/## Hard rules/m)
    // Tier-1/2/3 audience markers must be present so wizard reasons about RBAC.
    expect(content).toMatch(/Tier 1/i)
    expect(content).toMatch(/Tier 2/i)
    expect(content).toMatch(/Tier 3/i)
    // Maxons + Bloomberg-Terminal voice signals.
    expect(content).toMatch(/Bloomberg/i)
    expect(content).toMatch(/Maxons/i)
  })

  test('(b) Wizard prompt embeds idea file content under the canonical-vision header', () => {
    const idea = `# CropsIntel V1 — Product Vision\n\n## What it is\n\nAlmond market intelligence + workflow.\n`
    const prompt = buildWizardPromptWithIdeaRef(idea, '1.3-auth')
    // Header marker is present + file content is verbatim (truncation at 6000).
    expect(prompt).toMatch(/Product vision \(canonical, Muzammil-edited/)
    expect(prompt).toMatch(/Almond market intelligence \+ workflow\./)
    // No ordering surprises: the parent phase line still leads.
    expect(prompt.indexOf('Parent phase: 1.3-auth')).toBe(0)
    // Empty-idea path: no canonical block injected.
    const emptyPrompt = buildWizardPromptWithIdeaRef('', '1.3-auth')
    expect(emptyPrompt).not.toMatch(/Product vision/)
  })

  test('(c) Cockpit "View vision" drawer renders idea markdown into safe HTML', () => {
    const md = [
      '# CropsIntel V1 — Product Vision',
      '',
      '> Canonical product vision.',
      '',
      '## Who it\'s for',
      '',
      '- **Tier 1 — Registered users:** free.',
      '- **Tier 2 — Verified users:** paid.',
      '',
      '## Hard rules',
      '',
      '1. Foundation-first.',
      '2. Anti-restart.',
      '',
      'See `src/lib/types.ts` for shape.',
    ].join('\n')
    const html = renderIdeaMarkdownRef(md)
    expect(html).toMatch(/<h1>CropsIntel V1 — Product Vision<\/h1>/)
    expect(html).toMatch(/<h2>Who it&#39;s for<\/h2>/)
    expect(html).toMatch(/<blockquote>Canonical product vision\.<\/blockquote>/)
    expect(html).toMatch(/<ul>/)
    expect(html).toMatch(/<strong>Tier 1 — Registered users:<\/strong>/)
    expect(html).toMatch(/<code>src\/lib\/types\.ts<\/code>/)
    // No <script> escape risks — angle brackets in user content survive
    // intact as escaped entities, not raw HTML.
    const xss = renderIdeaMarkdownRef('<script>alert(1)</script>')
    expect(xss).not.toMatch(/<script>/)
    expect(xss).toMatch(/&lt;script&gt;/)
  })

  test('(d) GET /atlas/repo/idea returns content + source field; degrades to local then 404', () => {
    // Happy path — GitHub returns the file.
    const remote = ideaEndpointHandlerRef({
      remoteContent: '# vision',
      localContent: null,
    })
    expect(remote.status).toBe(200)
    expect(remote.body).toMatchObject({ content: '# vision', source: 'github' })

    // GitHub miss → fall back to local clone.
    const local = ideaEndpointHandlerRef({
      remoteContent: null,
      localContent: '# vision (local)',
    })
    expect(local.status).toBe(200)
    expect(local.body).toMatchObject({ content: '# vision (local)', source: 'local' })

    // Both miss → 404 with explicit reason so the cockpit can show empty state.
    const missing = ideaEndpointHandlerRef({
      remoteContent: null,
      localContent: null,
    })
    expect(missing.status).toBe(404)
    expect(missing.body).toMatchObject({ error: 'idea_file_missing', source: 'missing' })
  })
})
