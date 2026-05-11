/**
 * Verifier DB-write smoke test (phase-1.10bb)
 *
 * Inserts a synthetic row into public.verifier_runs, asserts the row is
 * readable, then DELETEs it. Designed to catch the exact regression
 * phase-1.10bb is fixing: anon-key fallback + RLS blocking INSERTs +
 * payload/schema drift.
 *
 * Requirements:
 *   - SUPABASE_URL (or V3_SUPABASE_URL)
 *   - SUPABASE_SERVICE_ROLE_KEY (or one of the accepted aliases — see
 *     verifier/src/lib/supabase.ts)
 *
 * If credentials are missing the test FAILS with a descriptive error rather
 * than silently skipping — CI must catch a misconfigured Verifier before
 * the regression makes it to prod. (Override SMOKE_SKIP_IF_NO_CREDS=true
 * for local dev environments that legitimately can't reach Supabase.)
 *
 * Synthetic rows use the reserved task_id prefix `smoke-test-` so an
 * orphaned row (test crash mid-flight) is trivially identifiable. The
 * try/finally below guarantees the DELETE runs even on assertion failure.
 */

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'crypto'
import { requireSupabaseClient } from './src/lib/supabase'

const SMOKE_TASK_ID = `smoke-test-${randomUUID()}`
const SMOKE_COMMIT_SHA = '0'.repeat(40)

const credsPresent = Boolean(
  (process.env.SUPABASE_URL ?? process.env.V3_SUPABASE_URL)
    && (
      process.env.SUPABASE_SERVICE_ROLE_KEY
        ?? process.env.V3_SUPABASE_SERVICE_ROLE_KEY
        ?? process.env.SUPABASE_SECRET_KEY
        ?? process.env.V3_SUPABASE_SECRET_KEY
        ?? process.env.SUPABASE_SERVICE_KEY
    ),
)

const skipIfNoCreds = process.env.SMOKE_SKIP_IF_NO_CREDS === 'true'

describe('verifier_runs DB-write smoke test', () => {
  it('asserts SERVICE_ROLE_KEY is configured', () => {
    if (!credsPresent && skipIfNoCreds) {
      console.warn(
        '[smoke-test] SMOKE_SKIP_IF_NO_CREDS=true and creds are absent — '
          + 'skipping. Disable this skip in CI to enforce the env var contract.',
      )
      return
    }
    expect(credsPresent, 'SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set').toBe(true)
  })

  it('INSERTs a synthetic verifier_runs row, SELECTs it back, then DELETEs', async () => {
    if (!credsPresent) {
      if (skipIfNoCreds) {
        console.warn('[smoke-test] Skipping INSERT/SELECT/DELETE — no creds')
        return
      }
      throw new Error(
        'SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required for the verifier '
          + 'smoke test. See verifier/README.md.',
      )
    }

    const supabase = requireSupabaseClient()
    let insertedId: string | null = null

    try {
      const payload = {
        task_id: SMOKE_TASK_ID,
        task_spec_path: `.agent/tasks/${SMOKE_TASK_ID}.md`,
        commit_sha: SMOKE_COMMIT_SHA,
        mode: 'audit-only' as const,
        passed: true,
        gaps: [],
        remediation_task_id: null,
        duration_ms: 0,
        subject_matter_hits: 0,
      }

      const { data: inserted, error: insertError } = await supabase
        .from('verifier_runs')
        .insert(payload)
        .select('id, task_id, passed')
        .single()

      expect(insertError, `INSERT failed: ${insertError?.message ?? ''}`).toBeNull()
      expect(inserted).toBeTruthy()
      expect(inserted?.task_id).toBe(SMOKE_TASK_ID)
      expect(inserted?.passed).toBe(true)
      insertedId = inserted?.id ?? null
      expect(insertedId).toBeTruthy()

      const { data: fetched, error: selectError } = await supabase
        .from('verifier_runs')
        .select('id, task_id, passed, mode')
        .eq('id', insertedId as string)
        .single()

      expect(selectError, `SELECT failed: ${selectError?.message ?? ''}`).toBeNull()
      expect(fetched?.id).toBe(insertedId)
      expect(fetched?.task_id).toBe(SMOKE_TASK_ID)
      expect(fetched?.mode).toBe('audit-only')
    } finally {
      // Mitigation: try/finally guarantees DELETE runs even if any
      // assertion above throws, so no smoke-test rows orphan in prod.
      if (insertedId) {
        const { error: deleteError } = await supabase
          .from('verifier_runs')
          .delete()
          .eq('id', insertedId)
        if (deleteError) {
          // Surface the cleanup failure loudly so an operator can
          // chase the orphan, but don't mask the original assertion.
          console.error(
            `[smoke-test] CRITICAL: cleanup DELETE failed for id=${insertedId}: ${deleteError.message}`,
          )
        }
      }
      // Defense-in-depth: also sweep any row carrying our reserved
      // task_id prefix, in case a previous run crashed before insertedId
      // was captured. Safe because no real task uses `smoke-test-` IDs.
      await supabase
        .from('verifier_runs')
        .delete()
        .like('task_id', 'smoke-test-%')
    }
  })
})
