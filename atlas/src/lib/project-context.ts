// Phase 1.10av — Atlas multi-project context resolution.
//
// Atlas now hosts multiple projects. Every authenticated request resolves to
// exactly one current project — sourced (in order) from the `X-Atlas-Project`
// header, the session's last-active project, or the first project the member
// has access to. The resolved project_id is then used to scope every read/
// write of per-project tables (atlas_conversations, atlas_chat_summaries,
// atlas_events, atlas_pending_specs, atlas_decisions).
//
// CropsIntel V3 is the seeded default project, so day-1 nothing changes for
// existing callers — every legacy code path continues to operate against the
// same data set under a single project_id.

import type { IncomingMessage } from 'http'
import { getSupabaseClient } from './supabase'
import type { Role } from './auth'

export const CROPSINTEL_PROJECT_SLUG = 'cropsintel-v3'

export interface ProjectRow {
  id: string
  slug: string
  display_name: string
  description: string | null
  repo_url: string | null
  status: 'active' | 'archived'
}

export interface ProjectMembership {
  project_id: string
  member_id: string
  role: Role
}

// Return all active projects this member can access (with their per-project
// role). Service-bearer principal is treated as having access to every project.
export async function listProjectsForMember(memberId: string | null): Promise<Array<ProjectRow & { role: Role }>> {
  const sb = getSupabaseClient()
  if (!sb) return []
  if (!memberId) {
    // Service principal: see every active project as 'owner'.
    const { data } = await sb
      .from('atlas_projects')
      .select('id, slug, display_name, description, repo_url, status')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
    return ((data ?? []) as ProjectRow[]).map((p) => ({ ...p, role: 'owner' as Role }))
  }
  const { data } = await sb
    .from('atlas_project_members')
    .select('role, project:atlas_projects!inner(id, slug, display_name, description, repo_url, status)')
    .eq('member_id', memberId)
  // Supabase types nested joins as arrays even when `!inner` returns a single
  // row; normalize to a single ProjectRow before filtering.
  type Joined = { role: Role; project: ProjectRow | ProjectRow[] | null }
  const rows = (data ?? []) as unknown as Joined[]
  return rows
    .map((r) => {
      const project = Array.isArray(r.project) ? r.project[0] : r.project
      return project ? { ...project, role: r.role } : null
    })
    .filter((p): p is ProjectRow & { role: Role } => p !== null && p.status === 'active')
}

// Look up a single project by slug regardless of access. Returns null if not
// found OR if archived. Caller is responsible for cross-checking membership
// before exposing details.
export async function getProjectBySlug(slug: string): Promise<ProjectRow | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data } = await sb
    .from('atlas_projects')
    .select('id, slug, display_name, description, repo_url, status')
    .eq('slug', slug)
    .maybeSingle()
  if (!data) return null
  return data as ProjectRow
}

export async function getProjectById(id: string): Promise<ProjectRow | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data } = await sb
    .from('atlas_projects')
    .select('id, slug, display_name, description, repo_url, status')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  return data as ProjectRow
}

// Membership check used by every project-scoped route. Service principal is
// implicitly a member of every project.
export async function getMembership(
  memberId: string | null,
  projectId: string,
): Promise<ProjectMembership | null> {
  if (!memberId) {
    return { project_id: projectId, member_id: 'service', role: 'owner' }
  }
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data } = await sb
    .from('atlas_project_members')
    .select('project_id, member_id, role')
    .eq('member_id', memberId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!data) return null
  return data as ProjectMembership
}

export type ResolvedProject = ProjectRow & { role: Role }

// Resolve the current project for a request:
// 1. X-Atlas-Project header (if present and member has access)
// 2. atlas_sessions.last_project_id (if still accessible)
// 3. First project the member has access to
// Returns null if none can be resolved (caller should 403).
export async function resolveProjectForRequest(params: {
  req: IncomingMessage
  sessionId: string
  memberId: string | null
}): Promise<ResolvedProject | null> {
  const { req, sessionId, memberId } = params

  const headerSlugRaw = req.headers['x-atlas-project']
  const headerSlug = Array.isArray(headerSlugRaw) ? headerSlugRaw[0] : headerSlugRaw
  if (headerSlug && typeof headerSlug === 'string') {
    const project = await getProjectBySlug(headerSlug.trim())
    if (project && project.status === 'active') {
      const ms = await getMembership(memberId, project.id)
      if (ms) return { ...project, role: ms.role }
    }
    // Header present but invalid/no access — fall through (don't 403 here so
    // legacy clients sending stale headers still work).
  }

  const sb = getSupabaseClient()
  if (!sb) return null

  // Service principal: prefer cropsintel-v3 by default for cron + Builder.
  if (!memberId || sessionId === 'service') {
    const cropsintel = await getProjectBySlug(CROPSINTEL_PROJECT_SLUG)
    if (cropsintel) return { ...cropsintel, role: 'owner' }
    const list = await listProjectsForMember(null)
    return list[0] ?? null
  }

  // Try the session's last-active project.
  const { data: session } = await sb
    .from('atlas_sessions')
    .select('last_project_id')
    .eq('id', sessionId)
    .maybeSingle()
  const lastProjectId = (session as { last_project_id: string | null } | null)?.last_project_id ?? null
  if (lastProjectId) {
    const ms = await getMembership(memberId, lastProjectId)
    if (ms) {
      const project = await getProjectById(lastProjectId)
      if (project && project.status === 'active') return { ...project, role: ms.role }
    }
  }

  // Fall back to the first project the member is attached to.
  const projects = await listProjectsForMember(memberId)
  return projects[0] ?? null
}

// Persist the user's last-active project on their session row so the next
// request defaults to the same project after a page reload.
export async function setSessionLastProject(sessionId: string, projectId: string): Promise<void> {
  if (sessionId === 'service') return
  const sb = getSupabaseClient()
  if (!sb) return
  await sb.from('atlas_sessions').update({ last_project_id: projectId }).eq('id', sessionId)
}

// Add a member to a project at a given role. Idempotent — if the row already
// exists the role is updated.
export async function addProjectMember(params: {
  projectId: string
  memberId: string
  role: Role
}): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, error: 'supabase_unavailable' }
  const { error } = await sb
    .from('atlas_project_members')
    .upsert(
      { project_id: params.projectId, member_id: params.memberId, role: params.role },
      { onConflict: 'project_id,member_id' },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function removeProjectMember(projectId: string, memberId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, error: 'supabase_unavailable' }
  const { error } = await sb
    .from('atlas_project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('member_id', memberId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function listProjectMembers(projectId: string): Promise<Array<{
  member_id: string
  role: Role
  phone: string
  display_name: string | null
  status: string
}>> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data } = await sb
    .from('atlas_project_members')
    .select('member_id, role, atlas_members:member_id (phone, display_name, status)')
    .eq('project_id', projectId)
  type MemberJoinRow = { phone: string; display_name: string | null; status: string }
  type Joined = {
    member_id: string
    role: Role
    atlas_members: MemberJoinRow | MemberJoinRow[] | null
  }
  return ((data ?? []) as unknown as Joined[]).map((r) => {
    const m = Array.isArray(r.atlas_members) ? r.atlas_members[0] : r.atlas_members
    return {
      member_id: r.member_id,
      role: r.role,
      phone: m?.phone ?? '',
      display_name: m?.display_name ?? null,
      status: m?.status ?? 'unknown',
    }
  })
}

export async function createProject(params: {
  slug: string
  displayName: string
  description: string | null
  repoUrl: string | null
  createdBy: string | null
}): Promise<{ ok: true; project: ProjectRow } | { ok: false; error: string }> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, error: 'supabase_unavailable' }
  const slug = params.slug.trim().toLowerCase()
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
    return { ok: false, error: 'invalid_slug' }
  }
  if (!params.displayName.trim()) return { ok: false, error: 'display_name_required' }

  const { data, error } = await sb
    .from('atlas_projects')
    .insert({
      slug,
      display_name: params.displayName.trim(),
      description: params.description?.trim() || null,
      repo_url: params.repoUrl?.trim() || null,
      created_by: params.createdBy,
    })
    .select('id, slug, display_name, description, repo_url, status')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'insert_failed' }
  return { ok: true, project: data as ProjectRow }
}

// Compose the canonical thread_id for a project. Legacy `web-default` is
// auto-prefixed so older clients keep working unchanged.
export function namespaceThreadId(projectSlug: string, threadId: string): string {
  if (!threadId) return `${projectSlug}:web-default`
  if (threadId.includes(':')) return threadId
  return `${projectSlug}:${threadId}`
}
