-- =============================================================================
-- Migration: atlas_dispatches retry/dead-letter columns + atomic-claim index
-- =============================================================================
-- Audit C3 finding: dispatch.ts inserts atlas_dispatches without an atomic
-- claim, so two concurrent dispatch() calls with identical args can both
-- pass invariants and both execute the tool — yielding double git pushes
-- and double Builder runs. There is also no retry on transient failures and
-- no dead-letter when a tool repeatedly errors; failed specs sit silently.
--
-- Schema additions:
--   * dedupe_key   — sha256(canonicalJson(arguments)). Partial UNIQUE on
--                    (tool, dedupe_key) WHERE status='pending' makes a
--                    second concurrent insert fail with 23505. dispatch.ts
--                    catches that error and returns status='blocked,
--                    duplicate dispatch in flight'.
--   * retry_count  — incremented in-line after each tool-fn rejection.
--   * max_retries  — default 3; can be tuned per dispatch in future.
--   * dead_lettered_at — set when retry_count == max_retries and tool still
--                        failed. Triggers WhatsApp ping in the caller and
--                        an atlas_decisions row noting DEAD_LETTERED.
--
-- All ALTERs are IF NOT EXISTS / IF EXISTS guarded so the migration is
-- safe to retry.
-- =============================================================================

ALTER TABLE public.atlas_dispatches
  ADD COLUMN IF NOT EXISTS retry_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

-- Partial UNIQUE: only enforced on pending rows. Two completed dispatches
-- of the same (tool, dedupe_key) are fine; two simultaneous in-flight ones
-- are not. This is the atomic claim that closes the double-dispatch race.
CREATE UNIQUE INDEX IF NOT EXISTS atlas_dispatches_inflight_key
  ON public.atlas_dispatches (tool, dedupe_key)
  WHERE status = 'pending' AND dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_atlas_dispatches_dead_letter
  ON public.atlas_dispatches (dead_lettered_at)
  WHERE dead_lettered_at IS NOT NULL;

COMMENT ON COLUMN public.atlas_dispatches.dedupe_key IS
  'sha256(canonicalJson(arguments)). Partial UNIQUE with status=pending blocks double-dispatch races.';
COMMENT ON COLUMN public.atlas_dispatches.dead_lettered_at IS
  'Set when retry_count exhausts max_retries. Triggers WhatsApp ping + atlas_decisions DEAD_LETTERED row.';

NOTIFY pgrst, 'reload schema';
