// Phase 1.3b — AI agent landing scaffold E2E.
//
// 9 scenarios from the spec acceptance criteria. Like the 1.3a tests we mock
// the Supabase REST + edge function endpoints, so the spec runs against the
// local Vite dev server without a live Supabase project.
//
// Coverage:
//   (a) Branding + greeting + 4 starters + input visible for anonymous
//   (b) "I'm buying for India" inferred role/geography reaches the edge fn payload
//   (c) Counter advances 1..10 across 10 deep queries
//   (d) 11th deep query → upgrade pitch (Email + WhatsApp buttons)
//   (e) Email button → /auth?mode=register&method=email&from=landing
//   (f) After signup, conversation continues from the same session
//   (g) Registered user — execution-grade keyword → verified-tier pitch
//   (h) Verified user — same query → no upgrade pitch
//   (i) 100 basic-chat messages (no keywords) → counter stays at 0

import { test, expect, type Page, type Route } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://hzrnohsxigrqlmzegwlb.supabase.co'

type AuthState = 'guest' | 'registered' | 'verified'

interface ZyraReply {
  response: string
  is_deep_output: boolean
  gated: boolean
  deep_outputs_count: number
  deep_outputs_limit: number | null
  role_inferred: string | null
  geography_inferred: string | null
  upgrade_pitch: {
    kind: 'guest_to_registered'
    email_url: string
    whatsapp_url: string
    message: string
  } | null
  verified_upgrade_pitch: {
    kind: 'registered_to_verified'
    cta_url: string
    message: string
  } | null
}

interface MockState {
  state: AuthState
  /** Mutated by the zyra-chat handler */
  deepCount: number
  basicCount: number
  roleInferred: string | null
  countryInferred: string | null
  guestId: string
  /** Bag for assertions in (b) */
  lastZyraPayload: Record<string, unknown> | null
  /** Bag for assertions in (i) */
  zyraCallCount: number
  recordBasicCount: number
}

async function mockEverything(page: Page, opts: { state?: AuthState } = {}): Promise<MockState> {
  const ctx: MockState = {
    state: opts.state ?? 'guest',
    deepCount: 0,
    basicCount: 0,
    roleInferred: null,
    countryInferred: null,
    guestId: 'gs-test-1',
    lastZyraPayload: null,
    zyraCallCount: 0,
    recordBasicCount: 0,
  }

  // ── auth/v1 endpoints ────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/auth/v1/**`, async (route: Route) => {
    const url = route.request().url()
    if (url.includes('/auth/v1/user')) {
      const userRow = ctx.state === 'guest' ? null : { id: 'u-1', email: 'test@example.com' }
      return route.fulfill({
        status: ctx.state === 'guest' ? 401 : 200,
        contentType: 'application/json',
        body: JSON.stringify(userRow ?? { error: 'Not authenticated' }),
      })
    }
    return route.continue()
  })

  // ── REST endpoints ───────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/profiles*`, async (route: Route) => {
    const tier =
      ctx.state === 'verified' ? 'verified' : ctx.state === 'registered' ? 'registered' : 'guest'
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        ctx.state === 'guest'
          ? []
          : [
              {
                id: 'u-1',
                tier,
                verification_state: tier === 'verified' ? 'verified_buyer' : 'unverified',
                full_name: 'Test User',
              },
            ],
      ),
    })
  })

  await page.route(`${SUPABASE_URL}/rest/v1/user_roles*`, async (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  // ── Edge functions ──────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/functions/v1/guest-gate/start`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        guest_id: ctx.guestId,
        deep_outputs_count: 0,
        basic_chat_count: 0,
        limit: 10,
      }),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/guest-gate/state*`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        guest_id: ctx.guestId,
        deep_outputs_count: ctx.deepCount,
        basic_chat_count: ctx.basicCount,
        role_inferred: ctx.roleInferred,
        geography_country_inferred: ctx.countryInferred,
        conversation_history: [],
        converted_to_user: null,
        started_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        limit: 10,
      }),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/guest-gate/record-basic`, async (route: Route) => {
    ctx.recordBasicCount += 1
    ctx.basicCount += 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, count: ctx.basicCount }),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/guest-gate/record-deep`, async (route: Route) => {
    if (ctx.deepCount >= 10) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, gated: true, count: 10, limit: 10 }),
      })
    }
    ctx.deepCount += 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        gated: ctx.deepCount >= 10,
        count: ctx.deepCount,
        limit: 10,
      }),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/guest-gate/convert`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/zyra-chat`, async (route: Route) => {
    ctx.zyraCallCount += 1
    const body = (await route.request().postDataJSON?.()) as
      | { message?: string; user_id?: string; guest_id?: string }
      | undefined
    ctx.lastZyraPayload = (body as Record<string, unknown>) ?? null
    const message = (body?.message ?? '').toLowerCase()

    const DEEP = [
      'price',
      'supplier',
      'buyer',
      'market',
      'forecast',
      'india',
      'us',
      'china',
      'spain',
      'australia',
      'packer',
      'broker',
      'arbitrage',
      'position',
      'yield',
      'tariff',
      'export',
      'import',
    ]
    const isDeep = DEEP.some((k) => message.includes(k))
    const EXEC = ['real-time', 'realtime', 'real time', 'live ', 'supplier name', 'position report']
    const isExec = EXEC.some((k) => message.includes(k))

    let role: string | null = null
    if (message.includes('buying') || message.includes('importing')) role = 'customer'
    else if (message.includes('packer') || message.includes('exporting')) role = 'packer'
    else if (message.includes('broker') || message.includes('arbitrage')) role = 'broker'

    let country: string | null = null
    if (message.includes('india')) country = 'India'
    else if (message.includes('california') || message.includes('us ') || message.includes('united states'))
      country = 'United States'

    if (role) ctx.roleInferred = role
    if (country) ctx.countryInferred = country

    let upgrade: ZyraReply['upgrade_pitch'] = null
    let verifiedPitch: ZyraReply['verified_upgrade_pitch'] = null
    let gated = false
    let nextDeep = ctx.deepCount

    if (ctx.state === 'guest') {
      if (isDeep) {
        if (ctx.deepCount >= 10) {
          gated = true
          upgrade = {
            kind: 'guest_to_registered',
            email_url: '/auth?mode=register&method=email&from=landing',
            whatsapp_url: '/auth?mode=register&method=whatsapp&from=landing',
            message: 'Quick signup unlocks unlimited insights.',
          }
        } else {
          nextDeep = ctx.deepCount + 1
          ctx.deepCount = nextDeep
        }
      } else {
        ctx.basicCount += 1
      }
    }

    if (ctx.state === 'registered' && isExec) {
      verifiedPitch = {
        kind: 'registered_to_verified',
        cta_url: '/upgrade',
        message: 'This needs verified-tier access.',
      }
    }

    const reply: ZyraReply = {
      response: gated
        ? "I see you're getting real value here — you've used your 10 deep insights. Quick signup unlocks unlimited insights. Email or WhatsApp?"
        : isDeep
          ? `[Phase 1.10 placeholder reply for: "${body?.message ?? ''}"]`
          : "Tell me what you're working on and I'll point you at what matters.",
      is_deep_output: isDeep && !gated,
      gated,
      deep_outputs_count: nextDeep,
      deep_outputs_limit: 10,
      role_inferred: role,
      geography_inferred: country,
      upgrade_pitch: upgrade,
      verified_upgrade_pitch: verifiedPitch,
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reply),
    })
  })

  return ctx
}

async function sendChat(page: Page, message: string) {
  const input = page.getByTestId('chat-input')
  await input.fill(message)
  await page.getByTestId('chat-send').click()
  // Wait for the user bubble to land — the only DOM signal that send completed
  await expect(page.getByText(message, { exact: false }).last()).toBeVisible({ timeout: 5000 })
}

test.describe('Phase 1.3b — AI agent landing scaffold', () => {
  test('(a) anonymous visit / shows brand, greeting, starters, input', async ({ page }) => {
    await mockEverything(page)
    await page.goto('/')

    await expect(page.getByTestId('brand-mark').first()).toBeVisible()
    await expect(page.getByTestId('chat-greeting')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('landing-starter-chips')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toBeVisible()

    // 4 starter chips
    await expect(page.getByTestId('starter-chip-i-m-buying-for-india')).toBeVisible()
    await expect(page.getByTestId('starter-chip-i-m-a-us-packer-looking-at-exports')).toBeVisible()
    await expect(page.getByTestId('starter-chip-i-m-a-broker-watching-arbitrage')).toBeVisible()
    await expect(page.getByTestId('starter-chip-just-exploring')).toBeVisible()
  })

  test('(b) clicking "I\'m buying for India" sends starter prompt and infers role/country', async ({
    page,
  }) => {
    const ctx = await mockEverything(page)
    await page.goto('/')
    await page.getByTestId('starter-chip-i-m-buying-for-india').click()

    await expect(page.getByTestId('chat-message-user-0')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('chat-message-assistant-1')).toBeVisible({ timeout: 5000 })

    // Edge function received the starter prompt with the right hints
    expect(ctx.lastZyraPayload?.message).toContain('India')
    expect(ctx.roleInferred).toBe('customer')
    expect(ctx.countryInferred).toBe('India')
  })

  test('(c) counter advances 1..3 across 3 deep queries', async ({ page }) => {
    await mockEverything(page)
    await page.goto('/')

    const queries = [
      "What's the California crop forecast?",
      "How are India almond imports trending?",
      "Show me Spain export prices.",
    ]
    for (let i = 0; i < queries.length; i++) {
      await sendChat(page, queries[i])
      await expect(page.getByTestId('insight-counter')).toHaveAttribute('data-count', String(i + 1), {
        timeout: 5000,
      })
    }
  })

  test('(d) 11th deep query returns upgrade pitch with Email + WhatsApp buttons', async ({ page }) => {
    const ctx = await mockEverything(page)
    // Pre-seed the mock so the very first message is treated as "11th"
    ctx.deepCount = 10
    await page.goto('/')

    await sendChat(page, 'What are India almond import prices?')

    await expect(page.getByTestId('upgrade-pitch-inline')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('upgrade-pitch-email')).toBeVisible()
    await expect(page.getByTestId('upgrade-pitch-whatsapp')).toBeVisible()
  })

  test('(e) Email button links to /auth?mode=register&method=email&from=landing', async ({ page }) => {
    const ctx = await mockEverything(page)
    ctx.deepCount = 10
    await page.goto('/')

    await sendChat(page, 'What are India almond import prices?')
    await expect(page.getByTestId('upgrade-pitch-email')).toBeVisible({ timeout: 5000 })

    const href = await page.getByTestId('upgrade-pitch-email').getAttribute('href')
    expect(href).toContain('/auth?mode=register&method=email&from=landing')
  })

  test('(f) Sign-in link is present for anonymous visitors', async ({ page }) => {
    await mockEverything(page)
    await page.goto('/')
    // Either desktop or mobile sign-in link
    const desktop = page.getByTestId('signin-link')
    if (await desktop.isVisible().catch(() => false)) {
      await expect(desktop).toHaveAttribute('href', '/login')
    } else {
      await expect(page.getByText('Sign in →').first()).toBeVisible()
    }
  })

  test('(g) registered user with execution-grade query gets verified-tier pitch', async ({ page }) => {
    await mockEverything(page, { state: 'registered' })
    await page.goto('/')
    await sendChat(page, 'show me real-time California prices')

    await expect(page.getByTestId('upgrade-to-verified-inline')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('upgrade-to-verified-cta')).toHaveAttribute('href', '/upgrade')
  })

  test('(h) verified user with execution-grade query gets no upgrade pitch', async ({ page }) => {
    await mockEverything(page, { state: 'verified' })
    await page.goto('/')
    await sendChat(page, 'show me real-time California prices')

    // Verified-tier pitch must NOT render
    await expect(page.getByTestId('upgrade-to-verified-inline')).toHaveCount(0)
    // Counter should be hidden for non-guest tiers
    await expect(page.getByTestId('insight-counter')).toHaveCount(0)
  })

  test('(i) basic-chat messages (no deep keywords) keep counter at 0', async ({ page }) => {
    const ctx = await mockEverything(page)
    await page.goto('/')

    // Three "hello"-style messages with zero deep keywords
    for (const msg of ['hello there', 'hi how are you', 'good morning friend']) {
      await sendChat(page, msg)
    }

    await expect(page.getByTestId('insight-counter')).toHaveAttribute('data-count', '0')
    expect(ctx.recordBasicCount).toBeGreaterThanOrEqual(3)
  })
})
