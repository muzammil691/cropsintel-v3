/**
 * Smoke test for verifier_runs INSERT capability (phase-1.10az)
 *
 * This test requires REAL Supabase credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 * It is skipped in CI if credentials are missing. When credentials are present, it:
 *
 * 1. Inserts a synthetic verifier_runs row (task_id='smoke-test-*')
 * 2. Verifies the row lands in the database
 * 3. Deletes the row (cleanup)
 *
 * This test catches the root cause of db_write_failed (RLS policy + wrong key).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getSupabaseClient } from '../lib/supabase'
import { randomUUID } from 'crypto'

const SMOKE_TEST_TASK_ID = `smoke-test-${randomUUID()}`

describe('Supabase verifier_runs smoke test', () => {
  let supabase: ReturnType<typeof getSupabaseClient>
  let insertedId: string | null = null

  beforeAll(() => {
    supabase = getSupabaseClient()
  })

  afterAll(async () => {
    // Cleanup: delete the smoke test row if it was inserted
    if (supabase && insertedId) {
      await supabase.from('verifier_runs').delete().eq('id', insertedId)
    }
  })

  it('should skip if Supabase credentials are not configured', () => {
    if (!supabase) {
      console.warn('[smoke-test] Skipping: Supabase credentials not configured')
      expect(supabase).toBeNull()
      return
    }
  })

  it('should INSERT a synthetic verifier_runs row using service_role key', async () => {
    if (!supabase) {
      console.warn('[smoke-test] Skipping INSERT test: no Supabase client')
      return
    }

    const payload = {
      task_id: SMOKE_TEST_TASK_ID,
      task_spec_path: '.agent/tasks/smoke-test.md',
      commit_sha: '0000000000000000000000000000000000000000',
      mode: 'audit-only' as const,
      passed: true,
      gaps: [],
      duration_ms: 0,
      subject_matter_hits: 0,
    }

    const { data, error } = await supabase
      .from('verifier_runs')
      .insert(payload)
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data?.id).toBeDefined()

    insertedId = data?.id ?? null
  })

  it('should SELECT the inserted row to verify it landed', async () => {
    if (!supabase || !insertedId) {
      console.warn('[smoke-test] Skipping SELECT test: no row inserted')
      return
    }

    const { data, error } = await supabase
      .from('verifier_runs')
      .select('*')
      .eq('id', insertedId)
      .single()

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data?.task_id).toBe(SMOKE_TEST_TASK_ID)
    expect(data?.passed).toBe(true)
  })

  it('should DELETE the synthetic row (cleanup)', async () => {
    if (!supabase || !insertedId) {
      console.warn('[smoke-test] Skipping DELETE test: no row to delete')
      return
    }

    const { error } = await supabase
      .from('verifier_runs')
      .delete()
      .eq('id', insertedId)

    expect(error).toBeNull()

    // Verify deletion
    const { data } = await supabase
      .from('verifier_runs')
      .select('id')
      .eq('id', insertedId)
      .single()

    expect(data).toBeNull()
    insertedId = null // Mark as cleaned up
  })
})
