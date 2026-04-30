import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getRepoRoot } from './env'
import { DesignSystem } from '../types'

const FALLBACK_DESIGN_SYSTEM = `# CropsIntel V3 Design System (fallback)

Tokens: emerald-600/700 primary, slate neutrals, semantic green/amber/red/blue.
Components: shadcn/ui Card, Button, Input, Badge, Skeleton — never raw clickable divs.
States: hover, focus-visible, disabled, active required on all interactives.
Accessibility: alt on images, aria-label or text on buttons, label on inputs.
Mobile-first: Tailwind responsive prefixes (sm: md: lg:), min-h-[44px] touch targets.
`

/**
 * Load the design system reference. Tries Memory service first (if configured),
 * then falls back to the local repo file at .agent/design-system.md.
 */
export async function loadDesignSystem(): Promise<DesignSystem> {
  // 1. Try Memory service if configured
  const memoryUrl = process.env.MEMORY_URL
  const memoryToken = process.env.MEMORY_API_TOKEN

  if (memoryUrl && memoryToken) {
    try {
      const result = await queryMemory(memoryUrl, memoryToken, 'design system tokens components accessibility')
      if (result && result.length > 200) {
        return { rawMarkdown: result }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[designer] Memory query failed, falling back to local file:', msg)
    }
  }

  // 2. Fall back to repo file
  const localPath = join(getRepoRoot(), '.agent', 'design-system.md')
  if (existsSync(localPath)) {
    try {
      return { rawMarkdown: readFileSync(localPath, 'utf-8') }
    } catch (err) {
      console.warn('[designer] Could not read local design system file:', err)
    }
  }

  // 3. Last-resort fallback (compact inline)
  return { rawMarkdown: FALLBACK_DESIGN_SYSTEM }
}

async function queryMemory(url: string, token: string, query: string): Promise<string | null> {
  const endpoint = url.replace(/\/$/, '') + '/search'
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, limit: 5 }),
  })
  if (!resp.ok) return null
  const data = (await resp.json()) as { results?: Array<{ content?: string }> }
  if (!data.results || data.results.length === 0) return null
  return data.results.map(r => r.content ?? '').join('\n\n')
}
