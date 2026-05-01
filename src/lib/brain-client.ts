// Phase 1.10ab — Atlas Brain client
//
// Thin wrapper over Supabase for the brain_* tables and a fetch+SSE adapter
// for the brain-ai edge function. brain_* tables are not yet in
// `database.types.ts` (regenerated post-migration deploy), so we cast through
// `unknown` and surface narrow typed shapes here.

import { supabase } from './supabase'

export type BrainAuthor = 'human' | 'claude' | 'openai' | 'gpt' | 'gemini' | 'consensus'
export type BrainMessageType = 'prompt' | 'comment' | 'ai_analysis' | 'consensus' | 'decision'
export type BrainCategory = 'agent' | 'product' | 'infra' | 'process' | string
export type BrainStatus = 'active' | 'paused' | 'archived'

export interface BrainNode {
  id: string
  node_key: string
  label: string
  description: string | null
  category: BrainCategory | null
  status: BrainStatus
  score: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface BrainDiscussion {
  id: string
  node_id: string
  thread_id: string
  author: BrainAuthor
  message_type: BrainMessageType
  content: string
  cost_usd: number
  metadata: Record<string, unknown>
  created_at: string
}

export interface BrainNodeHistoryRow {
  id: string
  node_id: string
  score_before: number | null
  score_after: number | null
  reason: string
  changed_by: string
  related_thread_id: string | null
  created_at: string
}

export interface BrainCostSummary {
  today: number
  month_to_date: number
  budget: number
  last_debate: number | null
}

const BUDGET_USD = 400

// brain_* tables are not in generated database types — narrow `any` here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

export async function listBrainNodes(filters?: {
  category?: string
  status?: string
  search?: string
}): Promise<BrainNode[]> {
  const client = supabase as unknown as AnyClient
  let q = client.from('brain_nodes').select('*').order('label', { ascending: true })
  if (filters?.category) q = q.eq('category', filters.category)
  if (filters?.status) q = q.eq('status', filters.status)
  const { data, error } = await q
  if (error) throw new Error(`listBrainNodes: ${error.message}`)
  const rows: BrainNode[] = (data ?? []).map(normalizeNode)
  if (filters?.search) {
    const s = filters.search.toLowerCase()
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(s) ||
        r.node_key.toLowerCase().includes(s) ||
        (r.description ?? '').toLowerCase().includes(s),
    )
  }
  return rows
}

export async function listDiscussionsByNode(nodeId: string, limit = 200): Promise<BrainDiscussion[]> {
  const client = supabase as unknown as AnyClient
  const { data, error } = await client
    .from('brain_discussions')
    .select('*')
    .eq('node_id', nodeId)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`listDiscussionsByNode: ${error.message}`)
  return (data ?? []).map(normalizeDiscussion)
}

export async function listDiscussionsByThread(
  nodeId: string,
  threadId: string,
): Promise<BrainDiscussion[]> {
  const client = supabase as unknown as AnyClient
  const { data, error } = await client
    .from('brain_discussions')
    .select('*')
    .eq('node_id', nodeId)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`listDiscussionsByThread: ${error.message}`)
  return (data ?? []).map(normalizeDiscussion)
}

export async function listNodeHistory(nodeId: string, limit = 60): Promise<BrainNodeHistoryRow[]> {
  const client = supabase as unknown as AnyClient
  const { data, error } = await client
    .from('brain_node_history')
    .select('*')
    .eq('node_id', nodeId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listNodeHistory: ${error.message}`)
  return (data ?? []).map(normalizeHistory)
}

export async function adjustNodeScore(
  node: BrainNode,
  newScore: number,
  reason: string,
  userId: string,
): Promise<{ before: number; after: number }> {
  if (!reason.trim()) throw new Error('reason required')
  const clamped = Math.max(0, Math.min(100, Math.round(newScore)))
  const before = node.score
  const after = clamped
  const client = supabase as unknown as AnyClient

  const { error: updateErr } = await client
    .from('brain_nodes')
    .update({ score: after })
    .eq('id', node.id)
  if (updateErr) throw new Error(`adjustNodeScore: ${updateErr.message}`)

  const { error: histErr } = await client.from('brain_node_history').insert({
    node_id: node.id,
    score_before: before,
    score_after: after,
    reason: reason.trim(),
    changed_by: `human:${userId}`,
    related_thread_id: null,
  })
  if (histErr) throw new Error(`adjustNodeScore history: ${histErr.message}`)

  return { before, after }
}

export async function fetchBrainCosts(lastDebateThreadId?: string): Promise<BrainCostSummary> {
  // Aggregate atlas_cost_log over today + month-to-date for service='brain-ai'
  const client = supabase as unknown as AnyClient
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data: monthRows, error: monthErr } = await client
    .from('atlas_cost_log')
    .select('cost_usd, occurred_at')
    .gte('occurred_at', startOfMonth)
  if (monthErr) {
    console.warn('[brain-client] cost fetch failed:', monthErr.message)
    return { today: 0, month_to_date: 0, budget: BUDGET_USD, last_debate: null }
  }

  let today = 0
  let month = 0
  for (const r of (monthRows ?? []) as { cost_usd: number; occurred_at: string }[]) {
    const c = Number(r.cost_usd ?? 0)
    month += c
    if (r.occurred_at >= startOfDay) today += c
  }

  let lastDebate: number | null = null
  if (lastDebateThreadId) {
    const { data: debRows } = await client
      .from('brain_discussions')
      .select('cost_usd')
      .eq('thread_id', lastDebateThreadId)
    lastDebate = ((debRows ?? []) as { cost_usd: number }[]).reduce(
      (sum, r) => sum + Number(r.cost_usd ?? 0),
      0,
    )
  }

  return { today, month_to_date: month, budget: BUDGET_USD, last_debate: lastDebate }
}

// ---- SSE event types -------------------------------------------------------

export interface BrainOpinionEvent {
  type: 'opinion_received'
  opinion: {
    provider: 'claude' | 'openai' | 'gemini'
    model: string
    content: string
    costUsd: number
    inputTokens: number
    outputTokens: number
    durationMs: number
    error?: string
  }
}

export interface BrainConsensusEvent {
  type: 'consensus_received'
  consensus: {
    provider: 'consensus'
    model: string
    content: string
    verdict: string
    scoreDelta: number
    scoreReason: string
    specReadyPrompt: string | null
    costUsd: number
    inputTokens: number
    outputTokens: number
    durationMs: number
  }
}

export interface BrainThreadStartedEvent {
  type: 'thread_started'
  thread_id: string
}

export interface BrainScoreUpdatedEvent {
  type: 'score_updated'
  before: number
  after: number
}

export interface BrainErrorEvent {
  type: 'error'
  message: string
}

export type BrainEvent =
  | BrainThreadStartedEvent
  | BrainOpinionEvent
  | BrainConsensusEvent
  | BrainScoreUpdatedEvent
  | BrainErrorEvent

export interface StartDebateOptions {
  signal?: AbortSignal
  onEvent: (e: BrainEvent) => void
}

export async function startDebate(
  nodeId: string,
  prompt: string,
  context: string | undefined,
  opts: StartDebateOptions,
): Promise<void> {
  await invokeBrainAi(
    { action: 'debate', node_id: nodeId, prompt, context },
    opts,
  )
}

export async function rerunConsensus(
  nodeId: string,
  threadId: string,
  opts: StartDebateOptions,
): Promise<void> {
  await invokeBrainAi(
    { action: 'consensus', node_id: nodeId, thread_id: threadId },
    opts,
  )
}

interface BrainAiBody {
  action: 'debate' | 'consensus'
  node_id: string
  prompt?: string
  context?: string
  thread_id?: string
}

async function invokeBrainAi(body: BrainAiBody, opts: StartDebateOptions): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in to run Multi-Brain.')

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/brain-ai`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`brain-ai ${res.status}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const evt = JSON.parse(payload) as BrainEvent
          opts.onEvent(evt)
        } catch (e) {
          if (payload.startsWith('{')) throw e
        }
      }
    }
  }
}

// ---- Normalizers -----------------------------------------------------------

function normalizeNode(row: Record<string, unknown>): BrainNode {
  return {
    id: String(row.id),
    node_key: String(row.node_key),
    label: String(row.label),
    description: (row.description as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    status: (row.status as BrainStatus) ?? 'active',
    score: Number(row.score ?? 0),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

function normalizeDiscussion(row: Record<string, unknown>): BrainDiscussion {
  return {
    id: String(row.id),
    node_id: String(row.node_id),
    thread_id: String(row.thread_id),
    author: row.author as BrainAuthor,
    message_type: row.message_type as BrainMessageType,
    content: String(row.content ?? ''),
    cost_usd: Number(row.cost_usd ?? 0),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: String(row.created_at),
  }
}

function normalizeHistory(row: Record<string, unknown>): BrainNodeHistoryRow {
  return {
    id: String(row.id),
    node_id: String(row.node_id),
    score_before: row.score_before == null ? null : Number(row.score_before),
    score_after: row.score_after == null ? null : Number(row.score_after),
    reason: String(row.reason ?? ''),
    changed_by: String(row.changed_by ?? ''),
    related_thread_id: (row.related_thread_id as string | null) ?? null,
    created_at: String(row.created_at),
  }
}
