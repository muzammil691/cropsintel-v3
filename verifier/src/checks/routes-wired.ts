import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Gap, TaskSpec } from '../types'

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
}

function extractRouteContext(content: string, route: string): string {
  const idx =
    content.indexOf(`"${route}"`) !== -1
      ? content.indexOf(`"${route}"`)
      : content.indexOf(`'${route}'`)
  if (idx === -1) return ''
  return content.slice(Math.max(0, idx - 50), idx + 200)
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
      // Route exists — check if it points to a real component or a stub
      const context = extractRouteContext(content, route)
      if (context.includes('NotImplemented')) {
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
