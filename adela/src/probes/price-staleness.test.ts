/**
 * Price-staleness probe tests (Phase 1.6g — remediation attempt 2)
 *
 * Pure unit tests. Mocks the Supabase client and the WhatsApp notifier so
 * no network is touched. Module-level `lastState` is reset between tests
 * via the exposed `__resetForTests()` helper.
 *
 * Test runner: `@jest/globals` — matches sibling tests in
 * `adela/src/scrapers/__tests__/*.test.ts`. The `adela` tsconfig.json
 * excludes `**\/*.test.ts` from the production build, so these tests never
 * break `npm run build`. (Trailing `*` in the comment escaped to keep the
 * doc block well-formed.)
 *
 * Six required cases (spec § "In scope" item 3):
 *   1. Empty `prices` table → stale, WhatsApp called once.
 *   2. Latest ingested_at = now() - 7h → stale, WhatsApp called once.
 *   3. Latest ingested_at = now() - 2h → fresh on first run, no WhatsApp.
 *   4. fresh → stale → fresh across 3 invocations → WhatsApp called 2 times.
 *   5. Two consecutive stale cycles → WhatsApp called 1 time.
 *   6. notifyWhatsApp rejects → probe resolves; lastState advances.
 */

import { describe, test, expect, beforeEach, jest } from "@jest/globals"

// ---------------------------------------------------------------------------
// Mocks — must be declared before the SUT is imported
// ---------------------------------------------------------------------------

type SupabaseResult = { data: Array<{ ingested_at: string | null }>; error: null | { message: string } }

let mockSupabaseResult: SupabaseResult = { data: [], error: null }

const mockLimit = jest.fn(() => Promise.resolve(mockSupabaseResult))
const mockOrder = jest.fn(() => ({ limit: mockLimit }))
const mockSelect = jest.fn(() => ({ order: mockOrder }))
const mockFrom = jest.fn(() => ({ select: mockSelect }))

jest.mock("../lib/supabase", () => ({
  supabase: { from: mockFrom },
}))

const mockNotify = jest.fn<() => Promise<void>>(() => Promise.resolve())

jest.mock("../notify", () => ({
  notifyWhatsApp: (msg: string) => mockNotify(msg),
}))

// ---------------------------------------------------------------------------
// SUT — imported after mocks are registered
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { runPriceStalenessProbe, __resetForTests } from "./price-staleness"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString()
}

function setLatest(ingestedAt: string | null): void {
  if (ingestedAt === null) {
    mockSupabaseResult = { data: [], error: null }
  } else {
    mockSupabaseResult = { data: [{ ingested_at: ingestedAt }], error: null }
  }
}

beforeEach(() => {
  __resetForTests()
  mockNotify.mockClear()
  mockNotify.mockImplementation(() => Promise.resolve())
  mockFrom.mockClear()
  mockSelect.mockClear()
  mockOrder.mockClear()
  mockLimit.mockClear()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPriceStalenessProbe", () => {
  test("empty prices table → stale, WhatsApp called once with stale message", async () => {
    setLatest(null)
    await runPriceStalenessProbe()
    expect(mockNotify).toHaveBeenCalledTimes(1)
    const msg = mockNotify.mock.calls[0][0] as unknown as string
    expect(msg).toMatch(/prices stale/)
    expect(msg).toMatch(/none — table empty/)
    expect(msg).toMatch(/Threshold: 6h/)
  })

  test("latest ingested_at = now() - 7h → stale, WhatsApp called once", async () => {
    setLatest(hoursAgo(7))
    await runPriceStalenessProbe()
    expect(mockNotify).toHaveBeenCalledTimes(1)
    const msg = mockNotify.mock.calls[0][0] as unknown as string
    expect(msg).toMatch(/prices stale/)
  })

  test("latest ingested_at = now() - 2h → fresh on first run, WhatsApp NOT called", async () => {
    setLatest(hoursAgo(2))
    await runPriceStalenessProbe()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  test("transition sequence fresh → stale → fresh → WhatsApp called exactly 2 times", async () => {
    // Cycle 1: fresh (silent because unknown → fresh)
    setLatest(hoursAgo(1))
    await runPriceStalenessProbe()
    expect(mockNotify).toHaveBeenCalledTimes(0)

    // Cycle 2: stale (fresh → stale: alert)
    setLatest(hoursAgo(8))
    await runPriceStalenessProbe()
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify.mock.calls[0][0]).toMatch(/prices stale/)

    // Cycle 3: fresh (stale → fresh: recovery)
    setLatest(hoursAgo(0.5))
    await runPriceStalenessProbe()
    expect(mockNotify).toHaveBeenCalledTimes(2)
    expect(mockNotify.mock.calls[1][0]).toMatch(/prices fresh again/)
  })

  test("two consecutive stale cycles → WhatsApp called exactly 1 time", async () => {
    setLatest(hoursAgo(9))
    await runPriceStalenessProbe()
    expect(mockNotify).toHaveBeenCalledTimes(1)

    setLatest(hoursAgo(10))
    await runPriceStalenessProbe()
    // No second alert — same-state cycle.
    expect(mockNotify).toHaveBeenCalledTimes(1)
  })

  test("notifyWhatsApp rejects → probe still resolves and lastState advances", async () => {
    mockNotify.mockImplementationOnce(() => Promise.reject(new Error("twilio down")))

    // First call: unknown → stale (would fire notify, which rejects). Probe must not throw.
    setLatest(hoursAgo(12))
    await expect(runPriceStalenessProbe()).resolves.toBeUndefined()
    expect(mockNotify).toHaveBeenCalledTimes(1)

    // lastState was advanced to 'stale' — a follow-up stale cycle should NOT re-notify.
    setLatest(hoursAgo(13))
    await runPriceStalenessProbe()
    expect(mockNotify).toHaveBeenCalledTimes(1)
  })
})
