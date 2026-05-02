// Phase 1.10ar — rolling chat summarizer for the Atlas cockpit timeline.
//
// Triggers (whichever first):
//   • wall clock: ≥10 min since the last summary OR since the thread started
//   • message count: ≥30 new messages in the unsummarised tail
//
// Cost guardrail: max 1 summary per thread per 5 min, Haiku-priced.
//
// Side effects:
//   • inserts atlas_chat_summaries row covering the range
//   • inserts paired memory_chunks row with kind='chat-summary' carrying the
//     embedded summary_long so existing vector search picks it up
//   • the inserted summary is detectable by the cockpit via the
//     `atlas:chat-summary-created` realtime channel (Postgres NOTIFY-style is
//     out of scope; the frontend re-polls every 5 min and after each user
//     message that triggers a summary).

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { getSupabaseClient } from './supabase'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const EMBEDDING_MODEL = 'text-embedding-3-large'
const EMBEDDING_DIMENSIONS = 1536

const TRIGGER_WALL_CLOCK_MS = 10 * 60 * 1000      // 10 min
const TRIGGER_MIN_MESSAGES = 30
const RATE_LIMIT_MS = 5 * 60 * 1000               // 1 summary per thread per 5 min

// Strip OTP codes, session tokens, and `sk-...` keys before they reach the
// summary input. Belt-and-braces — these should never be in chat content
// but the producer must not be the place such a leak gets immortalised in
// memory_chunks.
const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{6}\b/g, '[REDACTED-CODE]'],                                // 6-digit OTP
  [/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED-API-KEY]'],                  // sk- keys
  [/\b(?:Bearer\s+)?[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED-JWT]'],
  [/atlas_session_[A-Za-z0-9_-]+/g, '[REDACTED-SESSION]'],
]

function redact(text: string): string {
  let out = text
  for (const [re, repl] of REDACTION_PATTERNS) out = out.replace(re, repl)
  return out
}

interface ConversationRow {
  id: string
  role: string
  content: string
  created_at: string
}

interface SummaryJson {
  short: string
  long: string
  topics: string[]
}

export interface MaybeSummarizeResult {
  status: 'rate-limited' | 'no-window' | 'no-trigger' | 'inserted' | 'error'
  reason?: string
  summaryId?: string
  rangeStartAt?: string
  rangeEndAt?: string
  messageCount?: number
  costUsd?: number
}

let _anthropic: Anthropic | null = null
function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _anthropic
}

let _openai: OpenAI | null = null
function getOpenAI(): OpenAI | null {
  if (_openai) return _openai
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  _openai = new OpenAI({ apiKey })
  return _openai
}

// In-process rate-limit cache: thread_id → ts of last attempt. Survives one
// process lifetime; the DB query (last summary range_end_at) covers the
// cross-restart case.
const recentAttempt: Map<string, number> = new Map()

export async function maybeSummarize(threadId: string): Promise<MaybeSummarizeResult> {
  const sb = getSupabaseClient()
  if (!sb) return { status: 'error', reason: 'supabase_unavailable' }

  // 1. In-process rate-limit
  const last = recentAttempt.get(threadId)
  if (last && Date.now() - last < RATE_LIMIT_MS) {
    return { status: 'rate-limited' }
  }

  // 2. Find the boundary — most recent summary's range_end at + range_end_msg_id
  let lastSummaryEndAt: string | null = null
  let lastSummaryEndMsgId: string | null = null
  try {
    const { data } = await sb
      .from('atlas_chat_summaries')
      .select('range_end_msg_id, range_end_at')
      .eq('thread_id', threadId)
      .order('range_end_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) {
      lastSummaryEndAt = (data as { range_end_at: string }).range_end_at
      lastSummaryEndMsgId = (data as { range_end_msg_id: string }).range_end_msg_id
    }
  } catch {
    // Ignore — first run will produce no rows.
  }

  // DB-level rate-limit: don't summarize if last summary was <5 min ago.
  if (lastSummaryEndAt && Date.now() - new Date(lastSummaryEndAt).getTime() < RATE_LIMIT_MS) {
    return { status: 'rate-limited' }
  }

  // 3. Pull all messages newer than the last summary (or all messages if first run)
  let query = sb
    .from('atlas_conversations')
    .select('id, role, content, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(500)
  if (lastSummaryEndAt) {
    query = query.gt('created_at', lastSummaryEndAt)
  }
  const { data: rowsRaw, error: histErr } = await query
  if (histErr) return { status: 'error', reason: `history fetch: ${histErr.message}` }
  const rows = (rowsRaw ?? []) as ConversationRow[]
  if (rows.length === 0) return { status: 'no-window' }

  // 4. Trigger conditions
  const oldestAt = new Date(rows[0].created_at).getTime()
  const newestAt = new Date(rows[rows.length - 1].created_at).getTime()
  const ageMs = Date.now() - oldestAt
  if (ageMs < TRIGGER_WALL_CLOCK_MS && rows.length < TRIGGER_MIN_MESSAGES) {
    return { status: 'no-trigger' }
  }

  // 5. Mark the attempt before the LLM call so a slow Anthropic round-trip
  // can't be re-fired by a parallel chat turn.
  recentAttempt.set(threadId, Date.now())

  // 6. Build the prompt and call Haiku.
  const serialised = rows
    .map((r) => `[${r.role === 'atlas' ? 'assistant' : r.role}] ${redact(r.content || '').slice(0, 1500)}`)
    .join('\n\n')

  const system = `You are a chat summarizer. Summarize the following Atlas conductor chat segment. Output JSON only with shape:
{"short": string, "long": string, "topics": string[]}

Rules:
- "short": ≤80 words, third-person, single paragraph, no quotes.
- "long": ≤500 words, bullet points OK. Preserve technical detail (commit shas, spec ids like phase-1.10ar, error messages, file paths, decisions).
- "topics": ≤8 keywords (lowercase, hyphenated where multi-word).
- The user is the founder of CropsIntel running build agents through Atlas. Treat any "user" turn as the founder.
- Return JSON ONLY — no prose, no code fence.`

  let summaryJson: SummaryJson
  let costUsd = 0
  try {
    const resp = await getAnthropic().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      system,
      messages: [
        { role: 'user', content: `Conversation segment (${rows.length} messages):\n\n${serialised.slice(0, 80000)}` },
      ],
    })
    // Haiku 4.5 pricing: input $1/MTok, output $5/MTok.
    costUsd = (resp.usage.input_tokens / 1_000_000) * 1 + (resp.usage.output_tokens / 1_000_000) * 5
    const textBlock = resp.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return { status: 'error', reason: 'no_text_block' }
    }
    const raw = textBlock.text.trim()
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { status: 'error', reason: 'no_json_in_response' }
    const parsed = JSON.parse(jsonMatch[0]) as Partial<SummaryJson>
    if (!parsed.short || !parsed.long) return { status: 'error', reason: 'malformed_summary' }
    summaryJson = {
      short: redact(String(parsed.short)).slice(0, 600),
      long: redact(String(parsed.long)).slice(0, 4000),
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 8).map((t) => String(t)) : [],
    }
  } catch (err) {
    return { status: 'error', reason: err instanceof Error ? err.message : String(err) }
  }

  // 7. Insert the atlas_chat_summaries row.
  const startMsgId = lastSummaryEndMsgId === rows[0].id ? rows[0].id : rows[0].id
  // ^ when the previous summary ended exactly at our first row's predecessor,
  // we still start at rows[0]. Kept for clarity.
  const summaryRow = {
    thread_id: threadId,
    range_start_msg_id: startMsgId,
    range_end_msg_id: rows[rows.length - 1].id,
    range_start_at: new Date(oldestAt).toISOString(),
    range_end_at: new Date(newestAt).toISOString(),
    message_count: rows.length,
    summary_short: summaryJson.short,
    summary_long: summaryJson.long,
    topics: summaryJson.topics,
    cost_usd: costUsd,
  }

  const { data: inserted, error: insErr } = await sb
    .from('atlas_chat_summaries')
    .insert(summaryRow)
    .select('id')
    .single()
  if (insErr || !inserted) {
    return { status: 'error', reason: `summary insert: ${insErr?.message ?? 'no row'}` }
  }
  const summaryId = (inserted as { id: string }).id

  // 8. Embed summary_long and insert paired memory_chunks row. Best-effort —
  // a missing OPENAI_API_KEY or embedding failure must not lose the summary.
  let memoryChunkId: string | null = null
  try {
    const oai = getOpenAI()
    if (oai) {
      const embResp = await oai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: summaryJson.long,
        dimensions: EMBEDDING_DIMENSIONS,
      })
      const vec = embResp.data[0].embedding
      const { data: memRow, error: memErr } = await sb
        .from('memory_chunks')
        .insert({
          source: 'conversations',
          source_path: `atlas-chat:${threadId}`,
          source_section: summaryRow.range_start_at,
          content: summaryJson.long,
          chunk_index: Math.floor(Date.now() / 1000),
          metadata: {
            thread_id: threadId,
            range_start_at: summaryRow.range_start_at,
            range_end_at: summaryRow.range_end_at,
            summary_id: summaryId,
            topics: summaryJson.topics,
          },
          embedding: `[${vec.join(',')}]`,
          kind: 'chat-summary',
        })
        .select('id')
        .single()
      if (!memErr && memRow) {
        memoryChunkId = (memRow as { id: string }).id
        await sb.from('atlas_chat_summaries')
          .update({ memory_chunk_id: memoryChunkId })
          .eq('id', summaryId)
      }
    }
  } catch (err) {
    console.warn('[chat-summarizer] embedding/memory insert failed:', err)
  }

  return {
    status: 'inserted',
    summaryId,
    rangeStartAt: summaryRow.range_start_at,
    rangeEndAt: summaryRow.range_end_at,
    messageCount: rows.length,
    costUsd,
  }
}

// Recall — fetch the top-K chat-summary memory chunks scoped to a thread.
// Used by the chat handler when the user references "earlier"/"before" etc.
export interface ChatSummaryRecall {
  rangeStartAt: string
  rangeEndAt: string
  summaryLong: string
  similarity: number
}

export async function recallSummariesForQuery(params: {
  threadId: string
  query: string
  topK?: number
}): Promise<ChatSummaryRecall[]> {
  const { threadId, query, topK = 3 } = params
  const sb = getSupabaseClient()
  if (!sb) return []
  const oai = getOpenAI()
  if (!oai) return []

  let queryVec: number[]
  try {
    const embResp = await oai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query,
      dimensions: EMBEDDING_DIMENSIONS,
    })
    queryVec = embResp.data[0].embedding
  } catch (err) {
    console.warn('[chat-summarizer] recall embed failed:', err)
    return []
  }

  // Vector similarity search via the existing RPC. Filter by source so we
  // search only chat-summary chunks (we ingest them with source='conversations'
  // and source_path prefixed by atlas-chat:<threadId>).
  const { data, error } = await sb.rpc('search_memory_chunks', {
    query_embedding: `[${queryVec.join(',')}]`,
    source_filter: ['conversations'],
    match_count: 25,
  })
  if (error) {
    console.warn('[chat-summarizer] recall rpc failed:', error.message)
    return []
  }
  type Row = {
    source_path: string | null
    content: string
    metadata: Record<string, unknown>
    similarity: number
  }
  const rows = (data ?? []) as Row[]
  const filtered = rows.filter((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>
    if (meta.thread_id !== threadId) return false
    // Only chat-summary chunks have a `summary_id`.
    if (!('summary_id' in meta)) return false
    return r.source_path === `atlas-chat:${threadId}`
  })
  return filtered.slice(0, topK).map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>
    return {
      rangeStartAt: typeof meta.range_start_at === 'string' ? meta.range_start_at : '',
      rangeEndAt: typeof meta.range_end_at === 'string' ? meta.range_end_at : '',
      summaryLong: r.content,
      similarity: r.similarity,
    }
  })
}

// Lightweight heuristic — tells the chat handler whether to fire memory
// recall before calling Claude. Biased toward explicit reference words so it
// doesn't blow up token usage on every routine question.
const RECALL_WORD_RE = /\b(earlier|before|previously|remember|recall|yesterday|last (week|time|night)|what (did|were|was))\b/i

export function shouldRecall(message: string): boolean {
  if (!message) return false
  if (RECALL_WORD_RE.test(message)) return true
  // Fallback: a question (?) longer than 40 chars often implies the user is
  // looking back at context — but only if it doesn't look like a forward ask.
  const trimmed = message.trim()
  if (trimmed.length > 40 && trimmed.includes('?')) {
    // Avoid "can you do X?" / "could you Y?" — those are prospective.
    if (/^\s*(can|could|would|will|please|do|does|let'?s)\b/i.test(trimmed)) return false
    return true
  }
  return false
}

export function formatRecallSystemMessage(recalls: ChatSummaryRecall[]): string {
  if (recalls.length === 0) return ''
  const blocks = recalls
    .map((r) => {
      const tm = r.rangeStartAt ? new Date(r.rangeStartAt).toLocaleString() : ''
      return `[${tm}]\n${r.summaryLong}`
    })
    .join('\n\n')
  return `Earlier in this conversation:\n\n${blocks}`
}
