import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Gap, TaskSpec } from '../types'

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
}

function extractRequiredPackages(markdown: string): string[] {
  const packages = new Set<string>()

  // Match: npm install <pkg> or npm i <pkg>
  const re = /npm\s+(?:install|i)\s+((?:(?:@[a-zA-Z0-9\-_]+\/)?[a-zA-Z0-9\-_.]+\s*)+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const tokens = m[1].trim().split(/\s+/)
    for (const tok of tokens) {
      // Skip flags like --save-dev, -D, etc.
      if (!tok.startsWith('-') && tok.length > 0) {
        packages.add(tok)
      }
    }
  }

  return Array.from(packages)
}

export function checkDepsInstalled(spec: TaskSpec): Gap[] {
  const gaps: Gap[] = []
  const required = extractRequiredPackages(spec.rawMarkdown)
  if (required.length === 0) return gaps

  const root = getRepoRoot()
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) return gaps

  let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  } catch {
    return gaps
  }

  const allDeps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  }

  for (const pkg of required) {
    if (!(pkg in allDeps)) {
      gaps.push({
        check: 'deps-installed',
        severity: 'fail',
        expected: `Package '${pkg}' in package.json`,
        actual: `'${pkg}' not found in dependencies or devDependencies`,
        remediation: `Run npm install ${pkg} and commit the updated package.json`,
      })
    }
  }

  return gaps
}
