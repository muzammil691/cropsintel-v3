import { TaskSpec } from '../types'

const FILE_EXT_RE = /\.(ts|tsx|js|jsx|json|sql|md|sh|yaml|yml|html|css)$/

// Section headers that indicate files should be REMOVED, not created.
// Paths found in these sections are excluded from filesRequired.
const DELETE_SECTION_RE = /delete|remove|uninstall|clean\s*slate|clean-slate|clean_slate/i

function splitIntoSections(markdown: string): Array<{ header: string; body: string }> {
  const sections: Array<{ header: string; body: string }> = []
  const parts = markdown.split(/\n(?=##\s)/)
  for (const part of parts) {
    const lines = part.split('\n')
    sections.push({ header: lines[0] ?? '', body: lines.slice(1).join('\n') })
  }
  return sections
}

function extractFilePathsFromText(text: string): Set<string> {
  const paths = new Set<string>()
  let m: RegExpExecArray | null

  // Paths in backtick inline code: `src/pages/Auth.tsx`
  const backtickRe = /`([^`\s]+)`/g
  while ((m = backtickRe.exec(text)) !== null) {
    const c = m[1].trim()
    if (FILE_EXT_RE.test(c) && c.includes('/') && !c.includes(' ') && !c.includes('..')) {
      paths.add(c)
    }
  }

  // Paths in table cells: | src/pages/Auth.tsx |
  const tableCellRe = /\|\s*([a-zA-Z0-9._\-/]+\.[a-z]+)\s*[|]/g
  while ((m = tableCellRe.exec(text)) !== null) {
    const c = m[1].trim()
    if (FILE_EXT_RE.test(c) && c.includes('/')) paths.add(c)
  }

  // Bullet list paths: "- src/pages/Auth.tsx" or "- `src/pages/Auth.tsx`"
  const bulletRe = /^[\t ]*[-*]\s+`?((?:src|supabase|agent|verifier|adela)\/[a-zA-Z0-9._\-/]+\.[a-z]+)`?/gm
  while ((m = bulletRe.exec(text)) !== null) {
    paths.add(m[1].trim())
  }

  return paths
}

function extractFilePaths(text: string): string[] {
  const sections = splitIntoSections(text)
  const required = new Set<string>()
  const deleted = new Set<string>()

  for (const section of sections) {
    const isDeleteSection = DELETE_SECTION_RE.test(section.header)
    const paths = extractFilePathsFromText(section.body)
    for (const p of paths) {
      if (isDeleteSection) {
        deleted.add(p)
      } else {
        required.add(p)
      }
    }
  }

  // Remove any path that appeared in a delete section to avoid false positives
  for (const p of deleted) required.delete(p)

  return Array.from(required).filter(p => !p.startsWith('//') && p.split('/').length >= 2)
}

function extractTableNames(text: string): string[] {
  const tables = new Set<string>()
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    tables.add(m[1].toLowerCase())
  }
  return Array.from(tables)
}

function extractFunctionNames(text: string): string[] {
  const funcs = new Set<string>()
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    funcs.add(m[1].toLowerCase())
  }
  return Array.from(funcs)
}

function extractRoutes(text: string): string[] {
  const routes = new Set<string>()
  // Match URL route paths in backticks: `/dashboard`, `/auth`
  const re = /`(\/[a-zA-Z][a-zA-Z0-9\-/]*)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const c = m[1]
    // Exclude file paths (contain a dot) and SSH-style paths
    if (!c.includes('.') && !c.includes('//')) routes.add(c)
  }
  return Array.from(routes)
}

function extractAcceptanceCriteria(text: string): string[] {
  const criteria: string[] = []
  const sectionRe = /##\s+Acceptance criteria\b([\s\S]*?)(?=\n##|\n---|\n\*\*Done|$)/i
  const sectionMatch = sectionRe.exec(text)
  if (!sectionMatch) return criteria

  const section = sectionMatch[1]
  const itemRe = /^\s*\d+\.\s+(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(section)) !== null) {
    criteria.push(m[1].trim())
  }
  return criteria
}

function extractOutOfScope(text: string): string[] {
  const items: string[] = []
  const sectionRe = /##\s+Out of scope\b([\s\S]*?)(?=\n##|\n---|\n\*\*Done|$)/i
  const sectionMatch = sectionRe.exec(text)
  if (!sectionMatch) return items

  const section = sectionMatch[1]
  const itemRe = /^\s*[-*]\s+(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(section)) !== null) {
    items.push(m[1].trim())
  }
  return items
}

function extractComponents(text: string, filePaths: string[]): string[] {
  const components = new Set<string>()

  // From component/page file paths
  for (const p of filePaths) {
    const m = p.match(/(?:components|pages)\/(?:[^/]+\/)?([A-Z][a-zA-Z0-9]+)\.tsx$/)
    if (m) components.add(m[1])
  }

  // PascalCase names in backtick code (component references)
  const re = /`([A-Z][a-zA-Z0-9]+(?:\.tsx?)?)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const name = m[1].replace(/\.tsx?$/, '')
    if (name.length > 1 && /^[A-Z]/.test(name)) components.add(name)
  }

  return Array.from(components)
}

export function parseTaskSpec(markdown: string, taskId: string): TaskSpec {
  const filePaths = extractFilePaths(markdown)

  return {
    id: taskId,
    filesRequired: filePaths,
    componentsRequired: extractComponents(markdown, filePaths),
    migrationsRequired: {
      tablesCreated: extractTableNames(markdown),
      functionsCreated: extractFunctionNames(markdown),
    },
    routesRequired: extractRoutes(markdown),
    testsRequired: filePaths.filter(
      p => p.includes('.test.') || p.includes('.spec.') || p.includes('__tests__'),
    ),
    acceptanceCriteria: extractAcceptanceCriteria(markdown),
    outOfScope: extractOutOfScope(markdown),
    rawMarkdown: markdown,
  }
}
