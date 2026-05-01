// Phase 1.10ac — Atlas PD client
//
// Thin wrapper over Supabase for the pd_* tables and a fetch adapter for the
// pd-ai-review edge function. pd_* tables are not yet in `database.types.ts`
// (regenerated post-migration deploy), so we cast through `unknown` and
// surface narrow typed shapes here. Mirrors the brain-client pattern.

import { supabase } from './supabase'

export type PdProposalStatus =
  | 'draft'
  | 'in-review'
  | 'approved'
  | 'rejected'
  | 'shipped'
  | 'archived'

export type PdEvidenceType = 'commit' | 'screenshot' | 'audit-report' | 'note'

export type PdDecisionVerdict = 'approved' | 'rejected' | 'changes-requested'

export type PdValidationVerdict = 'pass' | 'needs-work' | 'reject'

export interface PdProposal {
  id: string
  title: string
  description: string
  motivation: string | null
  status: PdProposalStatus
  proposer_id: string | null
  related_phase: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PdEvidence {
  id: string
  proposal_id: string
  artefact_type: PdEvidenceType
  artefact_url: string | null
  description: string | null
  uploaded_by: string | null
  created_at: string
}

export interface PdDecision {
  id: string
  proposal_id: string
  verdict: PdDecisionVerdict
  rationale: string
  decided_by: string | null
  created_at: string
}

export interface PdAutoValidation {
  id: string
  proposal_id: string
  verdict: PdValidationVerdict
  ai_model: string
  reasoning: string | null
  gaps: string[]
  cost_usd: number
  created_at: string
}

export interface PdReviewBundle {
  id: string
  title: string
  description: string | null
  proposal_ids: string[]
  exported_markdown: string | null
  created_by: string | null
  created_at: string
}

export interface PdBenchmark {
  id: string
  metric_key: string
  value: number
  observed_at: string
  metadata: Record<string, unknown>
}

// pd_* tables are not in generated database types — narrow `any` here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any
const client = () => supabase as unknown as AnyClient

// ---- proposals -------------------------------------------------------------

export async function listProposals(filter?: { status?: PdProposalStatus }): Promise<PdProposal[]> {
  let q = client().from('pd_proposals').select('*').order('updated_at', { ascending: false })
  if (filter?.status) q = q.eq('status', filter.status)
  const { data, error } = await q
  if (error) throw new Error(`listProposals: ${error.message}`)
  return (data ?? []).map(normalizeProposal)
}

export async function createProposal(input: {
  title: string
  description: string
  motivation?: string | null
  related_phase?: string | null
  proposer_id: string
}): Promise<PdProposal> {
  if (!input.title.trim()) throw new Error('title required')
  if (!input.description.trim()) throw new Error('description required')
  const { data, error } = await client()
    .from('pd_proposals')
    .insert({
      title: input.title.trim(),
      description: input.description.trim(),
      motivation: input.motivation?.trim() || null,
      related_phase: input.related_phase?.trim() || null,
      proposer_id: input.proposer_id,
      status: 'draft',
    })
    .select('*')
    .single()
  if (error) throw new Error(`createProposal: ${error.message}`)
  return normalizeProposal(data)
}

export async function updateProposal(
  id: string,
  patch: Partial<Pick<PdProposal, 'title' | 'description' | 'motivation' | 'related_phase'>>,
): Promise<PdProposal> {
  const { data, error } = await client()
    .from('pd_proposals')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`updateProposal: ${error.message}`)
  return normalizeProposal(data)
}

// Lifecycle transitions are funneled through here so we never accidentally
// allow an arbitrary status change without a corresponding pd_decisions row.
const ALLOWED_TRANSITIONS: Record<PdProposalStatus, PdProposalStatus[]> = {
  draft: ['in-review', 'archived'],
  'in-review': ['approved', 'rejected', 'draft'],
  approved: ['shipped', 'archived'],
  rejected: ['draft', 'archived'],
  shipped: ['archived'],
  archived: [],
}

export async function transitionProposal(
  proposal: PdProposal,
  next: PdProposalStatus,
  decision: { verdict: PdDecisionVerdict; rationale: string; decided_by: string } | null,
): Promise<PdProposal> {
  const allowed = ALLOWED_TRANSITIONS[proposal.status] ?? []
  if (!allowed.includes(next)) {
    throw new Error(`cannot transition ${proposal.status} → ${next}`)
  }
  // Per NEVER list: no proposal status change without a pd_decisions row,
  // EXCEPT the self-service draft → in-review move (the proposer submitting
  // their own work for review) and any move into archived (housekeeping).
  const requiresDecision = !(
    (proposal.status === 'draft' && next === 'in-review') ||
    next === 'archived' ||
    (proposal.status === 'rejected' && next === 'draft')
  )
  if (requiresDecision && !decision) {
    throw new Error('decision rationale required for this transition')
  }

  const { data, error } = await client()
    .from('pd_proposals')
    .update({ status: next })
    .eq('id', proposal.id)
    .select('*')
    .single()
  if (error) throw new Error(`transitionProposal: ${error.message}`)

  if (decision) {
    if (!decision.rationale.trim()) throw new Error('rationale required')
    const { error: dErr } = await client().from('pd_decisions').insert({
      proposal_id: proposal.id,
      verdict: decision.verdict,
      rationale: decision.rationale.trim(),
      decided_by: decision.decided_by,
    })
    if (dErr) throw new Error(`transitionProposal: log decision failed: ${dErr.message}`)
  }
  return normalizeProposal(data)
}

// ---- evidence --------------------------------------------------------------

export async function listEvidenceByProposal(proposalId: string): Promise<PdEvidence[]> {
  const { data, error } = await client()
    .from('pd_evidence')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listEvidenceByProposal: ${error.message}`)
  return (data ?? []).map(normalizeEvidence)
}

export async function listAllEvidence(): Promise<PdEvidence[]> {
  const { data, error } = await client()
    .from('pd_evidence')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`listAllEvidence: ${error.message}`)
  return (data ?? []).map(normalizeEvidence)
}

export async function createEvidence(input: {
  proposal_id: string
  artefact_type: PdEvidenceType
  artefact_url?: string | null
  description?: string | null
  uploaded_by: string
}): Promise<PdEvidence> {
  const { data, error } = await client()
    .from('pd_evidence')
    .insert({
      proposal_id: input.proposal_id,
      artefact_type: input.artefact_type,
      artefact_url: input.artefact_url ?? null,
      description: input.description ?? null,
      uploaded_by: input.uploaded_by,
    })
    .select('*')
    .single()
  if (error) throw new Error(`createEvidence: ${error.message}`)
  return normalizeEvidence(data)
}

export async function uploadEvidenceFile(
  proposalId: string,
  file: File,
  uploadedBy: string,
): Promise<PdEvidence> {
  const path = `${proposalId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`
  const { error: upErr } = await supabase.storage
    .from('pd-evidence')
    .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
  if (upErr) throw new Error(`upload failed: ${upErr.message}`)

  const isImage = (file.type || '').startsWith('image/')
  const artefactType: PdEvidenceType = isImage ? 'screenshot' : 'audit-report'

  return createEvidence({
    proposal_id: proposalId,
    artefact_type: artefactType,
    artefact_url: path,
    description: file.name,
    uploaded_by: uploadedBy,
  })
}

export async function signedEvidenceUrl(path: string, ttlSeconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage.from('pd-evidence').createSignedUrl(path, ttlSeconds)
  if (error) return null
  return data?.signedUrl ?? null
}

// ---- decisions -------------------------------------------------------------

export async function listDecisionsByProposal(proposalId: string): Promise<PdDecision[]> {
  const { data, error } = await client()
    .from('pd_decisions')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`listDecisionsByProposal: ${error.message}`)
  return (data ?? []).map(normalizeDecision)
}

export async function listAllDecisions(filters?: {
  verdict?: PdDecisionVerdict
  fromDate?: string
  toDate?: string
}): Promise<PdDecision[]> {
  let q = client().from('pd_decisions').select('*').order('created_at', { ascending: false }).limit(500)
  if (filters?.verdict) q = q.eq('verdict', filters.verdict)
  if (filters?.fromDate) q = q.gte('created_at', filters.fromDate)
  if (filters?.toDate) q = q.lte('created_at', filters.toDate)
  const { data, error } = await q
  if (error) throw new Error(`listAllDecisions: ${error.message}`)
  return (data ?? []).map(normalizeDecision)
}

// ---- auto-validation -------------------------------------------------------

export async function listValidations(): Promise<PdAutoValidation[]> {
  const { data, error } = await client()
    .from('pd_auto_validation')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`listValidations: ${error.message}`)
  return (data ?? []).map(normalizeValidation)
}

export async function listValidationsByProposal(proposalId: string): Promise<PdAutoValidation[]> {
  const { data, error } = await client()
    .from('pd_auto_validation')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listValidationsByProposal: ${error.message}`)
  return (data ?? []).map(normalizeValidation)
}

export async function runAiReview(proposalId: string): Promise<PdAutoValidation> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in to run AI review.')
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pd-ai-review`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ proposal_id: proposalId }),
  })
  const text = await res.text()
  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(text) } catch { /* ignore */ }
  if (!res.ok) {
    const msg = (payload.error as string) || `pd-ai-review ${res.status}`
    throw new Error(msg)
  }
  return {
    id: String(payload.id ?? ''),
    proposal_id: String(payload.proposal_id ?? proposalId),
    verdict: (payload.verdict as PdValidationVerdict) ?? 'needs-work',
    ai_model: String(payload.ai_model ?? ''),
    reasoning: (payload.reasoning as string | null) ?? null,
    gaps: Array.isArray(payload.gaps) ? (payload.gaps as string[]) : [],
    cost_usd: Number(payload.cost_usd ?? 0),
    created_at: String(payload.created_at ?? new Date().toISOString()),
  }
}

// ---- benchmarks ------------------------------------------------------------

export async function listBenchmarks(metricKey?: string, limit = 60): Promise<PdBenchmark[]> {
  let q = client()
    .from('pd_benchmarks')
    .select('*')
    .order('observed_at', { ascending: false })
    .limit(limit)
  if (metricKey) q = q.eq('metric_key', metricKey)
  const { data, error } = await q
  if (error) throw new Error(`listBenchmarks: ${error.message}`)
  return (data ?? []).map(normalizeBenchmark)
}

// ---- review bundles --------------------------------------------------------

export async function listReviewBundles(): Promise<PdReviewBundle[]> {
  const { data, error } = await client()
    .from('pd_review_bundles')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listReviewBundles: ${error.message}`)
  return (data ?? []).map(normalizeBundle)
}

export async function createReviewBundle(input: {
  title: string
  description?: string | null
  proposal_ids: string[]
  exported_markdown: string
  created_by: string
}): Promise<PdReviewBundle> {
  if (!input.title.trim()) throw new Error('title required')
  if (input.proposal_ids.length === 0) throw new Error('select at least one proposal')
  const { data, error } = await client()
    .from('pd_review_bundles')
    .insert({
      title: input.title.trim(),
      description: input.description ?? null,
      proposal_ids: input.proposal_ids,
      exported_markdown: input.exported_markdown,
      created_by: input.created_by,
    })
    .select('*')
    .single()
  if (error) throw new Error(`createReviewBundle: ${error.message}`)
  return normalizeBundle(data)
}

export async function renderBundleMarkdown(
  bundle: { title: string; description?: string | null; proposal_ids: string[] },
  proposals: PdProposal[],
  decisionsByProposal: Record<string, PdDecision[]>,
  evidenceByProposal: Record<string, PdEvidence[]>,
): Promise<string> {
  const lines: string[] = []
  lines.push(`# ${bundle.title}`, '')
  if (bundle.description) lines.push(bundle.description, '')
  lines.push(`_Generated: ${new Date().toLocaleString()}_`, '')
  lines.push(`## Proposals (${bundle.proposal_ids.length})`, '')
  for (const pid of bundle.proposal_ids) {
    const p = proposals.find((x) => x.id === pid)
    if (!p) continue
    lines.push(`### ${p.title}`)
    lines.push(`- **Status:** ${p.status}`)
    if (p.related_phase) lines.push(`- **Related phase:** ${p.related_phase}`)
    lines.push(`- **Updated:** ${new Date(p.updated_at).toLocaleString()}`, '')
    if (p.motivation) lines.push(`**Motivation:** ${p.motivation}`, '')
    lines.push(p.description, '')
    const decs = decisionsByProposal[pid] ?? []
    if (decs.length > 0) {
      lines.push('**Decisions:**')
      for (const d of decs) {
        lines.push(`- _${new Date(d.created_at).toLocaleString()}_ — **${d.verdict}**: ${d.rationale}`)
      }
      lines.push('')
    }
    const ev = evidenceByProposal[pid] ?? []
    if (ev.length > 0) {
      lines.push('**Evidence:**')
      for (const e of ev) {
        const link = e.artefact_url ? ` (${e.artefact_url})` : ''
        lines.push(`- ${e.artefact_type}: ${e.description ?? ''}${link}`)
      }
      lines.push('')
    }
    lines.push('---', '')
  }
  return lines.join('\n')
}

// ---- normalizers -----------------------------------------------------------

function normalizeProposal(row: Record<string, unknown>): PdProposal {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    motivation: (row.motivation as string | null) ?? null,
    status: (row.status as PdProposalStatus) ?? 'draft',
    proposer_id: (row.proposer_id as string | null) ?? null,
    related_phase: (row.related_phase as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

function normalizeEvidence(row: Record<string, unknown>): PdEvidence {
  return {
    id: String(row.id),
    proposal_id: String(row.proposal_id),
    artefact_type: (row.artefact_type as PdEvidenceType) ?? 'note',
    artefact_url: (row.artefact_url as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    uploaded_by: (row.uploaded_by as string | null) ?? null,
    created_at: String(row.created_at),
  }
}

function normalizeDecision(row: Record<string, unknown>): PdDecision {
  return {
    id: String(row.id),
    proposal_id: String(row.proposal_id),
    verdict: (row.verdict as PdDecisionVerdict) ?? 'changes-requested',
    rationale: String(row.rationale ?? ''),
    decided_by: (row.decided_by as string | null) ?? null,
    created_at: String(row.created_at),
  }
}

function normalizeValidation(row: Record<string, unknown>): PdAutoValidation {
  return {
    id: String(row.id),
    proposal_id: String(row.proposal_id),
    verdict: (row.verdict as PdValidationVerdict) ?? 'needs-work',
    ai_model: String(row.ai_model ?? ''),
    reasoning: (row.reasoning as string | null) ?? null,
    gaps: Array.isArray(row.gaps) ? (row.gaps as string[]) : [],
    cost_usd: Number(row.cost_usd ?? 0),
    created_at: String(row.created_at),
  }
}

function normalizeBundle(row: Record<string, unknown>): PdReviewBundle {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    description: (row.description as string | null) ?? null,
    proposal_ids: Array.isArray(row.proposal_ids) ? (row.proposal_ids as string[]) : [],
    exported_markdown: (row.exported_markdown as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at),
  }
}

function normalizeBenchmark(row: Record<string, unknown>): PdBenchmark {
  return {
    id: String(row.id),
    metric_key: String(row.metric_key),
    value: Number(row.value ?? 0),
    observed_at: String(row.observed_at),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }
}
