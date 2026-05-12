// 1.10bb-c Session 9A — provider test registry.
//
// Each entry maps a `provider` string from atlas_connections.provider to a
// pure async test fn that hits the provider's "is this token live?" endpoint.
// All return the same shape so the route handler doesn't need per-provider
// branching:
//
//   { ok: boolean, identity?: string, scopes?: string[], error?: string, status?: number }
//
// Conventions:
//   • No SDK deps — raw fetch() against documented REST endpoints so the
//     atlas bundle stays light and these can run from anywhere.
//   • 8s timeout per request (AbortController) so a hung provider doesn't
//     block the route's response window.
//   • Errors are returned via { ok:false, error, status } — never thrown.
//   • identity / scopes are best-effort: pulled from the response when
//     available, omitted otherwise.

const TIMEOUT_MS = 8000

export interface ProviderTestResult {
  ok: boolean
  identity?: string
  scopes?: string[]
  error?: string
  status?: number
}

export interface ProviderTestInput {
  apiKey?: string
  // Multi-field providers (Twilio = sid+token; Supabase = mgmt_key+optional ref).
  meta?: Record<string, string>
}

export type ProviderTestFn = (input: ProviderTestInput) => Promise<ProviderTestResult>

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function networkError(err: unknown): ProviderTestResult {
  const message = err instanceof Error ? err.message : String(err)
  const aborted = err instanceof Error && err.name === 'AbortError'
  return {
    ok: false,
    error: aborted ? `Timed out after ${TIMEOUT_MS}ms — provider not reachable.` : message,
  }
}

// ─── Anthropic ───────────────────────────────────────────────────────────
const testAnthropic: ProviderTestFn = async ({ apiKey }) => {
  if (!apiKey) return { ok: false, error: 'api_key required' }
  try {
    const res = await timedFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
    if (res.ok) {
      return { ok: true, identity: 'anthropic-key', status: res.status }
    }
    const detail = await res.text().catch(() => '')
    return {
      ok: false,
      status: res.status,
      error: res.status === 401 ? 'Anthropic returned 401 — likely an expired or revoked key.' : detail.slice(0, 300),
    }
  } catch (err) {
    return networkError(err)
  }
}

// ─── OpenAI ──────────────────────────────────────────────────────────────
const testOpenAI: ProviderTestFn = async ({ apiKey }) => {
  if (!apiKey) return { ok: false, error: 'api_key required' }
  try {
    const res = await timedFetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as { data?: Array<{ id: string }> }
      const modelCount = body.data?.length ?? 0
      return { ok: true, identity: `openai-key (${modelCount} models visible)`, status: res.status }
    }
    return { ok: false, status: res.status, error: res.status === 401 ? 'OpenAI returned 401 — invalid API key.' : (await res.text().catch(() => '')).slice(0, 300) }
  } catch (err) {
    return networkError(err)
  }
}

// ─── Gemini ──────────────────────────────────────────────────────────────
const testGemini: ProviderTestFn = async ({ apiKey }) => {
  if (!apiKey) return { ok: false, error: 'api_key required' }
  try {
    const res = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
    })
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as { models?: unknown[] }
      const count = body.models?.length ?? 0
      return { ok: true, identity: `gemini-key (${count} models visible)`, status: res.status }
    }
    return { ok: false, status: res.status, error: res.status === 400 || res.status === 403 ? 'Gemini rejected the key — re-check it under aistudio.google.com.' : (await res.text().catch(() => '')).slice(0, 300) }
  } catch (err) {
    return networkError(err)
  }
}

// ─── GitHub PAT ──────────────────────────────────────────────────────────
const testGitHub: ProviderTestFn = async ({ apiKey }) => {
  if (!apiKey) return { ok: false, error: 'pat required' }
  try {
    const res = await timedFetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as { login?: string }
      const scopesHdr = res.headers.get('x-oauth-scopes') ?? ''
      const scopes = scopesHdr.split(',').map((s) => s.trim()).filter(Boolean)
      return { ok: true, identity: body.login ? `@${body.login}` : 'github-user', scopes, status: res.status }
    }
    return { ok: false, status: res.status, error: res.status === 401 ? 'GitHub returned 401 — PAT is invalid or revoked. Generate a new one at github.com/settings/tokens.' : (await res.text().catch(() => '')).slice(0, 300) }
  } catch (err) {
    return networkError(err)
  }
}

// ─── Vercel ──────────────────────────────────────────────────────────────
const testVercel: ProviderTestFn = async ({ apiKey, meta }) => {
  if (!apiKey) return { ok: false, error: 'token required' }
  try {
    const teamId = meta?.team_id
    const url = teamId
      ? `https://api.vercel.com/v2/user?teamId=${encodeURIComponent(teamId)}`
      : 'https://api.vercel.com/v2/user'
    const res = await timedFetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as { user?: { username?: string; email?: string } }
      return { ok: true, identity: body.user?.username ?? body.user?.email ?? 'vercel-user', status: res.status }
    }
    return { ok: false, status: res.status, error: res.status === 403 ? 'Vercel returned 403 — token lacks scope for this team.' : (await res.text().catch(() => '')).slice(0, 300) }
  } catch (err) {
    return networkError(err)
  }
}

// ─── Netlify ─────────────────────────────────────────────────────────────
const testNetlify: ProviderTestFn = async ({ apiKey }) => {
  if (!apiKey) return { ok: false, error: 'pat required' }
  try {
    const res = await timedFetch('https://api.netlify.com/api/v1/user', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as { email?: string; full_name?: string }
      return { ok: true, identity: body.email ?? body.full_name ?? 'netlify-user', status: res.status }
    }
    return { ok: false, status: res.status, error: (await res.text().catch(() => '')).slice(0, 300) }
  } catch (err) {
    return networkError(err)
  }
}

// ─── Railway ─────────────────────────────────────────────────────────────
const testRailway: ProviderTestFn = async ({ apiKey }) => {
  if (!apiKey) return { ok: false, error: 'token required' }
  try {
    const res = await timedFetch('https://backboard.railway.com/graphql/v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: 'query { me { id email } }' }),
    })
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as { data?: { me?: { id?: string; email?: string } }; errors?: unknown[] }
      if (body.errors?.length) {
        return { ok: false, status: res.status, error: `Railway returned GraphQL errors: ${JSON.stringify(body.errors).slice(0, 200)}` }
      }
      return { ok: true, identity: body.data?.me?.email ?? body.data?.me?.id ?? 'railway-user', status: res.status }
    }
    return { ok: false, status: res.status, error: (await res.text().catch(() => '')).slice(0, 300) }
  } catch (err) {
    return networkError(err)
  }
}

// ─── Supabase management API ────────────────────────────────────────────
const testSupabase: ProviderTestFn = async ({ apiKey }) => {
  if (!apiKey) return { ok: false, error: 'management_api_key required' }
  try {
    const res = await timedFetch('https://api.supabase.com/v1/projects', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.ok) {
      const body = await res.json().catch(() => []) as Array<{ id?: string; name?: string }>
      const count = Array.isArray(body) ? body.length : 0
      return { ok: true, identity: `supabase-mgmt (${count} projects)`, status: res.status }
    }
    return { ok: false, status: res.status, error: res.status === 401 ? 'Supabase mgmt API returned 401 — token may be revoked or scoped to a different organization.' : (await res.text().catch(() => '')).slice(0, 300) }
  } catch (err) {
    return networkError(err)
  }
}

// ─── Neon ────────────────────────────────────────────────────────────────
const testNeon: ProviderTestFn = async ({ apiKey }) => {
  if (!apiKey) return { ok: false, error: 'api_key required' }
  try {
    const res = await timedFetch('https://console.neon.tech/api/v2/projects', {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as { projects?: unknown[] }
      const count = body.projects?.length ?? 0
      return { ok: true, identity: `neon-key (${count} projects)`, status: res.status }
    }
    return { ok: false, status: res.status, error: (await res.text().catch(() => '')).slice(0, 300) }
  } catch (err) {
    return networkError(err)
  }
}

// ─── Twilio ──────────────────────────────────────────────────────────────
const testTwilio: ProviderTestFn = async ({ meta }) => {
  const sid = meta?.account_sid
  const token = meta?.auth_token
  if (!sid || !token) return { ok: false, error: 'account_sid + auth_token required' }
  try {
    const basic = Buffer.from(`${sid}:${token}`).toString('base64')
    const res = await timedFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
      headers: { Authorization: `Basic ${basic}` },
    })
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as { friendly_name?: string; status?: string }
      return { ok: true, identity: body.friendly_name ?? sid, status: res.status }
    }
    return { ok: false, status: res.status, error: res.status === 401 ? 'Twilio returned 401 — account_sid + auth_token mismatch.' : (await res.text().catch(() => '')).slice(0, 300) }
  } catch (err) {
    return networkError(err)
  }
}

// ─── Stripe ──────────────────────────────────────────────────────────────
const testStripe: ProviderTestFn = async ({ apiKey }) => {
  if (!apiKey) return { ok: false, error: 'secret_key required' }
  try {
    const res = await timedFetch('https://api.stripe.com/v1/account', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as { id?: string; email?: string; business_profile?: { name?: string } }
      return { ok: true, identity: body.business_profile?.name ?? body.email ?? body.id ?? 'stripe-account', status: res.status }
    }
    return { ok: false, status: res.status, error: res.status === 401 ? 'Stripe returned 401 — secret key invalid.' : (await res.text().catch(() => '')).slice(0, 300) }
  } catch (err) {
    return networkError(err)
  }
}

// ─── Custom ──────────────────────────────────────────────────────────────
// No upstream to hit; treat as opaque. The route still records it as a
// connection so it can be referenced by project overrides, but Test always
// reports `ok: true` with a note that the operator owns verification.
const testCustom: ProviderTestFn = async () => ({
  ok: true,
  identity: 'custom (no test endpoint)',
})

export const PROVIDER_TESTS: Record<string, ProviderTestFn> = {
  anthropic: testAnthropic,
  openai: testOpenAI,
  gemini: testGemini,
  github: testGitHub,
  vercel: testVercel,
  netlify: testNetlify,
  railway: testRailway,
  supabase: testSupabase,
  neon: testNeon,
  twilio: testTwilio,
  stripe: testStripe,
  custom: testCustom,
}

export type SupportedProvider = keyof typeof PROVIDER_TESTS

export async function runProviderTest(
  provider: string,
  input: ProviderTestInput,
): Promise<ProviderTestResult> {
  const fn = PROVIDER_TESTS[provider]
  if (!fn) return { ok: false, error: `Unknown provider '${provider}'` }
  return fn(input)
}

export const SUPPORTED_PROVIDERS: ReadonlyArray<string> = Object.keys(PROVIDER_TESTS)
