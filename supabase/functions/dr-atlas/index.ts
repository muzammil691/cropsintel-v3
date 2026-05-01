// Phase 1.10z — dr-atlas Supabase edge function.
//
// POST { thread_id, message, page_path } → SSE stream of `data: {"delta":"…"}`
// chunks ending with `data: [DONE]`.
//
// Routes Claude Sonnet 4.6. System prompt is grounded in the V3 master plan
// summary and explicit honesty rules (V1 Atlas hardening). Caller JWT is
// required; we verify it and use the user_id for per-user rate limiting and
// cost logging via atlas_events.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.40.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SYSTEM_PROMPT = `You are Dr. Atlas — the helper assistant inside CropsIntel V3, a market-intelligence platform for the global almond trade (multi-commodity from Day 1).

Your role is to help users understand and use CropsIntel. You are not a trading advisor. Speak concisely, in plain English, and never fabricate facts.

# What CropsIntel V3 is (master plan §1.6)
- A layered system: Adela (data ingest), Brain AI (analysis), Atlas (self-management), Zyra (customer chat), and per-tier UIs (guest → registered → verified → maxons_team → admin).
- Information walls are load-bearing: suppliers see pricing/demand; brokers see margin targets; customers see only their own pricing. Never mix.
- AI keys are server-side only. The frontend never holds Claude/Gemini/OpenAI keys.

# Honesty rules (NON-NEGOTIABLE)
1. If you do not know something, say "I don't know" — do not invent.
2. If you reference a feature, table, page, or file, only do so if the user has clearly mentioned it in this conversation OR it appears in your system context.
3. If a user asks about data values (prices, counts, dates), say you cannot see live data from this chat surface and suggest where they could look (the relevant page).
4. Quote user words verbatim when confirming what they asked — don't paraphrase into stronger claims.
5. End every substantive answer with a short verified-source footer line indicating what your answer was grounded in (e.g. "Source: master plan §1.6" or "Source: general CropsIntel knowledge — please verify in the app").

# Style
- Markdown allowed. Keep responses under ~250 words unless the user explicitly asks for more.
- Use bullets sparingly; prefer prose for short answers.
- If the user pushes back ("that's wrong", "no"), acknowledge, ask one clarifying question, and adjust — do NOT double down.

# When to escalate
- If the user reports a bug, ask them to capture the page path and a one-line description and tell them the team will see it via Atlas events.
- If the user asks about pricing/billing/account changes, point them at /upgrade.
- If the user asks about something outside CropsIntel scope, gently redirect.`

interface Body {
  thread_id?: string
  message?: string
  page_path?: string
}

function sseEncode(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

function errorStream(message: string, status = 400): Response {
  const body = sseEncode({ error: message }) + 'data: [DONE]\n\n'
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const auth = req.headers.get('Authorization')
  if (!auth) return errorStream('unauthorized', 401)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  if (!SUPABASE_URL || !SERVICE_ROLE) return errorStream('server misconfigured: supabase env', 500)
  if (!ANTHROPIC_API_KEY) return errorStream('server misconfigured: anthropic key', 500)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Verify caller
  const token = auth.replace(/^Bearer\s+/i, '')
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user) return errorStream('invalid session', 401)
  const userId = userData.user.id

  let body: Body
  try {
    body = await req.json()
  } catch {
    return errorStream('invalid json body', 400)
  }
  const message = (body.message ?? '').trim()
  if (!message) return errorStream('message required', 400)
  if (message.length > 4000) return errorStream('message too long (4000 char max)', 400)

  // Per-user rate limit: 5 messages per 60s window via atlas_events.
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count: recentCount } = await supabase
    .from('atlas_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', 'dr_atlas_user_message')
    .gte('created_at', since)
  if ((recentCount ?? 0) >= 5) {
    return errorStream('rate limited: 5 messages per minute', 429)
  }

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const pagePath = (body.page_path ?? '').slice(0, 200)
  const threadId = (body.thread_id ?? '').slice(0, 100)

  const userContext = `User is currently on page: ${pagePath || 'unknown'}.\nThread id: ${threadId || 'none'}.`

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk))
      try {
        const response = await anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: `${SYSTEM_PROMPT}\n\n# Current session context\n${userContext}`,
          messages: [{ role: 'user', content: message }],
        })

        for await (const event of response) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            send(sseEncode({ delta: event.delta.text }))
          }
        }

        const final = await response.finalMessage()
        // Cost log (best-effort, never block the response)
        const usage = final.usage
        void supabase.from('atlas_events').insert({
          event_type: 'dr_atlas_cost',
          event_category: 'ai',
          source: 'dr_atlas',
          description: `model=claude-sonnet-4-6 in=${usage?.input_tokens ?? 0} out=${usage?.output_tokens ?? 0}`,
          severity: 'info',
          metadata: {
            input_tokens: usage?.input_tokens ?? 0,
            output_tokens: usage?.output_tokens ?? 0,
            thread_id: threadId,
          },
          user_id: userId,
          page_path: pagePath,
        })

        send('data: [DONE]\n\n')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'stream failed'
        send(sseEncode({ error: msg }))
        send('data: [DONE]\n\n')
      } finally {
        controller.close()
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
