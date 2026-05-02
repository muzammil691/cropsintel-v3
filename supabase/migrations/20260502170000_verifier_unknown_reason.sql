-- =============================================================================
-- Migration: verifier_runs nullable passed + unknown_reason column (phase-1.10ay)
-- =============================================================================
-- The Verifier currently short-circuits when it cannot find a task spec or when
-- syncing the local clone fails — returning verdict=unknown and *not* writing a
-- verifier_runs row. The workflow-trace invariant checker keys on the presence
-- of a row per shipped commit, so every "unknown" verdict shows up as
-- verifier_audit_missing in Atlas.
--
-- Fix: allow `passed` to be nullable (null = "no signal") and record an
-- explicit `unknown_reason` so future audits can tell why a row is null.
-- Also patch atlas_workflow_trace so NULL passed surfaces as 'unknown'
-- instead of being misreported as 'fail' by the existing CASE expression.
-- =============================================================================

ALTER TABLE public.verifier_runs
  ALTER COLUMN passed DROP NOT NULL;

ALTER TABLE public.verifier_runs
  ADD COLUMN IF NOT EXISTS unknown_reason text;

COMMENT ON COLUMN public.verifier_runs.passed IS
  'true = pass, false = fail, NULL = no signal (see unknown_reason).';

COMMENT ON COLUMN public.verifier_runs.unknown_reason IS
  'When passed IS NULL, explains why: spec_not_found / sync_failed / judge_unreachable / verify_crashed.';

-- The original view (20260501080000_atlas_workflow_trace_view.sql) used
--   CASE WHEN v.passed THEN 'pass' ELSE 'fail' END
-- which silently coerces NULL → 'fail'. Now that NULL means "no signal",
-- redefine the view to map NULL → 'unknown' and zero out the confidence so
-- dashboards don't show fake high-confidence fails for spec_not_found rows.

CREATE OR REPLACE VIEW public.atlas_workflow_trace AS
WITH ships AS (
  SELECT
    v.task_id,
    v.commit_sha AS sha,
    v.ran_at AS verifier_ran_at,
    CASE
      WHEN v.passed IS NULL THEN 'unknown'
      WHEN v.passed THEN 'pass'
      ELSE 'fail'
    END AS verifier_verdict,
    CASE
      WHEN v.passed IS NULL THEN 0.0
      WHEN v.passed THEN 0.95
      WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v.gaps) g WHERE g->>'severity' = 'fail') THEN 0.85
      ELSE 0.55
    END AS verifier_confidence,
    v.gaps AS verifier_gaps
  FROM public.verifier_runs v
  WHERE v.mode = 'gate'
    AND v.ran_at >= now() - interval '7 days'
)
SELECT
  s.task_id,
  s.sha,
  s.verifier_ran_at AS shipped_at,
  s.verifier_verdict,
  s.verifier_confidence,
  s.verifier_gaps,
  dg.verdict AS designer_verdict,
  dg.confidence AS designer_confidence,
  dg.created_at AS designer_ran_at,
  m.ran_at AS memory_ingested_at,
  m.chunks_added AS memory_chunks_added,
  asnap.taken_at AS atlas_observed_at
FROM ships s
LEFT JOIN LATERAL (
  SELECT d.verdict, d.confidence, d.created_at
  FROM public.designer_runs d
  WHERE d.task_id = s.task_id
    AND d.operation = 'audit-commit'
    AND d.created_at BETWEEN s.verifier_ran_at - interval '5 min'
                         AND s.verifier_ran_at + interval '15 min'
  ORDER BY d.created_at DESC
  LIMIT 1
) dg ON true
LEFT JOIN LATERAL (
  -- Memory ingest that mentions this commit in its metadata.commit_shas array
  -- (preferred), falls back to the legacy single commit_sha key, then to any
  -- github-history ingest within 15 min after the ship (the conductor runs
  -- ingest in batched mode).
  SELECT mr.ran_at, mr.chunks_added
  FROM public.memory_runs mr
  WHERE mr.operation IN ('ingest', 'ingest:github-history')
    AND mr.ran_at BETWEEN s.verifier_ran_at AND s.verifier_ran_at + interval '15 min'
    AND (
      mr.metadata->'commit_shas' ? s.sha
      OR mr.metadata->>'commit_sha' = s.sha
      OR mr.source = 'github-history'
    )
  ORDER BY mr.ran_at DESC
  LIMIT 1
) m ON true
LEFT JOIN LATERAL (
  SELECT asn.taken_at
  FROM public.atlas_snapshots asn
  WHERE asn.taken_at >= s.verifier_ran_at
    AND asn.taken_at <= s.verifier_ran_at + interval '10 min'
  ORDER BY asn.taken_at ASC
  LIMIT 1
) asnap ON true
ORDER BY s.verifier_ran_at DESC
LIMIT 50;

COMMENT ON VIEW public.atlas_workflow_trace IS
  'Phase 1.10ad — read-only view joining verifier/designer/memory/atlas runs per shipped commit. Updated by phase-1.10ay to surface NULL verifier verdicts as unknown and to honor metadata.commit_shas arrays from memory_runs.';

GRANT SELECT ON public.atlas_workflow_trace TO anon, authenticated, service_role;
