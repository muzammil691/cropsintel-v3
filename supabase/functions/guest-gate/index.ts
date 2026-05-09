// Edge function: guest-gate (Phase 1.3b)
//
// Server-side authority for the anonymous-tier 10-deep-outputs gate. The
// frontend never decides whether a guest can see another deep output — this
// function does, against the guest_sessions table. That's required by the
// "information walls are load-bearing" rule from V3-CODING-INSTRUCTIONS §0.
//
// Endpoints (all relative to /functions/v1/guest-gate):
//   POST /start                — create a new guest_sessions row, return id + counters
//   POST /record-deep          — increment deep_outputs_count, return ok|gated
//   POST /record-basic         — increment basic_chat_count
//   GET  /state?guest_id=…     — return full state (for client rehydration)
//   POST /convert              — link guest_session to an authenticated user
//
// Routing is path-based: req.url is parsed, the last segment determines the op.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const DEEP_LIMIT = 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const op = segments[segments.length - 1]

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    if (op === 'start' && req.method === 'POST') {
      const body = await safeJson(req)
      const fingerprint = (body?.client_fingerprint as string | undefined) ?? null

      const { data, error } = await supabase
        .from('guest_sessions')
        .insert({
          client_fingerprint: fingerprint,
        })
        .select('id, deep_outputs_count, basic_chat_count')
        .single()

      if (error) return jsonError(500, error.message)

      return json({
        guest_id: data.id,
        deep_outputs_count: data.deep_outputs_count,
        basic_chat_count: data.basic_chat_count,
        limit: DEEP_LIMIT,
      })
    }

    if (op === 'record-deep' && req.method === 'POST') {
      const body = (await safeJson(req)) as { guest_id?: string }
      if (!body?.guest_id) return jsonError(400, 'guest_id is required')

      const { data: gs, error: readErr } = await supabase
        .from('guest_sessions')
        .select('deep_outputs_count')
        .eq('id', body.guest_id)
        .maybeSingle()

      if (readErr) return jsonError(500, readErr.message)
      if (!gs) return jsonError(404, 'guest session not found')

      const current = gs.deep_outputs_count ?? 0

      if (current >= DEEP_LIMIT) {
        return json({
          ok: false,
          gated: true,
          count: current,
          limit: DEEP_LIMIT,
        })
      }

      const next = current + 1
      const { error: updateErr } = await supabase
        .from('guest_sessions')
        .update({ deep_outputs_count: next, last_seen_at: new Date().toISOString() })
        .eq('id', body.guest_id)

      if (updateErr) return jsonError(500, updateErr.message)

      return json({
        ok: true,
        gated: next >= DEEP_LIMIT,
        count: next,
        limit: DEEP_LIMIT,
      })
    }

    if (op === 'record-basic' && req.method === 'POST') {
      const body = (await safeJson(req)) as { guest_id?: string }
      if (!body?.guest_id) return jsonError(400, 'guest_id is required')

      const { data: gs } = await supabase
        .from('guest_sessions')
        .select('basic_chat_count')
        .eq('id', body.guest_id)
        .maybeSingle()

      const next = (gs?.basic_chat_count ?? 0) + 1
      const { error } = await supabase
        .from('guest_sessions')
        .update({ basic_chat_count: next, last_seen_at: new Date().toISOString() })
        .eq('id', body.guest_id)

      if (error) return jsonError(500, error.message)

      return json({ ok: true, count: next })
    }

    if (op === 'state' && req.method === 'GET') {
      const guestId = url.searchParams.get('guest_id')
      if (!guestId) return jsonError(400, 'guest_id query param is required')

      const { data, error } = await supabase
        .from('guest_sessions')
        .select(
          'id, deep_outputs_count, basic_chat_count, role_inferred, geography_country_inferred, conversation_history, converted_to_user, started_at, last_seen_at',
        )
        .eq('id', guestId)
        .maybeSingle()

      if (error) return jsonError(500, error.message)
      if (!data) return jsonError(404, 'guest session not found')

      return json({
        guest_id: data.id,
        deep_outputs_count: data.deep_outputs_count,
        basic_chat_count: data.basic_chat_count,
        role_inferred: data.role_inferred,
        geography_country_inferred: data.geography_country_inferred,
        conversation_history: data.conversation_history,
        converted_to_user: data.converted_to_user,
        started_at: data.started_at,
        last_seen_at: data.last_seen_at,
        limit: DEEP_LIMIT,
      })
    }

    if (op === 'convert' && req.method === 'POST') {
      const body = (await safeJson(req)) as { guest_id?: string; user_id?: string }
      if (!body?.guest_id || !body?.user_id) {
        return jsonError(400, 'guest_id and user_id are required')
      }

      // Pull the conversation_history off the guest_session for migration
      const { data: gs, error: readErr } = await supabase
        .from('guest_sessions')
        .select('conversation_history, role_inferred, geography_country_inferred')
        .eq('id', body.guest_id)
        .maybeSingle()
      if (readErr) return jsonError(500, readErr.message)

      // Mark the guest_session as converted
      const { error: updateErr } = await supabase
        .from('guest_sessions')
        .update({
          converted_to_user: body.user_id,
          converted_at: new Date().toISOString(),
        })
        .eq('id', body.guest_id)
      if (updateErr) return jsonError(500, updateErr.message)

      // Seed a chat_session for the now-authenticated user with the prior history
      if (gs?.conversation_history) {
        await supabase.from('chat_sessions').insert({
          user_id: body.user_id,
          conversation_history: gs.conversation_history,
          role_active: gs.role_inferred,
          geography_country: gs.geography_country_inferred,
        })
      }

      return json({ ok: true })
    }

    return jsonError(404, `Unknown op: ${op}`)
  } catch (err) {
    console.error('guest-gate error:', err)
    return jsonError(500, 'Internal server error')
  }
})

async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function jsonError(status: number, message: string) {
  return json({ error: message }, status)
}
