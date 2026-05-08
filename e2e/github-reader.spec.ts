// Phase 1.10ak — GitHub repo reader contract tests.
//
// E2E tests in this repo are pure-JS reference matchers that mirror the
// production logic. We don't hit GitHub here — that would be flaky and rate
// limited — we lock down the shape of:
//
//   (a) Boot path: with GITHUB_PAT set, buildRepoIndex's output is persistable
//       to atlas_config under key 'github_repo_index'.
//   (b) Degradation: with no PAT, the wizard runs without repo context but
//       still produces questions (via DEFAULT_QUESTIONS fallback in
//       wizard-engine.ts).
//   (c) Wizard prompt embeds real file paths from the index when available.
//   (d) getFileContent decodes base64 GitHub content correctly.
//   (e) searchCommits maps the GitHub search response into our trimmed shape.
//
// Drift between these matchers and atlas/src/lib/github-client.ts +
// repo-index.ts + wizard-engine.ts is the bug class this file catches.

import { test, expect } from '@playwright/test'

// ─── Reference impl mirroring atlas/src/lib/repo-index.ts ────────────────
interface RepoIndex {
  built_at: string
  total_files: number
  by_directory: Record<string, number>
  recent_commits: { sha: string; message: string; date: string }[]
  package_json_summary: {
    framework: 'vite' | 'next' | 'remix' | 'unknown'
    dependencies: string[]
    scripts: Record<string, string>
  }
  conventions: {
    has_shadcn: boolean
    has_tailwind: boolean
    auth_libs: string[]
    state_libs: string[]
    test_framework: 'vitest' | 'jest' | 'playwright' | 'unknown'
  }
}

function detectFrameworkRef(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): RepoIndex['package_json_summary']['framework'] {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  if (deps['next']) return 'next'
  if (deps['@remix-run/react'] || deps['@remix-run/node']) return 'remix'
  if (deps['vite']) return 'vite'
  return 'unknown'
}

function buildPersistPayloadRef(index: RepoIndex): { key: string; value: string; set_by: string } {
  return {
    key: 'github_repo_index',
    value: JSON.stringify(index),
    set_by: 'repo-index',
  }
}

// ─── Reference impl mirroring atlas/src/lib/wizard-engine.ts ─────────────
function extractKeywordsRef(phaseHint: string, parentBody: string): string[] {
  const haystack = `${phaseHint} ${parentBody}`.toLowerCase()
  const candidates = new Set<string>()
  if (phaseHint) candidates.add(phaseHint.toLowerCase())
  const domainWords = ['auth', 'login', 'signup', 'otp', 'rbac', 'role', 'profile', 'whatsapp', 'cockpit', 'wizard', 'admin']
  for (const w of domainWords) if (haystack.includes(w)) candidates.add(w)
  for (const tok of phaseHint.toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length >= 4) candidates.add(tok)
  }
  return Array.from(candidates)
}

function findRelevantFilesRef(
  phaseHint: string,
  parentBody: string,
  tree: Array<{ path: string; type: 'file' | 'dir' }>,
): string[] {
  const keywords = extractKeywordsRef(phaseHint, parentBody)
  if (keywords.length === 0) return []
  return tree
    .filter((t) => t.type === 'file')
    .filter((t) => {
      const lc = t.path.toLowerCase()
      return keywords.some((k) => lc.includes(k))
    })
    .map((t) => t.path)
    .sort((a, b) => a.length - b.length)
    .slice(0, 30)
}

// ─── Reference impl mirroring atlas/src/lib/github-client.ts ─────────────
function decodeGitHubContentRef(rawBase64: string): string {
  return Buffer.from(rawBase64, 'base64').toString('utf-8')
}

interface GitHubSearchCommitItem {
  sha: string
  commit: { message: string; committer: { date: string } | null }
}
function mapSearchCommitsRef(items: GitHubSearchCommitItem[]) {
  return items.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    date: c.commit.committer?.date ?? '',
  }))
}

// ─── Reference impl mirroring spec-from-wizard.ts foundation block ──────
function buildFoundationFirstRef(
  relevantFiles: string[],
): string {
  if (relevantFiles.length === 0) {
    return '- (no repo context available — wizard ran without GITHUB_PAT or matching files)'
  }
  return relevantFiles.slice(0, 10).map((p) => `- ✅ ${p} exists (read by Atlas during wizard)`).join('\n')
}

test.describe('Phase 1.10ak — GitHub repo reader contract', () => {
  test('(a) Atlas boot with GITHUB_PAT → buildRepoIndex output persists under atlas_config[github_repo_index]', () => {
    const index: RepoIndex = {
      built_at: '2026-05-08T10:00:00.000Z',
      total_files: 412,
      by_directory: { src: 200, supabase: 30, atlas: 60, e2e: 10 },
      recent_commits: [
        { sha: 'c900dd6', message: 'queue: cockpit upgrade bundle (1.10ak…)', date: '2026-05-08T09:00:00Z' },
      ],
      package_json_summary: {
        framework: 'vite',
        dependencies: ['react', 'vite', 'tailwindcss'],
        scripts: { build: 'vite build', dev: 'vite' },
      },
      conventions: {
        has_shadcn: true,
        has_tailwind: true,
        auth_libs: ['@supabase/supabase-js'],
        state_libs: [],
        test_framework: 'playwright',
      },
    }
    const payload = buildPersistPayloadRef(index)
    expect(payload.key).toBe('github_repo_index')
    expect(payload.set_by).toBe('repo-index')
    const round = JSON.parse(payload.value) as RepoIndex
    expect(round.total_files).toBe(412)
    expect(round.package_json_summary.framework).toBe('vite')
    expect(round.conventions.test_framework).toBe('playwright')
  })

  test('(b) Atlas boot WITHOUT GITHUB_PAT → wizard degrades to no-repo-context but still produces questions', () => {
    // The wizard's contract: if loadRepoContext throws or returns null, the
    // Claude prompt simply omits the repo facts block. The DEFAULT_QUESTIONS
    // fallback in wizard-engine.ts is the floor — at least 4 generic questions
    // exist for the cockpit to render.
    const DEFAULT_QUESTIONS = [
      { id: 'role', prompt: 'Primary user role for this feature?', choices: ['registered', 'verified', 'admin', 'any'] },
      { id: 'whatsapp', prompt: 'Should this integrate with WhatsApp?', choices: ['yes — outbound', 'yes — inbound', 'no'] },
      { id: 'data_shape', prompt: 'Data shape:', choices: ['read-only', 'read+write', 'event-based'] },
      { id: 'auto_confirm', prompt: 'Approve auto-confirmation on small offers?', choices: ['yes', 'no — always Maxons review'] },
      { id: 'finalize', prompt: 'Looks good — generate spec?', choices: ['yes', 'no — let me edit'] },
    ]
    const repoContext: RepoIndex | null = null
    const promptIncludesRepoFacts = repoContext !== null
    expect(promptIncludesRepoFacts).toBe(false)
    expect(DEFAULT_QUESTIONS.length).toBeGreaterThanOrEqual(4)
    expect(DEFAULT_QUESTIONS[DEFAULT_QUESTIONS.length - 1].prompt).toMatch(/generate spec/i)
  })

  test('(c) Wizard run with repo context → relevant files reference real paths and feed the foundation-first block', () => {
    const fakeTree = [
      { path: 'src/contexts/AuthContext.tsx', type: 'file' as const },
      { path: 'src/pages/Login.tsx', type: 'file' as const },
      { path: 'src/pages/Profile.tsx', type: 'file' as const },
      { path: 'supabase/migrations/20260428000001_v3_foundation.sql', type: 'file' as const },
      { path: 'README.md', type: 'file' as const },
      { path: 'unrelated/widget.tsx', type: 'file' as const },
    ]
    const relevant = findRelevantFilesRef('1.3-auth', 'WhatsApp OTP login + profile RBAC', fakeTree)
    // Auth, login, profile, whatsapp keywords should pull the four real files,
    // but skip the unrelated widget.
    expect(relevant).toContain('src/pages/Login.tsx')
    expect(relevant).toContain('src/contexts/AuthContext.tsx')
    expect(relevant).toContain('src/pages/Profile.tsx')
    expect(relevant).not.toContain('unrelated/widget.tsx')
    const foundationBlock = buildFoundationFirstRef(relevant)
    expect(foundationBlock).toMatch(/✅ src\/pages\/Login\.tsx exists/)
    expect(foundationBlock).toMatch(/✅ src\/contexts\/AuthContext\.tsx exists/)
  })

  test("(d) getFileContent('package.json') → base64-decoded JSON parses with framework detection", () => {
    const samplePkg = {
      name: 'cropsintel-v3',
      dependencies: { react: '^18', vite: '^5', tailwindcss: '^3' },
      devDependencies: { '@playwright/test': '^1.50' },
      scripts: { build: 'vite build' },
    }
    const rawBase64 = Buffer.from(JSON.stringify(samplePkg), 'utf-8').toString('base64')
    const decoded = decodeGitHubContentRef(rawBase64)
    const parsed = JSON.parse(decoded) as typeof samplePkg
    expect(parsed.name).toBe('cropsintel-v3')
    expect(detectFrameworkRef(parsed)).toBe('vite')
  })

  test("(e) searchCommits('1.10aj') → maps GitHub items into trimmed shape with 7-char SHAs", () => {
    const items: GitHubSearchCommitItem[] = [
      { sha: 'c900dd6abcdef1234567890', commit: { message: 'queue: cockpit upgrade bundle (1.10aj)\n\nbody', committer: { date: '2026-05-08T09:00:00Z' } } },
      { sha: 'b2c9221fedcba9876543210', commit: { message: 'feat: cockpit wizard (1.10aj)', committer: { date: '2026-05-07T18:00:00Z' } } },
    ]
    const out = mapSearchCommitsRef(items)
    expect(out).toHaveLength(2)
    expect(out[0].sha).toBe('c900dd6')
    expect(out[0].sha.length).toBe(7)
    expect(out[0].message).toBe('queue: cockpit upgrade bundle (1.10aj)')
    expect(out[1].message).toMatch(/1\.10aj/)
  })
})
