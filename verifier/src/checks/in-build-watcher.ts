// Session 5 — in-build watcher.
//
// Continuous monitor that polls atlas_dispatches every 30s for rows still in
// the 'building' status. Any row that has been building for longer than the
// stall threshold (20 min by default) gets paused via Atlas's verifier-dialog
// controller — which sets builder_pause_token on the dispatch row + dispatches
// the WhatsApp alert.
//
// The watcher is idempotent: a dispatch row that already has a
// builder_pause_token is skipped, so re-runs don't double-page.

import { getSupabaseClient } from '../lib/supabase'

const POLL_INTERVAL_MS = 30_000
const STALL_THRESHOLD_MS = 20 * 60 * 1000 // 20 min

export interface InBuildWatcherOptions {
  /** Override the poll interval (ms). Useful for tests. */
  pollIntervalMs?: number
  /** Override the stall threshold (ms). Defaults to 20 min. */
  stallThresholdMs?: number
  /** Atlas base URL — the watcher POSTs the pause request to its REST surface
   *  so credentials + Twilio auth stay inside the atlas process. */
  atlasBaseUrl?: string
  /** Service token Atlas uses to authenticate internal callers. */
  atlasServiceToken?: string
  /** Hook for tests / logs. */
  onPause?: (info: { dispatchId: string; ageMs: number; tool: string }) => void
  /** Hook for tests / logs. */
  onError?: (err: unknown) => void
}

export interface StalledDispatch {
  id: string
  tool: string
  initiated_at: string
  ageMs: number
}

/**
 * Runs one poll cycle: returns the rows currently exceeding the threshold
 * AND requests pause for each via Atlas's REST surface. Exported separately
 * from the loop so callers can drive a single cycle from a unit test or a
 * one-shot cron.
 */
export async function runOneCycle(opts: InBuildWatcherOptions = {}): Promise<StalledDispatch[]> {
  const sb = getSupabaseClient()
  if (!sb) {
    opts.onError?.(new Error('in-build-watcher: supabase client unavailable'))
    return []
  }
  const stallThresholdMs = opts.stallThresholdMs ?? STALL_THRESHOLD_MS
  const cutoff = new Date(Date.now() - stallThresholdMs).toISOString()

  const { data, error } = await sb
    .from('atlas_dispatches')
    .select('id, tool, initiated_at, builder_pause_token')
    .eq('status', 'building')
    .lt('initiated_at', cutoff)
    .is('builder_pause_token', null) // skip dispatches already paused
    .order('initiated_at', { ascending: true })
    .limit(20)

  if (error) {
    opts.onError?.(error)
    return []
  }
  if (!data || data.length === 0) return []

  const stalled: StalledDispatch[] = []
  for (const row of data as Array<{ id: string; tool: string; initiated_at: string }>) {
    const ageMs = Date.now() - new Date(row.initiated_at).getTime()
    stalled.push({ id: row.id, tool: row.tool, initiated_at: row.initiated_at, ageMs })
    try {
      await requestAtlasPause({
        dispatchId: row.id,
        reason: `Build exceeded ${Math.round(stallThresholdMs / 60_000)}-minute stall threshold (running ${Math.round(ageMs / 60_000)} min on tool=${row.tool})`,
        paths: ['RESUME — keep building', 'ABORT — kill this build'],
        atlasBaseUrl: opts.atlasBaseUrl,
        atlasServiceToken: opts.atlasServiceToken,
      })
      opts.onPause?.({ dispatchId: row.id, ageMs, tool: row.tool })
    } catch (err) {
      opts.onError?.(err)
    }
  }
  return stalled
}

/** Long-running poller. Call `stop()` on the returned handle to break the loop. */
export function startInBuildWatcher(opts: InBuildWatcherOptions = {}): { stop: () => void } {
  const intervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  async function tick() {
    if (stopped) return
    try {
      await runOneCycle(opts)
    } catch (err) {
      opts.onError?.(err)
    } finally {
      if (!stopped) timer = setTimeout(() => { void tick() }, intervalMs)
    }
  }

  void tick()

  return {
    stop() {
      stopped = true
      if (timer) { clearTimeout(timer); timer = null }
    },
  }
}

async function requestAtlasPause(args: {
  dispatchId: string
  reason: string
  paths: string[]
  atlasBaseUrl?: string
  atlasServiceToken?: string
}): Promise<void> {
  const base = args.atlasBaseUrl
    ?? process.env.ATLAS_BASE_URL
    ?? process.env.V3_ATLAS_BASE_URL
    ?? 'http://localhost:3001'
  const token = args.atlasServiceToken
    ?? process.env.ATLAS_SERVICE_TOKEN
    ?? process.env.V3_ATLAS_SERVICE_TOKEN
    ?? ''

  const res = await fetch(`${base.replace(/\/$/, '')}/atlas/verifier-dialog/pause`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      dispatch_id: args.dispatchId,
      reason: args.reason,
      paths: args.paths,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`atlas pause request failed: ${res.status} ${text.slice(0, 200)}`)
  }
}
