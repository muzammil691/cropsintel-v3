-- =============================================================================
-- Migration: verifier_runs unknown_reason retry (phase-1.10ay follow-up)
-- =============================================================================
-- The previous migration (20260502170000_verifier_unknown_reason.sql) was
-- registered in supabase_migrations.schema_migrations but the ALTER TABLE
-- statements never actually ran against the table — likely because the
-- migration was registered during a prior failed push and `db push
-- --include-all` skipped re-applying it.
--
-- Re-apply with idempotent guards. This runs cleanly even if the prior
-- migration somehow did partially apply.
-- =============================================================================

DO $$
BEGIN
  -- Drop NOT NULL on passed if it's still NOT NULL.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'verifier_runs'
      AND column_name = 'passed'
      AND is_nullable = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE public.verifier_runs ALTER COLUMN passed DROP NOT NULL';
  END IF;
END $$;

ALTER TABLE public.verifier_runs
  ADD COLUMN IF NOT EXISTS unknown_reason text;

-- Refresh PostgREST schema cache so the new column is queryable immediately.
NOTIFY pgrst, 'reload schema';
