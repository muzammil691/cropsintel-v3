// Lightweight YAML frontmatter parser/writer for spec files in .agent/tasks/.
// Handles the minimal shape Builder + Atlas need: scalars (string/number/bool)
// and simple list-of-strings values. Not a general-purpose YAML implementation.

export interface SpecFrontmatter {
  priority?: number
  dependsOn?: string[]
  blocks?: string[]
  model?: string
  /**
   * Phase 4 of agent-loop redesign: domain tag set by Atlas when the spec is
   * drafted. Reserved values: 'frontend' | 'analytical' | 'research' | 'mixed'.
   * Today Builder logs the value but still routes to Claude Code (mixed-domain
   * specs always do; single-domain specs follow in Phase 4b when an OpenAI
   * Codex sibling Builder exists).
   */
  primaryDomain?: 'frontend' | 'analytical' | 'research' | 'mixed'
  /**
   * Pillar B (Queue tab Xbox-style) — when true, agent-loop's pick_next_task
   * skips this spec entirely. Distinct from cancel: paused stays in queued/
   * and can be resumed; cancel moves the spec to cancelled/.
   */
  paused?: boolean
  // Pass-through for any other scalar fields we don't model explicitly.
  extra?: Record<string, string>
}

export interface ParsedSpec {
  frontmatter: SpecFrontmatter
  rawFrontmatter: string | null
  body: string
}

const FENCE = '---'

export function parseSpec(content: string): ParsedSpec {
  // A spec MAY start with a `---` fence, frontmatter lines, then `---`.
  // If absent, the whole file is body.
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== FENCE) {
    return { frontmatter: {}, rawFrontmatter: null, body: content }
  }
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      endIdx = i
      break
    }
  }
  if (endIdx < 0) {
    return { frontmatter: {}, rawFrontmatter: null, body: content }
  }
  const fmLines = lines.slice(1, endIdx)
  const bodyLines = lines.slice(endIdx + 1)
  const fm = parseFrontmatterLines(fmLines)
  return {
    frontmatter: fm,
    rawFrontmatter: fmLines.join('\n'),
    body: bodyLines.join('\n'),
  }
}

function parseFrontmatterLines(lines: string[]): SpecFrontmatter {
  const fm: SpecFrontmatter = {}
  let currentListKey: 'dependsOn' | 'blocks' | null = null
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (line.length === 0) {
      currentListKey = null
      continue
    }
    // List item under the most recent list key
    const listMatch = /^[-*]\s+(.+)$/.exec(line.trimStart())
    if (listMatch && currentListKey) {
      const value = stripQuotes(listMatch[1].trim())
      if (value) {
        const arr = fm[currentListKey] ?? []
        arr.push(value)
        fm[currentListKey] = arr
      }
      continue
    }
    // key: value
    const kvMatch = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line)
    if (!kvMatch) {
      currentListKey = null
      continue
    }
    const key = kvMatch[1]
    const valueRaw = kvMatch[2].trim()
    if (valueRaw === '') {
      // Could be the start of a list (e.g. `depends-on:`)
      if (key === 'depends-on' || key === 'dependsOn') {
        currentListKey = 'dependsOn'
        fm.dependsOn = fm.dependsOn ?? []
      } else if (key === 'blocks') {
        currentListKey = 'blocks'
        fm.blocks = fm.blocks ?? []
      } else {
        currentListKey = null
      }
      continue
    }
    currentListKey = null
    const stripped = stripQuotes(valueRaw)
    if (key === 'priority') {
      const n = parseInt(stripped, 10)
      if (!isNaN(n)) fm.priority = n
    } else if (key === 'depends-on' || key === 'dependsOn') {
      fm.dependsOn = parseInlineList(stripped)
    } else if (key === 'blocks') {
      fm.blocks = parseInlineList(stripped)
    } else if (key === 'model') {
      fm.model = stripped
    } else if (key === 'primary-domain' || key === 'primaryDomain') {
      if (stripped === 'frontend' || stripped === 'analytical' ||
          stripped === 'research' || stripped === 'mixed') {
        fm.primaryDomain = stripped
      }
    } else if (key === 'paused') {
      fm.paused = stripped === 'true' || stripped === 'yes' || stripped === '1'
    } else {
      fm.extra = fm.extra ?? {}
      fm.extra[key] = stripped
    }
  }
  return fm
}

function parseInlineList(value: string): string[] {
  // Inline form: [a, b, c]
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1)
    return inner.split(',').map(s => stripQuotes(s.trim())).filter(Boolean)
  }
  // Single-value form: depends-on: foo
  return [stripQuotes(value)].filter(Boolean)
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

export function serializeFrontmatter(fm: SpecFrontmatter): string {
  const lines: string[] = []
  if (fm.priority !== undefined) {
    lines.push(`priority: ${fm.priority}`)
  }
  if (fm.dependsOn !== undefined) {
    if (fm.dependsOn.length === 0) {
      lines.push('depends-on: []')
    } else {
      lines.push('depends-on:')
      for (const id of fm.dependsOn) lines.push(`  - ${id}`)
    }
  }
  if (fm.blocks !== undefined) {
    if (fm.blocks.length === 0) {
      lines.push('blocks: []')
    } else {
      lines.push('blocks:')
      for (const id of fm.blocks) lines.push(`  - ${id}`)
    }
  }
  if (fm.model !== undefined) {
    lines.push(`model: ${fm.model}`)
  }
  if (fm.primaryDomain !== undefined) {
    lines.push(`primary-domain: ${fm.primaryDomain}`)
  }
  if (fm.paused === true) {
    // Only serialize when truthy; absence is the implicit "not paused" default.
    lines.push('paused: true')
  }
  if (fm.extra) {
    for (const [k, v] of Object.entries(fm.extra)) {
      lines.push(`${k}: ${v}`)
    }
  }
  return lines.join('\n')
}

export function setFrontmatterField<K extends keyof SpecFrontmatter>(
  content: string,
  field: K,
  value: SpecFrontmatter[K],
): string {
  const parsed = parseSpec(content)
  const next: SpecFrontmatter = { ...parsed.frontmatter, [field]: value }
  const serialized = serializeFrontmatter(next)
  // Preserve a leading blank line between frontmatter and body if the original had body content.
  const body = parsed.body.startsWith('\n') ? parsed.body : `\n${parsed.body}`
  return `${FENCE}\n${serialized}\n${FENCE}${body}`
}
