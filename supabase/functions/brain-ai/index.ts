// Phase 1.10aa — brain-ai Supabase edge function.
//
// POST /brain-ai
//   { action: 'debate',    node_id, prompt, context? }  → SSE stream
//   { action: 'consensus', node_id, thread_id }         → SSE stream
//
// SSE events:
//   data: {"type":"thread_started","thread_id":"<uuid>"}
//   data: {"type":"opinion_received","opinion":{...BrainOpinion}}
//   data: {"type":"consensus_received","consensus":{...BrainConsensus}}
//   data: {"type":"score_updated","before":n,"after":n}
//   data: {"type":"error","message":"..."}
//   data: [DONE]
//
// Auth: Supabase JWT required; user must have admin or team role.
// Rate limit: 3 debates per user per minute (debates are expensive).
// Cost log: every model call writes a row to atlas_cost_log.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

import type {
  BrainAiRequest,
  BrainConsensus,
  BrainOpinion,
  BrainNode,
} from './_shared/types.ts'
import {
  runDebate,
  runConsensus,
  providerToCostLogProvider,
  CONSENSUS_MODEL,
} from './_shared/multi-brain.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const RATE_LIMIT_PER_MIN = 3
const MAX_PROMPT_LEN = 8000

function sseEncode(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function userHasAdminOrTeamRole(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
  if (error || !data) return false
  return data.some((r) => r.role === 'admin' || r.role === 'team')
}

async function rateLimitOk(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await supabase
    .from('brain_discussions')
    .select('id', { count: 'exact', head: true })
    .eq('author', 'human')
    .eq('message_type', 'prompt')
    .gte('created_at', since)
    .filter('metadata->>user_id', 'eq', userId)
  return (count ?? 0) < RATE_LIMIT_PER_MIN
}

async function fetchNode(supabase: SupabaseClient, nodeId: string): Promise<BrainNode | null> {
  const { data, error } = await supabase
    .from('brain_nodes')
    .select('id, node_key, label, description, category, status, score, metadata')
    .eq('id', nodeId)
    .single()
  if (error || !data) return null
  return {
    ...data,
    score: Number(data.score ?? 0),
    metadata: (data.metadata as Record<string, unknown>) ?? {},
  }
}

async function recordCost(
  supabase: SupabaseClient,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('atlas_cost_log').insert({
      provider,
      service: 'brain-ai',
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      request_metadata: metadata,
    })
  } catch (err) {
    console.error('[brain-ai] cost log failed:', err)
  }
}

async function persistOpinion(
  supabase: SupabaseClient,
  nodeId: string,
  threadId: string,
  opinion: BrainOpinion,
): Promise<void> {
  const { error } = await supabase.from('brain_discussions').insert({
    node_id: nodeId,
    thread_id: threadId,
    author: opinion.provider,
    message_type: 'ai_analysis',
    content: opinion.error ? `[error: ${opinion.error}]` : opinion.content,
    cost_usd: opinion.costUsd,
    metadata: {
      model: opinion.model,
      input_tokens: opinion.inputTokens,
      output_tokens: opinion.outputTokens,
      duration_ms: opinion.durationMs,
      error: opinion.error ?? null,
    },
  })
  if (error) console.error('[brain-ai] persistOpinion failed:', error.message)
}

async function persistConsensus(
  supabase: SupabaseClient,
  nodeId: string,
  threadId: string,
  consensus: BrainConsensus,
): Promise<void> {
  const { error } = await supabase.from('brain_discussions').insert({
    node_id: nodeId,
    thread_id: threadId,
    author: 'consensus',
    message_type: 'consensus',
    content: consensus.verdict || consensus.content,
    cost_usd: consensus.costUsd,
    metadata: {
      model: consensus.model,
      verdict: consensus.verdict,
      score_delta: consensus.scoreDelta,
      score_reason: consensus.scoreReason,
      spec_ready_prompt: consensus.specReadyPrompt,
      input_tokens: consensus.inputTokens,
      output_tokens: consensus.outputTokens,
      duration_ms: consensus.durationMs,
      raw_judge_output: consensus.content,
    },
  })
  if (error) console.error('[brain-ai] persistConsensus failed:', error.message)
}

async function persistHumanPrompt(
  supabase: SupabaseClient,
  nodeId: string,
  threadId: string,
  userId: string,
  prompt: string,
  context: string | undefined,
): Promise<void> {
  const { error } = await supabase.from('brain_discussions').insert({
    node_id: nodeId,
    thread_id: threadId,
    author: 'human',
    message_type: 'prompt',
    content: prompt,
    cost_usd: 0,
    metadata: { user_id: userId, context: context ?? null },
  })
  if (error) console.error('[brain-ai] persistHumanPrompt failed:', error.message)
}

async function applyScoreChange(
  supabase: SupabaseClient,
  node: BrainNode,
  threadId: string,
  scoreDelta: number,
  reason: string,
): Promise<{ before: number; after: number } | null> {
  if (!Number.isFinite(scoreDelta) || scoreDelta === 0) return null
  const before = node.score
  const after = Math.max(0, Math.min(100, before + scoreDelta))
  if (after === before) return null

  const { error: updateErr } = await supabase
    .from('brain_nodes')
    .update({ score: after })
    .eq('id', node.id)
  if (updateErr) {
    console.error('[brain-ai] score update failed:', updateErr.message)
    return null
  }

  const { error: histErr } = await supabase.from('brain_node_history').insert({
    node_id: node.id,
    score_before: before,
    score_after: after,
    reason,
    changed_by: 'consensus',
    related_thread_id: threadId,
  })
  if (histErr) console.error('[brain-ai] history insert failed:', histErr.message)

  return { before, after }
}

async function fetchThreadOpinions(
  supabase: SupabaseClient,
  nodeId: string,
  threadId: string,
): Promise<{ prompt: string; context: string | undefined; opinions: BrainOpinion[] }> {
  const { data } = await supabase
    .from('brain_discussions')
    .select('author, message_type, content, metadata, cost_usd')
    .eq('node_id', nodeId)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })

  let prompt = ''
  let context: string | undefined
  const opinions: BrainOpinion[] = []
  for (const row of data ?? []) {
    const meta = (row.metadata as Record<string, unknown>) ?? {}
    if (row.message_type === 'prompt' && row.author === 'human') {
      prompt = row.content as string
      const ctx = meta.context
      if (typeof ctx === 'string') context = ctx
    } else if (row.message_type === 'ai_analysis' &&
      (row.author === 'claude' || row.author === 'openai' || row.author === 'gemini' || row.author === 'gpt')) {
      const provider: 'claude' | 'openai' | 'gemini' =
        row.author === 'claude' ? 'claude'
        : row.author === 'gemini' ? 'gemini'
        : 'openai'
      opinions.push({
        provider,
        model: typeof meta.model === 'string' ? meta.model : '',
        content: row.content as string,
        costUsd: Number(row.cost_usd ?? 0),
        inputTokens: typeof meta.input_tokens === 'number' ? meta.input_tokens : 0,
        outputTokens: typeof meta.output_tokens === 'number' ? meta.output_tokens : 0,
        durationMs: typeof meta.duration_ms === 'number' ? meta.duration_ms : 0,
        error: typeof meta.error === 'string' ? meta.error : undefined,
      })
    }
  }
  return { prompt, context, opinions }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError(405, 'method not allowed')

  const auth = req.headers.get('Authorization')
  if (!auth) return jsonError(401, 'unauthorized')

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonError(500, 'server misconfigured: supabase env')

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Verify caller
  const token = auth.replace(/^Bearer\s+/i, '')
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user) return jsonError(401, 'invalid session')
  const userId = userData.user.id

  // Admin/team gate
  const allowed = await userHasAdminOrTeamRole(supabase, userId)
  if (!allowed) return jsonError(403, 'forbidden: admin or team role required')

  let body: BrainAiRequest
  try {
    body = await req.json() as BrainAiRequest
  } catch {
    return jsonError(400, 'invalid json body')
  }

  if (!body || (body.action !== 'debate' && body.action !== 'consensus')) {
    return jsonError(400, 'action must be "debate" or "consensus"')
  }
  if (!body.node_id || typeof body.node_id !== 'string') {
    return jsonError(400, 'node_id required')
  }

  const node = await fetchNode(supabase, body.node_id)
  if (!node) return jsonError(404, 'node not found')

  // Build the SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (obj: unknown) => controller.enqueue(encoder.encode(sseEncode(obj)))
      const done = () => {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }

      try {
        if (body.action === 'debate') {
          const prompt = (body.prompt ?? '').trim()
          if (!prompt) {
            send({ type: 'error', message: 'prompt required for debate' })
            done()
            return
          }
          if (prompt.length > MAX_PROMPT_LEN) {
            send({ type: 'error', message: `prompt too long (${MAX_PROMPT_LEN} char max)` })
            done()
            return
          }

          if (!(await rateLimitOk(supabase, userId))) {
            send({ type: 'error', message: `rate limited: ${RATE_LIMIT_PER_MIN} debates per minute` })
            done()
            return
          }

          const threadId = crypto.randomUUID()
          send({ type: 'thread_started', thread_id: threadId })

          await persistHumanPrompt(supabase, node.id, threadId, userId, prompt, body.context)

          const opinions = await runDebate({
            nodeKey: node.node_key,
            nodeLabel: node.label,
            nodeDescription: node.description,
            currentScore: node.score,
            prompt,
            extraContext: body.context,
          })

          for (const op of opinions) {
            await persistOpinion(supabase, node.id, threadId, op)
            await recordCost(
              supabase,
              providerToCostLogProvider(op.provider),
              op.model,
              op.inputTokens,
              op.outputTokens,
              op.costUsd,
              { node_id: node.id, thread_id: threadId, role: 'opinion' },
            )
            send({ type: 'opinion_received', opinion: op })
          }

          if (opinions.length === 0) {
            send({ type: 'error', message: 'all three brains failed to respond' })
            done()
            return
          }

          const consensus = await runConsensus(
            {
              nodeKey: node.node_key,
              nodeLabel: node.label,
              nodeDescription: node.description,
              currentScore: node.score,
              prompt,
              extraContext: body.context,
            },
            opinions,
          )
          await persistConsensus(supabase, node.id, threadId, consensus)
          await recordCost(
            supabase,
            'openai',
            consensus.model,
            consensus.inputTokens,
            consensus.outputTokens,
            consensus.costUsd,
            { node_id: node.id, thread_id: threadId, role: 'consensus' },
          )
          send({ type: 'consensus_received', consensus })

          const scoreChange = await applyScoreChange(supabase, node, threadId, consensus.scoreDelta, consensus.scoreReason)
          if (scoreChange) {
            send({ type: 'score_updated', before: scoreChange.before, after: scoreChange.after })
          }

          done()
          return
        }

        // action === 'consensus' (re-run judge over an existing thread)
        const threadId = body.thread_id
        if (!threadId) {
          send({ type: 'error', message: 'thread_id required for consensus rerun' })
          done()
          return
        }

        const { prompt, context, opinions } = await fetchThreadOpinions(supabase, node.id, threadId)
        if (!prompt || opinions.length === 0) {
          send({ type: 'error', message: 'thread has no prompt or opinions to judge' })
          done()
          return
        }

        send({ type: 'thread_started', thread_id: threadId })
        for (const op of opinions) send({ type: 'opinion_received', opinion: op })

        const consensus = await runConsensus(
          {
            nodeKey: node.node_key,
            nodeLabel: node.label,
            nodeDescription: node.description,
            currentScore: node.score,
            prompt,
            extraContext: context,
          },
          opinions,
        )
        await persistConsensus(supabase, node.id, threadId, consensus)
        await recordCost(
          supabase,
          'openai',
          CONSENSUS_MODEL,
          consensus.inputTokens,
          consensus.outputTokens,
          consensus.costUsd,
          { node_id: node.id, thread_id: threadId, role: 'consensus_rerun' },
        )
        send({ type: 'consensus_received', consensus })

        const scoreChange = await applyScoreChange(supabase, node, threadId, consensus.scoreDelta, consensus.scoreReason)
        if (scoreChange) {
          send({ type: 'score_updated', before: scoreChange.before, after: scoreChange.after })
        }

        done()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        send({ type: 'error', message: msg })
        done()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
})
