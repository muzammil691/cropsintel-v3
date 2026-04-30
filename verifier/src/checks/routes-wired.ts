import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Gap, TaskSpec } from '../types'

// Backend API prefixes — paths starting with these are server routes, not React Router routes.
// Even if they appear in routesRequired (shouldn't happen with the spec-parser fix), skip them here.
const BACKEND_ROUTE_PREFIXES = ['/api/', '/atlas/mode', '/atlas/api', '/webhooks/']

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
}

function isBackendRoute(route: string, specMarkdown: string): boolean {
  // If route matches a known API prefix, it's a backend route
  if (BACKEND_ROUTE_PREFIXES.some(p => route.startsWith(p))) return true
  // If route appears alongside server.ts in spec, treat as backend
  if (specMarkdown.includes('server.ts') && route.includes('/mode')) return true
  return false
}

function extractRouteContext(content: string, route: string): string {
  const idx =
    content.indexOf(`"${route}"`) !== -1
      ? content.indexOf(`"${route}"`)
      : content.indexOf(`'${route}'`)
  if (idx === -1) return ''
  return content.slice(Math.max(0, idx - 50), idx + 200)
}

// Returns true if the spec explicitly asked to implement this route (replace NotImplemented).
// After the spec-parser fix, routesRequired only contains <Route path="..."> references,
// so this is always true for routes that made it into routesRequired.
// This function adds an extra guard for edge cases.
function specIntendedToImplementRoute(route: string, specMarkdown: string): boolean {
  const lower = specMarkdown.toLowerCase()
  const routeLower = route.toLowerCase()
  // The route appears in a <Route path="..."> pattern — spec intended it to be implemented
  if (new RegExp(`<route[^>]*path=["']${routeLower}["']`, 'i').test(specMarkdown)) return true
  // Spec explicitly mentions implementing/replacing this route
  if (lower.includes('notimplemented') && lower.includes(routeLower)) return true
  return false
}

export function checkRoutesWired(spec: TaskSpec): Gap[] {
  const gaps: Gap[] = []
  if (spec.routesRequired.length === 0) return gaps

  const root = getRepoRoot()
  const appPath = join(root, 'src', 'App.tsx')

  if (!existsSync(appPath)) {
    return [
      {
        check: 'routes-wired',
        severity: 'fail',
        expected: 'src/App.tsx exists',
        actual: 'src/App.tsx not found',
        remediation: 'Create src/App.tsx with route definitions',
      },
    ]
  }

  const content = readFileSync(appPath, 'utf-8')

  for (const route of spec.routesRequired) {
    // Skip backend API routes — they don't belong in App.tsx
    if (isBackendRoute(route, spec.rawMarkdown)) continue

    const hasRoute =
      content.includes(`"${route}"`) || content.includes(`'${route}'`)

    if (!hasRoute) {
      gaps.push({
        check: 'routes-wired',
        severity: 'fail',
        expected: `Route '${route}' defined in src/App.tsx`,
        actual: `Route '${route}' not found in src/App.tsx`,
        remediation: `Add <Route path="${route}" element={...} /> to src/App.tsx`,
      })
    } else {
      // Route exists — only flag NotImplemented if this spec was supposed to implement it
      const context = extractRouteContext(content, route)
      if (
        context.includes('NotImplemented') &&
        specIntendedToImplementRoute(route, spec.rawMarkdown)
      ) {
        gaps.push({
          check: 'routes-wired',
          severity: 'fail',
          expected: `Route '${route}' points to a real implemented component`,
          actual: `Route '${route}' points to <NotImplemented> (stub)`,
          remediation: `Replace <NotImplemented> with the real page component for route '${route}'`,
        })
      }
    }
  }

  return gaps
}
