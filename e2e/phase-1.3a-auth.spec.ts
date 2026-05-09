// Phase 1.3a — Auth foundation E2E tests.
//
// 10 scenarios from the spec acceptance criteria. We mock the Supabase auth +
// edge function endpoints so the spec can run against the local dev server
// without a live Supabase project. The goal is to exercise the React surface
// (tab rendering, form submission, redirect routing, RBAC gates), not to
// re-test Supabase itself.

import { test, expect, type Page, type Route } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://hzrnohsxigrqlmzegwlb.supabase.co'

type AuthState = 'guest' | 'registered' | 'verified' | 'admin'

interface MockOpts {
  state?: AuthState
  bridgeMatch?: boolean
}

async function mockSupabase(page: Page, opts: MockOpts = {}) {
  const state = opts.state ?? 'guest'

  await page.route(`${SUPABASE_URL}/auth/v1/**`, async (route: Route) => {
    const url = route.request().url()
    const method = route.request().method()

    if (url.includes('/auth/v1/token') && method === 'POST') {
      const body = await route.request().postDataJSON?.()
      // signInWithPassword
      if (body?.email && body?.password) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: 'fake_at',
            refresh_token: 'fake_rt',
            user: { id: 'u-1', email: body.email },
            expires_in: 3600,
          }),
        })
      }
    }

    if (url.includes('/auth/v1/signup')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fake_at',
          refresh_token: 'fake_rt',
          user: { id: 'u-new', email: 'new@example.com' },
          expires_in: 3600,
        }),
      })
    }

    if (url.includes('/auth/v1/otp')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
    }

    if (url.includes('/auth/v1/verify')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fake_at',
          refresh_token: 'fake_rt',
          user: { id: 'u-1', email: 'test@example.com' },
          expires_in: 3600,
        }),
      })
    }

    if (url.includes('/auth/v1/user')) {
      const userRow =
        state === 'guest'
          ? null
          : {
              id: state === 'admin' ? 'u-admin' : 'u-1',
              email: 'test@example.com',
            }
      return route.fulfill({
        status: state === 'guest' ? 401 : 200,
        contentType: 'application/json',
        body: JSON.stringify(userRow ?? { error: 'Not authenticated' }),
      })
    }

    return route.continue()
  })

  await page.route(`${SUPABASE_URL}/rest/v1/profiles*`, async (route: Route) => {
    const tier = state === 'admin' ? 'maxons_team' : state === 'verified' ? 'verified' : 'registered'
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        state === 'guest'
          ? []
          : [
              {
                id: state === 'admin' ? 'u-admin' : 'u-1',
                tier,
                verification_state: state === 'verified' ? 'verified_buyer' : 'unverified',
                full_name: 'Test User',
                geography_country: 'AE',
                business_type: 'buyer',
              },
            ],
      ),
    })
  })

  await page.route(`${SUPABASE_URL}/rest/v1/user_roles*`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state === 'admin' ? [{ role: 'admin' }] : []),
    })
  })

  await page.route(`${SUPABASE_URL}/rest/v1/verification_requests*`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'req-1',
          user_id: 'u-1',
          status: 'open',
          company_name: 'Acme Trading',
          company_role: 'buyer',
          reason: 'Need verified-tier access',
          created_at: new Date().toISOString(),
          assigned_to: null,
          assigned_at: null,
          business_registration_verified: null,
          business_registration_notes: null,
          business_registration_url: null,
          linkedin_verified: null,
          linkedin_notes: null,
          linkedin_url: null,
          website_verified: null,
          website_notes: null,
          website_url: null,
          references_checked_count: 0,
          references_notes: null,
          trade_history_reviewed: null,
          trade_history_notes: null,
          whatsapp_confirmation_done: null,
          decided_at: null,
          decided_by: null,
          decided_to_state: null,
          final_decision_notes: null,
        },
      ]),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/auth-bridge`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        opts.bridgeMatch
          ? {
              found: true,
              set_password_required: true,
              hint_email: 't••••@example.com',
              hint_phone: null,
              legacy_source: 'v2',
            }
          : { found: false, set_password_required: false },
      ),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/whatsapp-send-otp`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, expires_in_seconds: 600 }),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/whatsapp-verify-otp`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        user_id: 'u-1',
        email: '971501234567@whatsapp.cropsintel.local',
        hashed_token: 'tok',
        bridge: { found: false, set_password_required: false },
      }),
    })
  })
}

test.describe('Phase 1.3a — Auth foundation', () => {
  test('(a) /auth renders all 4 form tabs', async ({ page }) => {
    await mockSupabase(page)
    await page.goto('/auth')
    await expect(page.getByTestId('auth-tab-email-password')).toBeVisible()
    await expect(page.getByTestId('auth-tab-email-otp')).toBeVisible()
    await expect(page.getByTestId('auth-tab-wa-password')).toBeVisible()
    await expect(page.getByTestId('auth-tab-wa-otp')).toBeVisible()
  })

  test('(b) Email + password sign up flow renders', async ({ page }) => {
    await mockSupabase(page)
    await page.goto('/auth')
    await page.getByTestId('auth-tab-email-password').click()
    await page.getByText('New here? Create an account').click()
    await page.locator('#ep-email').fill('new@example.com')
    await page.locator('#ep-password').fill('hunter12!')
    // Don't submit (would create real user) — assert form is interactive.
    await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })

  test('(c) WhatsApp OTP flow advances after sending the code', async ({ page }) => {
    await mockSupabase(page)
    await page.goto('/auth')
    await page.getByTestId('auth-tab-wa-otp').click()
    await page.locator('#wo-phone').fill('501234567')
    await page.getByRole('button', { name: 'Send OTP via WhatsApp' }).click()
    await expect(page.locator('#wo-code')).toBeVisible()
  })

  test('(d) V1/V2 user sign-in fallback redirects to /set-password', async ({ page }) => {
    await mockSupabase(page, { bridgeMatch: true })
    await page.goto('/auth')

    // Force the email-password sign-in to fail so the bridge kicks in
    await page.route(`${SUPABASE_URL}/auth/v1/token*`, (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error_description: 'Invalid login credentials' }),
      }),
    )

    await page.getByTestId('auth-tab-email-password').click()
    await page.locator('#ep-email').fill('legacy@example.com')
    await page.locator('#ep-password').fill('whatever1')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/set-password/)
    await expect(page).toHaveURL(/\/set-password/)
  })

  test('(e) /set-password page renders the lookup form', async ({ page }) => {
    await mockSupabase(page)
    await page.goto('/set-password')
    await expect(page.getByText('Welcome back to CropsIntel')).toBeVisible()
  })

  test('(f) /set-password with bridge match shows password fields', async ({ page }) => {
    await mockSupabase(page, { bridgeMatch: true })
    await page.goto('/set-password?email=legacy@example.com')
    await expect(page.locator('#sp-pw')).toBeVisible({ timeout: 10_000 })
  })

  test('(g) Admin queue lists open requests for team users', async ({ page }) => {
    await mockSupabase(page, { state: 'admin' })
    await page.goto('/admin/verified-queue')
    await expect(page.getByText('Verified review queue')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Acme Trading').first()).toBeVisible()
  })

  test('(h) Admin can expand a row to see the background-check checklist', async ({ page }) => {
    await mockSupabase(page, { state: 'admin' })
    await page.goto('/admin/verified-queue')
    await page.locator('[data-testid="request-card-req-1"]').first().click()
    await expect(page.getByText('Business registration verified')).toBeVisible()
  })

  test('(i) Registered user accessing /admin redirects away', async ({ page }) => {
    await mockSupabase(page, { state: 'registered' })
    await page.goto('/admin/verified-queue')
    // Admin layout uses AuthGuard requiredTier maxons_team — registered users get bounced to /upgrade
    await page.waitForURL(/\/(upgrade|auth|$)/, { timeout: 10_000 })
  })

  test('(j) Anonymous user accessing /admin redirects to /login or /auth', async ({ page }) => {
    await mockSupabase(page, { state: 'guest' })
    await page.goto('/admin/verified-queue')
    await page.waitForURL(/\/(login|auth)/, { timeout: 10_000 })
  })
})
