// Phase 1.10ak — Repo summary cache.
//
// Atlas builds a compact index of the repo at boot and refreshes it every 30
// minutes. The index is what the wizard engine reads to ground its prompts in
// real repo state — frameworks, key dependencies, recent commits, file counts
// per directory.
//
// Persistence: cached in `atlas_config` under key `github_repo_index` so it
// survives Railway redeploys without having to re-fetch the entire tree on
// every cold start.

import { getFileContent, getFileTree, searchCommits } from './github-client'
import { getSupabaseClient } from './supabase'

export interface RepoIndex {
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

const CACHE_KEY = 'github_repo_index'
const REFRESH_INTERVAL_MS = 30 * 60 * 1000

let _inMemoryIndex: RepoIndex | null = null
let _refreshTimer: NodeJS.Timeout | null = null

const AUTH_LIB_KEYWORDS = [
  '@supabase/supabase-js',
  '@supabase/auth-helpers',
  '@clerk',
  'next-auth',
  'firebase',
  'auth0',
  'lucia',
  'passport',
]

const STATE_LIB_KEYWORDS = ['zustand', 'jotai', 'redux', 'recoil', 'valtio', 'mobx', 'pinia']

export function detectFramework(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): RepoIndex['package_json_summary']['framework'] {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  if (deps['next']) return 'next'
  if (deps['@remix-run/react'] || deps['@remix-run/node']) return 'remix'
  if (deps['vite']) return 'vite'
  return 'unknown'
}

export function detectConventions(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): RepoIndex['conventions'] {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  const depNames = Object.keys(deps)

  const has_tailwind = !!deps['tailwindcss']
  // shadcn/ui isn't a single dep — it ships components into the repo. Detect
  // by the conventional companions: radix-ui primitives + class-variance-authority.
  const has_shadcn = depNames.some((d) => d.startsWith('@radix-ui/')) && !!deps['class-variance-authority']

  const auth_libs = AUTH_LIB_KEYWORDS.filter((k) => depNames.some((d) => d === k || d.startsWith(`${k}/`)))
  const state_libs = STATE_LIB_KEYWORDS.filter((k) => depNames.includes(k))

  let test_framework: RepoIndex['conventions']['test_framework'] = 'unknown'
  if (deps['playwright'] || deps['@playwright/test']) test_framework = 'playwright'
  else if (deps['vitest']) test_framework = 'vitest'
  else if (deps['jest']) test_framework = 'jest'

  return { has_shadcn, has_tailwind, auth_libs, state_libs, test_framework }
}

export function buildDirectoryHistogram(paths: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of paths) {
    const slashIdx = p.indexOf('/')
    const top = slashIdx === -1 ? '<root>' : p.slice(0, slashIdx)
    out[top] = (out[top] ?? 0) + 1
  }
  return out
}

/**
 * Builds the repo index by hitting GitHub for tree + package.json + recent
 * commits. Returns null if no PAT is configured (so the wizard can detect and
 * degrade). Otherwise returns a fully-populated RepoIndex.
 */
export async function buildRepoIndex(): Promise<RepoIndex | null> {
  if (!process.env.GITHUB_PAT) return null

  const tree = await getFileTree()
  if (tree.length === 0) {
    // Either rate-limited or invalid PAT — return null rather than half-baked.
    return null
  }
  const filePaths = tree.filter((t) => t.type === 'file').map((t) => t.path)

  const pkgRaw = await getFileContent('package.json')
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } = {}
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw) as typeof pkg
    } catch {
      // Leave pkg empty; downstream detection will say 'unknown'.
    }
  }

  const allDeps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) })
    .sort()
    .slice(0, 30)

  const recentCommits = await searchCommits('phase')

  const index: RepoIndex = {
    built_at: new Date().toISOString(),
    total_files: filePaths.length,
    by_directory: buildDirectoryHistogram(filePaths),
    recent_commits: recentCommits.slice(0, 50),
    package_json_summary: {
      framework: detectFramework(pkg),
      dependencies: allDeps,
      scripts: pkg.scripts ?? {},
    },
    conventions: detectConventions(pkg),
  }

  return index
}

async function persistIndex(index: RepoIndex): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  try {
    const { error } = await sb.from('atlas_config').upsert(
      {
        key: CACHE_KEY,
        value: JSON.stringify(index),
        set_by: 'repo-index',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )
    if (error) {
      console.warn('[repo-index] persist failed:', error.message)
    }
  } catch (err) {
    console.warn('[repo-index] persist threw:', err instanceof Error ? err.message : err)
  }
}

async function loadPersistedIndex(): Promise<RepoIndex | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  try {
    const { data, error } = await sb
      .from('atlas_config')
      .select('value, updated_at')
      .eq('key', CACHE_KEY)
      .maybeSingle()
    if (error || !data) return null
    const raw = (data as { value: string | null }).value
    if (!raw) return null
    return JSON.parse(raw) as RepoIndex
  } catch (err) {
    console.warn('[repo-index] load failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Returns the cached repo index. If we have an in-memory copy, return it.
 * Otherwise try the persisted copy, otherwise build fresh. Callers in hot
 * paths (every wizard call) should rely on the in-memory cache populated by
 * the boot + refresh timer, not trigger a build here.
 */
export async function getRepoIndex(): Promise<RepoIndex | null> {
  if (_inMemoryIndex) return _inMemoryIndex
  const persisted = await loadPersistedIndex()
  if (persisted) {
    _inMemoryIndex = persisted
    return persisted
  }
  const fresh = await buildRepoIndex()
  if (fresh) {
    _inMemoryIndex = fresh
    await persistIndex(fresh)
  }
  return fresh
}

/**
 * Force a rebuild of the index from GitHub and re-persist. Used by the
 * `/atlas/repo/refresh-index` endpoint and by the 30-minute timer.
 */
export async function refreshRepoIndex(): Promise<RepoIndex | null> {
  const fresh = await buildRepoIndex()
  if (fresh) {
    _inMemoryIndex = fresh
    await persistIndex(fresh)
  }
  return fresh
}

/**
 * Boot-time helper. Loads the persisted index immediately so the wizard can
 * answer fast on cold start, then schedules a background refresh + a
 * recurring 30-minute refresh timer. Never throws — Atlas must keep booting
 * even if the GitHub fetch fails.
 */
export async function startRepoIndexLoop(): Promise<void> {
  if (!process.env.GITHUB_PAT) {
    console.log('[repo-index] GITHUB_PAT not set; skipping repo indexing — wizard will run without repo context')
    return
  }

  const persisted = await loadPersistedIndex()
  if (persisted) {
    _inMemoryIndex = persisted
    console.log(`[repo-index] loaded persisted index built_at=${persisted.built_at} (${persisted.total_files} files)`)
  }

  // Kick a fresh build in the background — don't block boot on it.
  void refreshRepoIndex()
    .then((idx) => {
      if (idx) console.log(`[repo-index] fresh build_at=${idx.built_at} (${idx.total_files} files)`)
    })
    .catch((err) => {
      console.warn('[repo-index] initial refresh failed:', err instanceof Error ? err.message : err)
    })

  if (_refreshTimer) clearInterval(_refreshTimer)
  _refreshTimer = setInterval(() => {
    void refreshRepoIndex().catch((err) => {
      console.warn('[repo-index] periodic refresh failed:', err instanceof Error ? err.message : err)
    })
  }, REFRESH_INTERVAL_MS)
  // Don't keep the event loop alive just for the timer — the HTTP server does.
  if (typeof _refreshTimer.unref === 'function') _refreshTimer.unref()
}

export const __test_only__ = {
  detectFramework,
  detectConventions,
  buildDirectoryHistogram,
  setInMemoryIndex(idx: RepoIndex | null): void {
    _inMemoryIndex = idx
  },
}
