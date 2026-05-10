// Phase 1.10bb-b — GitLab repo reader for V1 codebase access.
//
// Atlas's Plan Workshop reads the V1 codebase (almond-oracle, hosted on
// GitLab) so plan-refinement turns can ground questions in real V1 patterns
// — auth flows, role logic, scrapers, the things V3 ports forward. The
// V3 codebase is read via the existing github-client (1.10ak); this module
// is the parallel surface for V1.
//
// Mirrors github-client.ts shape: lazy singleton, warn-once on missing
// token, defensive helpers that return empty/null on error, env-var
// configurable owner/repo (`muzammil69/almond-oracle` baked in as the
// default per V1 mirror at gitlab.com/muzammil69/almond-oracle).
//
// Uses GitLab REST API v4 directly via fetch — avoids adding a new npm
// dep (gitbeaker etc.). Read-only by design — Atlas never writes to
// GitLab from this client.

const GITLAB_API_BASE = 'https://gitlab.com/api/v4'

export interface GitlabFileEntry {
  path: string
  type: 'file' | 'dir'
  size?: number
}

let _warnedNoToken = false

function getToken(): string | null {
  const token = process.env.GITLAB_PAT
  if (!token) {
    if (!_warnedNoToken) {
      console.warn('[gitlab-client] GITLAB_PAT not set — V1 repo reader degraded')
      _warnedNoToken = true
    }
    return null
  }
  return token
}

/**
 * Returns the URL-encoded project path GitLab uses as the "project id" in
 * URL paths (e.g., `muzammil69%2Falmond-oracle`). Configurable via env vars
 * so a future V1 mirror move (or a fork) doesn't require a code change.
 */
function getProjectPath(): string {
  const owner = process.env.GITLAB_REPO_OWNER || 'muzammil69'
  const name = process.env.GITLAB_REPO_NAME || 'almond-oracle'
  return encodeURIComponent(`${owner}/${name}`)
}

function getDefaultRef(): string {
  return process.env.GITLAB_REPO_REF || 'main'
}

async function gitlabFetch(path: string): Promise<Response | null> {
  const token = getToken()
  if (!token) return null
  try {
    return await fetch(`${GITLAB_API_BASE}${path}`, {
      headers: { 'PRIVATE-TOKEN': token, 'Accept': 'application/json' },
    })
  } catch (err) {
    console.warn(`[gitlab-client] fetch ${path} failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Returns the repo file tree (recursive, default branch=main). Empty array
 * on missing PAT, missing repo, network error, or non-200 response.
 *
 * GitLab paginates trees at 100 entries per page by default; we walk pages
 * until x-next-page header is empty so big repos return complete trees.
 */
export async function getFileTree(subpath?: string): Promise<GitlabFileEntry[]> {
  const token = getToken()
  if (!token) return []
  const project = getProjectPath()
  const ref = getDefaultRef()

  const out: GitlabFileEntry[] = []
  let page = 1
  // Cap pagination to avoid runaway loops on misconfigured projects.
  const maxPages = 50
  while (page <= maxPages) {
    const subPathParam = subpath ? `&path=${encodeURIComponent(subpath)}` : ''
    const url = `/projects/${project}/repository/tree?recursive=true&ref=${encodeURIComponent(ref)}&per_page=100&page=${page}${subPathParam}`
    const res = await gitlabFetch(url)
    if (!res || !res.ok) {
      if (res) console.warn(`[gitlab-client] getFileTree page ${page} → HTTP ${res.status}`)
      break
    }
    let entries: Array<{ path?: string; type?: string }>
    try {
      entries = await res.json() as Array<{ path?: string; type?: string }>
    } catch (err) {
      console.warn('[gitlab-client] getFileTree json parse failed:', err instanceof Error ? err.message : err)
      break
    }
    for (const e of entries) {
      if (typeof e.path !== 'string' || e.path.length === 0) continue
      out.push({
        path: e.path,
        type: e.type === 'tree' ? 'dir' : 'file',
      })
    }
    const nextHeader = res.headers.get('x-next-page')
    if (!nextHeader || nextHeader.trim() === '') break
    page = parseInt(nextHeader, 10)
    if (!Number.isFinite(page) || page <= 0) break
  }
  return out
}

/**
 * Returns the raw UTF-8 content of a single file at the configured ref.
 * Null on missing PAT, missing file, binary content, or any error.
 */
export async function getFileContent(filePath: string): Promise<string | null> {
  const token = getToken()
  if (!token) return null
  const project = getProjectPath()
  const ref = getDefaultRef()
  const url = `/projects/${project}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(ref)}`
  const res = await gitlabFetch(url)
  if (!res) return null
  if (!res.ok) {
    if (res.status !== 404) {
      console.warn(`[gitlab-client] getFileContent(${filePath}) → HTTP ${res.status}`)
    }
    return null
  }
  try {
    return await res.text()
  } catch (err) {
    console.warn(`[gitlab-client] getFileContent(${filePath}) text decode failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

export interface GitlabSearchHit {
  path: string
  startline: number
  data: string
}

/**
 * Searches blob content across the repo for a string. Returns up to 20 hits
 * with file path + line number + matching snippet. Empty array on any error.
 *
 * GitLab's blob search is exact-substring (not fuzzy / not embedding-based).
 * Workshop callers pass concrete tokens like "useGuestSession" / "verify_jwt"
 * — relevance ranking lives upstream in concept-retrieval.ts.
 */
export async function searchCode(query: string): Promise<GitlabSearchHit[]> {
  const token = getToken()
  if (!token) return []
  if (!query || query.trim().length < 2) return []
  const project = getProjectPath()
  const url = `/projects/${project}/search?scope=blobs&search=${encodeURIComponent(query)}&per_page=20`
  const res = await gitlabFetch(url)
  if (!res || !res.ok) {
    if (res) console.warn(`[gitlab-client] searchCode(${query}) → HTTP ${res.status}`)
    return []
  }
  try {
    const hits = await res.json() as Array<{ path?: string; startline?: number; data?: string }>
    return hits
      .filter(h => typeof h.path === 'string' && typeof h.data === 'string')
      .map(h => ({
        path: h.path as string,
        startline: typeof h.startline === 'number' ? h.startline : 0,
        data: h.data as string,
      }))
  } catch (err) {
    console.warn(`[gitlab-client] searchCode(${query}) parse failed:`, err instanceof Error ? err.message : err)
    return []
  }
}

/**
 * Glob-style file lookup, mirroring github-client's listFilesByPattern.
 * Supports `*` (no slash) and `**` (anything). Single getFileTree call —
 * caller caches if hot.
 */
export async function listFilesByPattern(pattern: string): Promise<string[]> {
  const tree = await getFileTree()
  const regex = patternToRegex(pattern)
  return tree.filter(t => t.type === 'file' && regex.test(t.path)).map(t => t.path)
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^$()|[\]\\]/g, '\\$&')
  const withDoubleGlob = escaped.replace(/\*\*/g, ' ')
  const withSingleGlob = withDoubleGlob.replace(/\*/g, '[^/]*')
  const final = withSingleGlob.replace(/ /g, '.*')
  return new RegExp(`^${final}$`)
}

/**
 * Quick health check used by Workshop's loadFullContext to decide whether to
 * include V1 in the source list. Returns true if the configured PAT can list
 * the project root, false otherwise. Cached for the process lifetime to
 * avoid hammering GitLab on every Workshop turn.
 */
let _healthCache: { ok: boolean; checkedAt: number } | null = null
const HEALTH_TTL_MS = 5 * 60_000

export async function isReachable(): Promise<boolean> {
  if (_healthCache && Date.now() - _healthCache.checkedAt < HEALTH_TTL_MS) {
    return _healthCache.ok
  }
  const token = getToken()
  if (!token) {
    _healthCache = { ok: false, checkedAt: Date.now() }
    return false
  }
  const project = getProjectPath()
  const res = await gitlabFetch(`/projects/${project}`)
  const ok = !!res && res.ok
  _healthCache = { ok, checkedAt: Date.now() }
  return ok
}

export const __test_only__ = { patternToRegex, getProjectPath, getDefaultRef }
