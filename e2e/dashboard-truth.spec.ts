// Phase 1.10af — Dashboard live state truth.
//
// The cockpit must render the *server's* truth, not optimistic/cached UI:
//   (a) After force-cancel, the spec disappears from the queue list within 6s
//       (one 5s poll cycle + buffer). No manual refresh needed.
//   (b) When the server rejects a trust-mode change, the badge does NOT change
//       to the requested value AND an error toast appears.
//   (c) When /atlas/queue is unreachable for >30s, a red stale-state banner
//       appears so the operator never mistakes frozen data for current data.
//
// We mock the Atlas API surface with page.route() so this spec runs without
// a live Atlas backend. Auth is mocked at the same layer — fetchAtlasMe()
// returns owner so manage controls render. The Atlas conductor lives at
// /atlas; the AtlasCockpit component owns the badge + queue rendering.

import { test, expect, type Route } from '@playwright/test'

const ATLAS_BASE = process.env.VITE_ATLAS_URL ?? 'http://localhost:8787'

interface QueuePayload {
  queued: Array<{ id: string; filename: string; priority?: number; paused?: boolean; blocked?: boolean }>
  in_flight: Array<{ id: string; filename: string; started_at: string | null }>
}

const STARTING_QUEUE: QueuePayload = {
  queued: [
    { id: 'phase-1.10af-test-a', filename: 'phase-1.10af-test-a.md', priority: 5 },
  ],
  in_flight: [
    {
      id: 'phase-1.10af-flight',
      filename: 'phase-1.10af-flight.md',
      started_at: new Date(Date.now() - 60_000).toISOString(),
    },
  ],
}

const EMPTY_QUEUE: QueuePayload = { queued: [], in_flight: [] }

function jsonRoute(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function installCommonMocks(page: import('@playwright/test').Page, opts: {
  queue: () => QueuePayload | 'unreachable'
  modeStatus?: number
  trustMode?: string
}) {
  // Auth — owner so the queue tab renders manage controls.
  await page.route(`**/atlas/me`, (route) =>
    jsonRoute(route, 200, { id: 'e2e-owner', role: 'owner', email: 'e2e@local' }),
  )
  // Status — feeds the trust mode badge plus the agent dots.
  await page.route(`**/atlas/status`, (route) =>
    jsonRoute(route, 200, {
      trust_mode: opts.trustMode ?? 'auto',
      failed_24h: 0,
      paused: false,
    }),
  )
  await page.route(`**/atlas/costs`, (route) =>
    jsonRoute(route, 200, { today: 0, month_to_date: 0, budget: 400 }),
  )
  // Trust mode endpoints.
  await page.route(`**/atlas/mode`, (route) => {
    if (route.request().method() === 'POST') {
      const status = opts.modeStatus ?? 200
      if (status >= 400) {
        return jsonRoute(route, status, { error: 'mock failure' })
      }
      return jsonRoute(route, 200, { mode: opts.trustMode ?? 'auto' })
    }
    return jsonRoute(route, 200, { mode: opts.trustMode ?? 'auto' })
  })
  await page.route(`**/atlas/builder/queue`, async (route) => {
    const result = opts.queue()
    if (result === 'unreachable') {
      await route.abort('failed')
      return
    }
    await jsonRoute(route, 200, result)
  })
  // Side endpoints we don't care about — short-circuit so polls don't hang.
  await page.route(`**/atlas/decisions*`, (route) => jsonRoute(route, 200, []))
  await page.route(`**/atlas/heartbeats`, (route) => jsonRoute(route, 200, []))
  await page.route(`**/atlas/agents/heartbeats`, (route) => jsonRoute(route, 200, []))
  await page.route(`**/atlas/artifacts**`, (route) =>
    jsonRoute(route, 200, { pendingSpecs: [], designAudits: [], openForks: [] }),
  )
}

test.describe('Phase 1.10af — dashboard live state truth', () => {
  test.skip(
    !process.env.E2E_DASHBOARD_TRUTH,
    'Set E2E_DASHBOARD_TRUTH=1 to run; spec mocks Atlas API and requires the dev server.',
  )

  test('(a) force-cancel refreshes queue within 6s', async ({ page }) => {
    let queueState: QueuePayload = { ...STARTING_QUEUE }
    await installCommonMocks(page, { queue: () => queueState })
    await page.route(`**/atlas/builder/queue/*/force-cancel`, async (route) => {
      // Server moves the spec out of in-progress.
      queueState = EMPTY_QUEUE
      await jsonRoute(route, 200, { ok: true, from_bucket: 'in-progress', sha: 'abc', pushed: true })
    })

    await page.goto('/atlas?tab=queue')
    // Wait for the in-flight row to appear.
    const inFlightRow = page.getByTestId(`queue-row-inflight-${STARTING_QUEUE.in_flight[0].id}`)
    await expect(inFlightRow).toBeVisible({ timeout: 10_000 })

    // Click the force-cancel button on the in-flight row.
    await inFlightRow.getByRole('button', { name: /force-cancel/i }).click()
    // Confirm the destructive dialog.
    await page.getByRole('button', { name: /^Force-cancel$/i }).click()

    // Within 6s (5s poll + 1s buffer), the spec must disappear.
    await expect(inFlightRow).toBeHidden({ timeout: 6_000 })
  })

  test('(b) failed mode change leaves badge unchanged and shows error toast', async ({ page }) => {
    await installCommonMocks(page, {
      queue: () => EMPTY_QUEUE,
      modeStatus: 500,
      trustMode: 'auto',
    })

    await page.goto('/atlas')
    // The badge starts at "auto".
    const badgeButton = page.getByRole('button', { name: /change trust mode/i })
    await expect(badgeButton).toBeVisible({ timeout: 10_000 })
    await expect(badgeButton).toContainText(/auto/i)

    // Open the dialog and click "passive".
    await badgeButton.click()
    await page.getByRole('button', { name: /^passive/i }).click()

    // The error message must surface, and the badge must NOT have flipped to passive.
    await expect(page.getByTestId('trust-mode-error')).toBeVisible({ timeout: 5_000 })
    await expect(badgeButton).toContainText(/auto/i)
    await expect(badgeButton).not.toContainText(/^passive$/i)
  })

  test('(c) red stale banner appears when /atlas/queue is unreachable for >30s', async ({ page }) => {
    let unreachable = false
    await installCommonMocks(page, {
      queue: () => (unreachable ? 'unreachable' : EMPTY_QUEUE),
    })

    await page.goto('/atlas?tab=queue')
    // Initial render with healthy queue.
    await expect(page.getByText(/Queue is empty|spec.* queued/i).first()).toBeVisible({
      timeout: 10_000,
    })
    // Now break the queue endpoint.
    unreachable = true

    // Banner must appear within 35s (>30s threshold + one poll cycle).
    await expect(page.getByTestId('dashboard-stale-banner')).toBeVisible({ timeout: 35_000 })
  })
})

// Silence the "ATLAS_BASE not used" warning under noUnusedLocals — kept here
// so the route patterns above stay readable when someone audits the URL shape.
void ATLAS_BASE
