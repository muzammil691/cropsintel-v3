---
phase: 1.10ak
title: Cockpit v1.1 — GitHub repo reader (Atlas reads codebase, not just master plan)
status: planned
gate: in-progress count <= 2
order: 1-of-4 cockpit upgrade bundle
estimated_builder_minutes: 18
estimated_cost_usd: 3
master_plan_section: 11.7
---

# Phase 1.10ak — Cockpit v1.1: GitHub repo reader

## Why this exists

Today's wizard reads the master-plan.md only. When user clicks Add or Modify on Phase 1.3 (auth), Atlas knows what the master plan says about Phase 1.3 but does NOT know:
- What auth-related files already exist in the repo
- What conventions are used (Vite + React Router vs Next.js, shadcn/ui patterns, file structure)
- What's been tried before (commits with "auth" in message, abandoned attempts)
- What dependencies are present in package.json

So Atlas guesses. The wizard's questions are generic. The generated spec is shallow because Atlas doesn't see the actual codebase.

This spec gives Atlas **read-only access to the GitHub repo** so the wizard can ground every question in real code. Builder remains the only writer. Atlas reads, Builder writes, Verifier audits, Designer reviews. No change to existing write/audit flow.

## Foundation-first check

- ✅ Atlas already runs on Railway with Supabase + Twilio integrations.
- ✅ `atlas/src/lib/wizard-engine.ts` exists (shipped in 1.10aj).
- ✅ `atlas/src/lib/spec-from-wizard.ts` exists (shipped in 1.10aj).
- ✅ Repo is `muzammil691/cropsintel-v3` on GitHub (public).
- ❓ No GitHub API client in Atlas codebase today — net-new code.
- ❓ No GitHub PAT in Atlas Railway env vars today — needs adding.

## What ships

### 1. GitHub PAT setup (manual step, document in spec)

User must create a GitHub Personal Access Token with `repo:contents:read` scope (read-only) and add it to Atlas Railway service env vars as `GITHUB_PAT`. Spec includes setup instructions in the diagnostic doc Builder writes.

For now, repo defaults to `muzammil691/cropsintel-v3` (also env var: `GITHUB_REPO_OWNER` and `GITHUB_REPO_NAME`).

### 2. GitHub client library

New file `atlas/src/lib/github-client.ts`:

```typescript
import { Octokit } from "@octokit/rest"

const octokit = new Octokit({ auth: process.env.GITHUB_PAT })
const owner = process.env.GITHUB_REPO_OWNER || 'muzammil691'
const repo = process.env.GITHUB_REPO_NAME || 'cropsintel-v3'

export async function getFileTree(): Promise<{ path: string; type: 'file' | 'dir'; size?: number }[]> {
  // Returns full repo file tree, recursive
  const { data } = await octokit.git.getTree({
    owner, repo, tree_sha: 'main', recursive: 'true'
  })
  return data.tree.map(t => ({
    path: t.path!,
    type: t.type === 'tree' ? 'dir' : 'file',
    size: t.size
  }))
}

export async function getFileContent(path: string): Promise<string | null> {
  // Returns raw file contents
  const { data } = await octokit.repos.getContent({ owner, repo, path, ref: 'main' })
  if ('content' in data && data.content) {
    return Buffer.from(data.content, 'base64').toString('utf-8')
  }
  return null
}

export async function searchCommits(query: string, since?: Date): Promise<{ sha: string; message: string; date: string }[]> {
  // Returns recent commits matching a search query
  const { data } = await octokit.search.commits({
    q: `repo:${owner}/${repo} ${query}${since ? ` committer-date:>=${since.toISOString().slice(0,10)}` : ''}`,
    per_page: 20,
    sort: 'committer-date',
    order: 'desc'
  })
  return data.items.map(c => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    date: c.commit.committer.date
  }))
}

export async function listFilesByPattern(pattern: string): Promise<string[]> {
  // Returns file paths matching a glob-like pattern (e.g. "src/**/auth*.tsx")
  const tree = await getFileTree()
  const regex = patternToRegex(pattern)
  return tree.filter(t => t.type === 'file' && regex.test(t.path)).map(t => t.path)
}

function patternToRegex(pattern: string): RegExp {
  // Simple glob-to-regex: * matches non-/, ** matches anything
  const escaped = pattern.replace(/[.+?^$()|[\]\\]/g, '\\$&')
  const withGlob = escaped.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')
  return new RegExp(`^${withGlob}$`)
}
```

### 3. Pre-indexing — repo summary cache

Atlas startup: build a compact in-memory index of the repo. Cache lives in `atlas_config` table under key `github_repo_index` so it survives restarts. Refresh every 30 min OR on git webhook (separate spec).

Index shape:
```typescript
type RepoIndex = {
  built_at: string  // ISO date
  total_files: number
  by_directory: { [path: string]: number }  // file count per dir
  recent_commits: { sha: string; message: string; date: string }[]  // last 50
  package_json_summary: {
    framework: 'vite' | 'next' | 'remix' | 'unknown'
    dependencies: string[]  // top 30
    scripts: Record<string, string>
  }
  conventions: {
    has_shadcn: boolean
    has_tailwind: boolean
    auth_libs: string[]    // detected auth-related deps (supabase-js, clerk, etc.)
    state_libs: string[]   // detected state libs (zustand, jotai, redux)
    test_framework: 'vitest' | 'jest' | 'playwright' | 'unknown'
  }
}
```

Pre-index function `buildRepoIndex()` runs at Atlas boot, populates the cache.

### 4. Wizard engine integration

Extend `atlas/src/lib/wizard-engine.ts` to take repo context:

```typescript
async function proposeQuestions(phaseId: string, masterPlanContext: string, concepts: Concept[]) {
  const index = await getRepoIndex()  // from cache
  const relevantFiles = await findRelevantFiles(phaseId, masterPlanContext)
  const relevantContents = await Promise.all(
    relevantFiles.slice(0, 5).map(p => getFileContent(p))
  )
  
  // Pass to Claude Sonnet:
  const prompt = `
You're proposing wizard questions for phase ${phaseId}.

Master plan context:
${masterPlanContext}

Concepts user has saved:
${concepts.map(c => `- ${c.title}: ${c.content.slice(0, 200)}`).join('\n')}

Repo facts (from real codebase, not assumptions):
- Framework: ${index.package_json_summary.framework}
- Has shadcn/ui: ${index.conventions.has_shadcn}
- Has Tailwind: ${index.conventions.has_tailwind}
- Auth libraries: ${index.conventions.auth_libs.join(', ') || 'none yet'}
- Test framework: ${index.conventions.test_framework}
- Recent commits matching "${phaseId}": ${index.recent_commits.filter(c => c.message.includes(phaseId)).slice(0,5).map(c => c.message).join(', ') || 'none'}

Relevant existing files in this area:
${relevantFiles.slice(0, 10).map(p => `- ${p}`).join('\n')}

Sample contents (first 1500 chars each):
${relevantContents.map((c, i) => `--- ${relevantFiles[i]} ---\n${(c || '').slice(0, 1500)}`).join('\n\n')}

Now propose 3-7 multi-choice questions that ground this phase in REAL repo state. Don't ask things the repo already answers. If auth files exist, ask about extending vs replacing them. If shadcn/ui is present, ask about which components to use, not whether to use it.

Return JSON: { questions: [{ id, text, options: [...], allow_freeform: bool }] }
`
  return await callClaude(prompt)
}

async function findRelevantFiles(phaseId: string, masterPlanContext: string): Promise<string[]> {
  // Heuristic: extract keywords from phase title, search file tree by name match
  // For Phase 1.3 (auth), keywords would be: auth, login, signup, otp, rbac, role, profile
  const keywords = extractKeywords(masterPlanContext)
  const tree = await getFileTree()
  return tree
    .filter(t => t.type === 'file')
    .filter(t => keywords.some(k => t.path.toLowerCase().includes(k.toLowerCase())))
    .map(t => t.path)
    .sort((a, b) => a.length - b.length)  // shortest paths first (likely most foundational)
}
```

### 5. Spec generation — uses repo facts

Extend `spec-from-wizard.ts` to include relevant file paths in generated specs as "Foundation-first check" entries. So when the wizard generates a spec for Phase 1.3, the spec automatically includes:

```markdown
## Foundation-first check

- ✅ src/contexts/AuthContext.tsx exists (read by Atlas during wizard)
- ✅ supabase/migrations/20260428000001_v3_foundation.sql defines profiles table
- ❓ Login page src/pages/Login.tsx exists but doesn't yet handle WhatsApp OTP — needs extension
```

This is what makes phase planning concrete instead of generic.

### 6. New API endpoints

- `GET /atlas/repo/index` — returns the cached RepoIndex.
- `GET /atlas/repo/file?path=<path>` — returns file content (admin-only).
- `POST /atlas/repo/refresh-index` — manually trigger index rebuild (admin-only).

### 7. Tests

`e2e/github-reader.spec.ts`:

- (a) Atlas startup with valid `GITHUB_PAT` → assert `repo_index` row exists in `atlas_config`.
- (b) Atlas startup with missing `GITHUB_PAT` → assert graceful degradation, wizard works without repo context but logs warning.
- (c) Wizard run with repo context → assert generated questions reference real file paths from the repo.
- (d) `getFileContent('package.json')` → assert returns valid JSON content.
- (e) `searchCommits('1.10aj')` → assert returns recent cockpit commits.

## Acceptance criteria

- `GITHUB_PAT` env var documented in spec, user manually adds to Railway.
- `atlas/src/lib/github-client.ts` exists with 4 exported functions.
- Pre-index runs at Atlas boot, caches to `atlas_config.github_repo_index`.
- Wizard `proposeQuestions` includes repo context in Claude prompt.
- Generated specs include "Foundation-first check" entries based on real repo state.
- 5 e2e tests pass.
- Spec lands in `done/` (lifecycle test).

## Out of scope

- Atlas writing to GitHub (read-only this spec).
- GitHub webhooks for auto-refresh (separate follow-up if needed).
- Searching across multiple repos (single repo only).
- Reading from branches other than `main`.
- AST parsing of code files (we just pass raw content to Claude).

## Realistic time estimate

- Pre-index function: ~3 min
- GitHub client lib: ~3 min
- Wizard engine extension: ~4 min
- API endpoints: ~2 min
- Spec generation update: ~3 min
- 5 e2e tests: ~3 min
- **Total Builder: ~18 min**
- Verifier audit: ~3 min
- Designer audit: ~2 min (no UI changes — minimal)
- **Wall clock: ~25-30 min**

## Dependencies

All shipped:
- 1.10aj (cockpit) — wizard engine exists
- 1.10ai (real signals) — Atlas conductor honest
- 1.10ag2 (lifecycle) — spec actually lands in done/
