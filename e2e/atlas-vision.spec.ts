// Phase 1.10ae — Atlas vision E2E smoke test.
//
// Walks the operator through the three Atlas surfaces unified by AtlasTopNav:
//   1. /atlas         — conductor dashboard
//   2. /atlas-brain   — Multi-Brain debate console
//   3. /atlas-pd      — Project Development cockpit
//
// Each navigation uses the AtlasTopNav links, asserting both the active-state
// highlighting and that subsequent pages render their canonical headings.
// Detailed write-flows (run debate, create proposal) are skipped here because
// they hit cost-gated AI providers and require server-side fixtures — the
// dedicated spec for those lives alongside their respective phase tasks.
//
// Auth is mocked at the AuthContext layer via E2E_AUTH_TOKEN if set; otherwise
// the test attempts a UI login and skips if E2E_ADMIN_EMAIL is unset (so the
// spec is safe to run in dev without secrets).

import { test, expect } from '@playwright/test'

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD

test.describe('Atlas vision — surface unification', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set; skipping')

  test.beforeEach(async ({ page }) => {
    await page.goto('/auth')
    // The /auth page surfaces a tabbed login. Best-effort: target an email field
    // and a password field; bail out early with a helpful message if shape changes.
    const email = page.getByLabel(/email/i).first()
    const password = page.getByLabel(/password/i).first()
    await expect(email).toBeVisible({ timeout: 10_000 })
    await email.fill(ADMIN_EMAIL!)
    await password.fill(ADMIN_PASSWORD!)
    await page.getByRole('button', { name: /sign in|log in/i }).first().click()
    // Wait for any post-login redirect (admin lands on /atlas or /admin)
    await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 15_000 })
  })

  test('full Atlas surface walkthrough', async ({ page }) => {
    // 1. Conductor dashboard
    await page.goto('/atlas')
    await expect(page.getByRole('heading', { name: /^Atlas$/ })).toBeVisible()
    await expect(page.getByRole('navigation', { name: /Atlas surfaces/i })).toBeVisible()

    // Active surface should be Atlas
    const atlasLink = page.getByRole('link', { name: 'Atlas', exact: true }).first()
    await expect(atlasLink).toHaveAttribute('aria-current', 'page')

    // 2. Brain
    await page.getByRole('link', { name: 'Brain', exact: true }).first().click()
    await expect(page).toHaveURL(/\/atlas-brain/)
    await expect(page.getByRole('heading', { name: /Atlas Brain/i })).toBeVisible()
    const brainLink = page.getByRole('link', { name: 'Brain', exact: true }).first()
    await expect(brainLink).toHaveAttribute('aria-current', 'page')

    // 3. Project Dev
    await page.getByRole('link', { name: 'Project Dev', exact: true }).first().click()
    await expect(page).toHaveURL(/\/atlas-pd/)
    await expect(page.getByRole('heading', { name: /Atlas PD/i })).toBeVisible()
    const pdLink = page.getByRole('link', { name: 'Project Dev', exact: true }).first()
    await expect(pdLink).toHaveAttribute('aria-current', 'page')

    // 4. Back to Atlas
    await page.getByRole('link', { name: 'Atlas', exact: true }).first().click()
    await expect(page).toHaveURL(/\/atlas$/)
  })
})
