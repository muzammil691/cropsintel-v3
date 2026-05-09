// Edge function: zyra-chat (Phase 1.3b — placeholder for Phase 1.10 R1 agent)
//
// Master plan §9.2 row R1: Zyra is the customer-facing chat agent. Phase 1.10
// ships the real 13-module Zyra (defensive 9 + behavioral 4 per master plan
// v1.4) with Claude Sonnet 4 default and ElevenLabs voice. This 1.3b stub
// keeps the wire shape stable so the swap is mechanical: same request body,
// same response fields, same audit-log writes.
//
// Why this lives here (NOT in atlas/src/server.ts): per master plan §10, Zyra
// is customer-facing and must terminate at Supabase edge functions on the
// cropsintel.com path. atlas/src/server.ts is internal infra (Atlas conductor
// for the build loop), not a customer surface.
//
// What it does for 1.3b:
//   • Detects "deep" content via keyword match
//   • Returns a canned "[Phase 1.10 will give you the real intelligence]" reply
//   • Infers role + geography via simple keyword heuristics (Phase 1.10
//     replaces this with Claude classification)
//   • Returns upgrade_pitch when guest hits 10 deep outputs
//   • Returns verified_upgrade_pitch when registered user asks for
//     execution-grade intel ("real-time", "live", "supplier names",
//     "position report")
//   • Persists conversation + counters via the same DB tables guest-gate uses

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  is_deep_output?: boolean
  upgrade_pitch?: UpgradePitch | null
  verified_upgrade_pitch?: VerifiedUpgradePitch | null
  ts?: string
}

interface ZyraRequest {
  guest_id?: string
  user_id?: string
  message: string
  conversation_history?: Message[]
  is_starter?: boolean
}

interface UpgradePitch {
  kind: 'guest_to_registered'
  email_url: string
  whatsapp_url: string
  message: string
}

interface VerifiedUpgradePitch {
  kind: 'registered_to_verified'
  cta_url: string
  message: string
}

const DEEP_KEYWORDS = [
  'price', 'prices', 'pricing',
  'supplier', 'suppliers',
  'buyer', 'buyers',
  'market', 'markets',
  'forecast',
  'india', 'us ', 'usa', 'united states', 'china', 'spain', 'australia',
  'packer', 'packers',
  'broker', 'brokers',
  'arbitrage',
  'position', 'position report',
  'yield', 'yields',
  'tariff', 'tariffs',
  'export', 'exports', 'exporting',
  'import', 'imports', 'importing',
  'crop', 'shipment', 'shipments',
]

const EXEC_GRADE_KEYWORDS = [
  'real-time', 'realtime', 'real time',
  'live',
  'supplier name', 'supplier names',
  'position report',
  'specific supplier', 'who is selling', 'who is buying',
]

const ROLE_KEYWORDS: Record<string, string[]> = {
  customer: ['buying', 'importing', 'buyer', 'importer', 'procurement', 'sourcing', 'roaster', 'distributor'],
  packer: ['exporting', 'packer', 'exporter', 'producing', 'farm', 'grower', 'co-op', 'coop', 'huller'],
  broker: ['broker', 'brokering', 'arbitrage', 'flipping', 'trading', 'spread', 'market maker'],
}

const COUNTRY_KEYWORDS: Record<string, string[]> = {
  India: ['india', 'mumbai', 'delhi', 'chennai', 'kolkata', 'bangalore'],
  'United States': ['usa', 'united states', 'california', 'us ', 'us,', 'us.', 'kerman', 'modesto', 'fresno'],
  China: ['china', 'shanghai', 'beijing', 'shenzhen', 'guangzhou'],
  Spain: ['spain', 'madrid', 'barcelona', 'valencia'],
  Australia: ['australia', 'sydney', 'melbourne', 'adelaide'],
  'United Arab Emirates': ['uae', 'dubai', 'abu dhabi', 'sharjah', 'united arab emirates'],
  Germany: ['germany', 'hamburg', 'frankfurt', 'munich'],
  'United Kingdom': ['uk ', 'united kingdom', 'london', 'manchester'],
  Turkey: ['turkey', 'istanbul', 'izmir'],
}

function detectDeep(message: string): boolean {
  const lower = ` ${message.toLowerCase()} `
  return DEEP_KEYWORDS.some((k) => lower.includes(k))
}

function detectExecGrade(message: string): boolean {
  const lower = message.toLowerCase()
  return EXEC_GRADE_KEYWORDS.some((k) => lower.includes(k))
}

function inferRole(message: string): string | null {
  const lower = message.toLowerCase()
  for (const [role, keywords] of Object.entries(ROLE_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return role
  }
  return null
}

function inferCountry(message: string): string | null {
  const lower = ` ${message.toLowerCase()} `
  for (const [country, keywords] of Object.entries(COUNTRY_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return country
  }
  return null
}

function buildPlaceholderReply(message: string, isDeep: boolean): string {
  if (!isDeep) {
    return "I track almond markets globally — pricing, supply, demand, freight, the works. Tell me what you're working on (buying for a region, packing for export, brokering arbitrage, or just exploring) and I'll point you at what matters."
  }
  // Canned deep-output reply (Phase 1.10 swaps this for the real 13-module brain)
  return `[Phase 1.10 will give you the real intelligence here.] For now: your question — "${truncate(message, 80)}" — touches the data spine that Adela (R2) is being wired to in Phase 1.6. Once the live Almond Board, USDA NASS, USDA AMS and broker feeds are flowing, I'll give you a direct, opinionated read on where the market is going.`
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

function buildUpgradePitch(): UpgradePitch {
  return {
    kind: 'guest_to_registered',
    email_url: '/auth?mode=register&method=email&from=landing',
    whatsapp_url: '/auth?mode=register&method=whatsapp&from=landing',
    message:
      "I see you're getting real value here — you've used your 10 deep insights. Quick signup unlocks unlimited insights and saves your conversation history. Email or WhatsApp?",
  }
}

function buildVerifiedUpgradePitch(): VerifiedUpgradePitch {
  return {
    kind: 'registered_to_verified',
    cta_url: '/upgrade',
    message:
      "This needs verified-tier access — real-time prices, supplier names, position reports. I can put you in the queue. Tap below and someone from Maxons will follow up within 24 hours.",
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed')
  }

  try {
    const body = (await req.json()) as ZyraRequest
    const message = (body.message ?? '').trim()
    if (!message) return jsonError(400, 'message is required')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const isDeep = detectDeep(message)
    const isExecGrade = detectExecGrade(message)
    const roleInferred = inferRole(message)
    const countryInferred = inferCountry(message)

    let upgradePitch: UpgradePitch | null = null
    let verifiedUpgradePitch: VerifiedUpgradePitch | null = null
    let gated = false
    let deepCount = 0

    // Tier inference: if user_id present, look up their tier; else treat as guest
    let userTier: 'guest' | 'registered' | 'verified' | 'maxons_team' = 'guest'
    if (body.user_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tier')
        .eq('id', body.user_id)
        .maybeSingle()
      userTier = (profile?.tier as typeof userTier) ?? 'registered'
    }

    // Guest path — enforce the 10-deep gate
    if (userTier === 'guest' && body.guest_id) {
      const { data: gs } = await supabase
        .from('guest_sessions')
        .select('deep_outputs_count, basic_chat_count, conversation_history')
        .eq('id', body.guest_id)
        .maybeSingle()

      const currentDeepCount = gs?.deep_outputs_count ?? 0

      if (isDeep && currentDeepCount >= 10) {
        gated = true
        upgradePitch = buildUpgradePitch()
      }

      // Update counters + conversation history
      const newDeep = isDeep && !gated ? currentDeepCount + 1 : currentDeepCount
      const newBasic = isDeep ? (gs?.basic_chat_count ?? 0) : (gs?.basic_chat_count ?? 0) + 1
      deepCount = newDeep

      const reply = gated ? buildPlaceholderReply(message, false) : buildPlaceholderReply(message, isDeep)
      const newHistory: Message[] = [
        ...((gs?.conversation_history as Message[] | null) ?? []),
        { role: 'user', content: message, ts: new Date().toISOString() },
        {
          role: 'assistant',
          content: reply,
          is_deep_output: isDeep && !gated,
          upgrade_pitch: upgradePitch,
          ts: new Date().toISOString(),
        },
      ]

      const updates: Record<string, unknown> = {
        deep_outputs_count: newDeep,
        basic_chat_count: newBasic,
        last_seen_at: new Date().toISOString(),
        conversation_history: newHistory,
      }
      if (roleInferred) updates.role_inferred = roleInferred
      if (countryInferred) updates.geography_country_inferred = countryInferred

      await supabase.from('guest_sessions').update(updates).eq('id', body.guest_id)

      return json({
        response: reply,
        is_deep_output: isDeep && !gated,
        gated,
        deep_outputs_count: newDeep,
        deep_outputs_limit: 10,
        role_inferred: roleInferred,
        geography_inferred: countryInferred,
        upgrade_pitch: upgradePitch,
        verified_upgrade_pitch: null,
      })
    }

    // Registered path — execution-grade keywords trigger verified-tier pitch
    if (userTier === 'registered' && isExecGrade) {
      verifiedUpgradePitch = buildVerifiedUpgradePitch()
    }

    // Registered/verified — persist to chat_sessions
    if (body.user_id) {
      const reply = buildPlaceholderReply(message, isDeep)
      // Find or create chat_session for today's conversation
      const { data: existing } = await supabase
        .from('chat_sessions')
        .select('id, conversation_history, deep_outputs_count')
        .eq('user_id', body.user_id)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const newHistory: Message[] = [
        ...((existing?.conversation_history as Message[] | null) ?? []),
        { role: 'user', content: message, ts: new Date().toISOString() },
        {
          role: 'assistant',
          content: reply,
          is_deep_output: isDeep,
          verified_upgrade_pitch: verifiedUpgradePitch,
          ts: new Date().toISOString(),
        },
      ]

      const newDeep = (existing?.deep_outputs_count ?? 0) + (isDeep ? 1 : 0)
      deepCount = newDeep

      if (existing) {
        await supabase
          .from('chat_sessions')
          .update({
            last_message_at: new Date().toISOString(),
            conversation_history: newHistory,
            deep_outputs_count: newDeep,
            ...(roleInferred ? { role_active: roleInferred } : {}),
            ...(countryInferred ? { geography_country: countryInferred } : {}),
          })
          .eq('id', existing.id)
      } else {
        await supabase.from('chat_sessions').insert({
          user_id: body.user_id,
          conversation_history: newHistory,
          deep_outputs_count: newDeep,
          role_active: roleInferred,
          geography_country: countryInferred,
        })
      }

      return json({
        response: reply,
        is_deep_output: isDeep,
        gated: false,
        deep_outputs_count: newDeep,
        deep_outputs_limit: null,
        role_inferred: roleInferred,
        geography_inferred: countryInferred,
        upgrade_pitch: null,
        verified_upgrade_pitch: verifiedUpgradePitch,
      })
    }

    // Fallback — no guest_id and no user_id (e.g., greeting before session start)
    const reply = buildPlaceholderReply(message, isDeep)
    return json({
      response: reply,
      is_deep_output: isDeep,
      gated: false,
      deep_outputs_count: deepCount,
      deep_outputs_limit: 10,
      role_inferred: roleInferred,
      geography_inferred: countryInferred,
      upgrade_pitch: null,
      verified_upgrade_pitch: null,
    })
  } catch (err) {
    console.error('zyra-chat error:', err)
    return jsonError(500, 'Internal server error')
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function jsonError(status: number, message: string) {
  return json({ error: message }, status)
}
