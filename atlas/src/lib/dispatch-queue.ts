// 1.10bb-c Session 6 — atlas_dispatches FIFO picker with pause-token skip.
//
// The builder cron lives outside this file (the dispatch.ts machinery handles
// chat-driven tool calls synchronously; the autonomous build loop on Railway
// is the async consumer). Both pull the next row to work on through
// pickNextQueuedDispatch — keeping FIFO + pause-skip logic in one place so
// behaviour stays consistent across runners.
//
// FIFO is enforced via `ORDER BY initiated_at ASC` (oldest-first). The unique
// (tool, dedupe_key) index from 20260502210000_atlas_dispatches_retry.sql
// already prevents identical work from queueing twice; this picker just
// resolves the order in which distinct work runs.

import { getSupabaseClient } from './supabase'

export interface QueuedDispatch {
  id: string
  tool: string
  arguments: Record<string, unknown>
  initiated_at: string
  initiated_by: string
  trust_mode: string
  retry_count: number | null
}

export interface PickNextQueuedDispatchOptions {
  /** Optional tool allow-list — restricts the picker to one or more tool names. */
  tools?: string[]
  /** Cap on initiated_at age (ms) — skip dispatches older than this (defaults to no cap). */
  maxAgeMs?: number
}

/**
 * Returns the oldest atlas_dispatches row with status='queued' that does NOT
 * carry a builder_pause_token. Pause-skipping is enforced in SQL via
 * `builder_pause_token IS NULL` so the picker never even materialises paused
 * rows; cron drains keep advancing past them.
 *
 * Returns null when the queue is empty (or every queued row is paused).
 */
export async function pickNextQueuedDispatch(
  opts: PickNextQueuedDispatchOptions = {},
): Promise<QueuedDispatch | null> {
  const sb = getSupabaseClient()
  if (!sb) return null

  let query = sb
    .from('atlas_dispatches')
    .select('id, tool, arguments, initiated_at, initiated_by, trust_mode, retry_count')
    .eq('status', 'queued')
    // Session 6: skip paused dispatches
    .is('builder_pause_token', null)
    // FIFO — oldest queued row drains first.
    .order('initiated_at', { ascending: true })
    .limit(1)

  if (opts.tools && opts.tools.length > 0) {
    query = query.in('tool', opts.tools)
  }
  if (opts.maxAgeMs && opts.maxAgeMs > 0) {
    const cutoff = new Date(Date.now() - opts.maxAgeMs).toISOString()
    query = query.gt('initiated_at', cutoff)
  }

  const { data, error } = await query.maybeSingle()
  if (error || !data) return null
  return data as QueuedDispatch
}

/**
 * Convenience wrapper used by the long-running builder loop: pick + transition
 * to 'building' atomically. Returns null when no work is available.
 *
 * The status transition uses a conditional UPDATE
 * (`WHERE id = ? AND status = 'queued' AND builder_pause_token IS NULL`)
 * so concurrent runners can't both grab the same row — only one of the
 * UPDATEs succeeds; the other returns 0 affected rows + null.
 */
export async function claimNextQueuedDispatch(
  opts: PickNextQueuedDispatchOptions = {},
): Promise<QueuedDispatch | null> {
  const candidate = await pickNextQueuedDispatch(opts)
  if (!candidate) return null

  const sb = getSupabaseClient()
  if (!sb) return null

  const { data, error } = await sb
    .from('atlas_dispatches')
    .update({ status: 'building' })
    .eq('id', candidate.id)
    .eq('status', 'queued')
    .is('builder_pause_token', null)
    .select('id')
    .maybeSingle()

  // Another runner won the race — try the next row. Caller can re-poll.
  if (error || !data) return null
  return candidate
}
