// Phase 1.10ac — pd-ai-review Supabase edge function.
//
// POST /pd-ai-review { proposal_id }  → JSON
//   { verdict, reasoning, gaps[], cost_usd, ai_model }
//
// Reads pd_proposals row, sends a scoring rubric prompt to Claude Opus 4.7,
// parses its structured response (verdict + 1-paragraph reasoning + gap list),
// persists to pd_auto_validation, logs cost to atlas_cost_log, and returns the
// row to the caller.
//
// Auth: Supabase JWT required; user must have admin or team role.
// Rate limit: 8 reviews per user per 5 minutes (cheaper than brain debate
// but still costs ~$0.04 per call — guardrail against hammering).
//
// Per master plan section 10: AI keys SERVER-SIDE only. Never VITE_*.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.40.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const REVIEW_MODEL = 'claude-opus-4-7'
const MAX_TOKENS = 1500
const TIMEOUT_MS = 60_000
const RATE_LIMIT_PER_5MIN = 8

// Token pricing per 1M tokens for claude-opus-4-7 (kept in sync with brain-ai).
const PRICE_IN = 3.0
const PRICE_OUT = 15.0

interface PdProposalRow {
  id: string
  title: string
  description: string
  motivation: string | null
  status: string
  related_phase: string | null
}

interface ReviewResult {
  verdict: 'pass' | 'needs-work' | 'reject'
  reasoning: string
  gaps: string[]
  cost_usd: number
  input_tokens: number
  output_tokens: number
  duration_ms: number
}

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
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
  return data.some((r: { role: string }) => r.role === 'admin' || r.role === 'team')
}

async function rateLimitOk(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 5 * 60_000).toISOString()
  const { count } = await supabase
    .from('pd_auto_validation')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
    .filter('reasoning', 'not.is', null)
    // We don't have a user_id column on pd_auto_validation — use a global cap.
    // Per-user rate limiting would need a separate audit log; for v0 a global
    // 5-min cap is sufficient guardrail.
  void userId
  return (count ?? 0) < RATE_LIMIT_PER_5MIN
}

async function fetchProposal(supabase: SupabaseClient, id: string): Promise<PdProposalRow | null> {
  const { data, error } = await supabase
    .from('pd_proposals')
    .select('id, title, description, motivation, status, related_phase')
    .eq('id', id)
    .single()
  if (error || !data) return null
  return data as PdProposalRow
}

const SYSTEM_PROMPT = `You are a strict project-development reviewer for the CropsIntel V3 platform.

Score the proposal against four criteria:
1. CLARITY  — is the title + description specific enough for a builder agent to act on without follow-up questions?
2. SCOPE    — is the scope bounded (a single deliverable), not a multi-feature wish-list?
3. DEPENDENCIES — does it state what foundation tables / phases must exist first? Does it respect the master plan's foundation-first rule?
4. NEVER-LIST COMPLIANCE — does it avoid: VITE_* AI keys, parallel implementations next to broken ones, missing commodity_id FK, breaking information walls, posting financial actions to BC?

Return ONLY a JSON object — no prose, no markdown fences:
{
  "verdict": "pass" | "needs-work" | "reject",
  "reasoning": "<one paragraph, ≤120 words>",
  "gaps": ["<concise gap 1>", "<concise gap 2>", ...]
}

Verdict rules:
- "pass"       — all four criteria clearly met. gaps may be empty or minor (≤2 items).
- "needs-work" — criteria mostly met but at least one specific gap to fix before build.
- "reject"     — fails a fundamental rule (NEVER-list violation, foundation missing, scope unclear).`

async function callClaude(proposal: PdProposalRow, apiKey: string): Promise<ReviewResult> {
  const start = Date.now()
  const client = new Anthropic({ apiKey })
  const userPrompt = [
    `Title: ${proposal.title}`,
    proposal.related_phase ? `Related phase: ${proposal.related_phase}` : '',
    proposal.motivation ? `Motivation: ${proposal.motivation}` : '',
    '',
    'Description:',
    proposal.description,
  ].filter(Boolean).join('\n')

  const res = await Promise.race([
    client.messages.create({
      model: REVIEW_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('claude timeout')), TIMEOUT_MS)),
  ])

  const block = res.content[0]
  const raw = block && block.type === 'text' ? block.text : ''
  const inputTokens = res.usage.input_tokens
  const outputTokens = res.usage.output_tokens
  const cost = (inputTokens / 1_000_000) * PRICE_IN + (outputTokens / 1_000_000) * PRICE_OUT

  // Parse the JSON object out of Claude's response. Claude may wrap in fences
  // despite instructions — strip them defensively.
  let parsed: { verdict?: string; reasoning?: string; gaps?: string[] } = {}
  try {
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd < 0 || jsonEnd <= jsonStart) {
      throw new Error('no JSON object in response')
    }
    parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
  } catch (err) {
    console.error('[pd-ai-review] parse failed:', err, 'raw=', raw.slice(0, 200))
    throw new Error(`AI returned malformed JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const verdictRaw = String(parsed.verdict ?? '').toLowerCase()
  const verdict: ReviewResult['verdict'] =
    verdictRaw === 'pass' ? 'pass' :
    verdictRaw === 'reject' ? 'reject' : 'needs-work'

  return {
    verdict,
    reasoning: String(parsed.reasoning ?? '').slice(0, 2000),
    gaps: Array.isArray(parsed.gaps)
      ? parsed.gaps.map((g) => String(g).slice(0, 280)).slice(0, 12)
      : [],
    cost_usd: cost,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    duration_ms: Date.now() - start,
  }
}

async function persistValidation(
  supabase: SupabaseClient,
  proposalId: string,
  result: ReviewResult,
): Promise<{ id: string; created_at: string } | null> {
  const { data, error } = await supabase
    .from('pd_auto_validation')
    .insert({
      proposal_id: proposalId,
      verdict: result.verdict,
      ai_model: REVIEW_MODEL,
      reasoning: result.reasoning,
      gaps: result.gaps,
      cost_usd: result.cost_usd,
    })
    .select('id, created_at')
    .single()
  if (error) {
    console.error('[pd-ai-review] persist failed:', error)
    return null
  }
  return data as { id: string; created_at: string }
}

async function logCost(supabase: SupabaseClient, result: ReviewResult, proposalId: string): Promise<void> {
  try {
    await supabase.from('atlas_cost_log').insert({
      provider: 'anthropic',
      service: 'pd-ai-review',
      model: REVIEW_MODEL,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      cost_usd: result.cost_usd,
      request_metadata: { proposal_id: proposalId, verdict: result.verdict, duration_ms: result.duration_ms },
    })
  } catch (err) {
    console.error('[pd-ai-review] cost log failed:', err)
  }
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno?.serve?.(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResp(405, { error: 'method not allowed' })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return jsonResp(500, { error: 'ANTHROPIC_API_KEY not configured' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return jsonResp(401, { error: 'missing bearer token' })

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return jsonResp(401, { error: 'invalid session' })

  const serviceClient = createClient(supabaseUrl, serviceKey)
  const allowed = await userHasAdminOrTeamRole(serviceClient, user.id)
  if (!allowed) return jsonResp(403, { error: 'admin or team role required' })

  const ok = await rateLimitOk(serviceClient, user.id)
  if (!ok) return jsonResp(429, { error: `rate limit: ${RATE_LIMIT_PER_5MIN} reviews per 5 minutes` })

  let body: { proposal_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResp(400, { error: 'invalid JSON body' })
  }
  const proposalId = body.proposal_id
  if (!proposalId || typeof proposalId !== 'string') {
    return jsonResp(400, { error: 'proposal_id required' })
  }

  const proposal = await fetchProposal(serviceClient, proposalId)
  if (!proposal) return jsonResp(404, { error: 'proposal not found' })

  let result: ReviewResult
  try {
    result = await callClaude(proposal, apiKey)
  } catch (err) {
    console.error('[pd-ai-review] claude call failed:', err)
    return jsonResp(502, { error: err instanceof Error ? err.message : String(err) })
  }

  const persisted = await persistValidation(serviceClient, proposalId, result)
  await logCost(serviceClient, result, proposalId)

  return jsonResp(200, {
    id: persisted?.id ?? null,
    proposal_id: proposalId,
    verdict: result.verdict,
    reasoning: result.reasoning,
    gaps: result.gaps,
    cost_usd: result.cost_usd,
    ai_model: REVIEW_MODEL,
    created_at: persisted?.created_at ?? new Date().toISOString(),
  })
})

// Type shim so this file type-checks under tsc when included in the React
// build. The Deno global is available at runtime in the edge function.
declare const Deno: {
  env: { get(name: string): string | undefined }
  serve?: (handler: (req: Request) => Response | Promise<Response>) => void
}
