-- Phase 1.10ad — Workflow-trace view for the 7-agent choreography
--
-- Surfaces the canonical "did every agent fire?" picture for each shipped commit:
--   * Verifier verdict + computed confidence
--   * Designer verdict (where applicable)
--   * Memory ingest timestamp (matched by commit_sha in metadata)
--   * Atlas observation timestamp (next snapshot after the verifier ran)
--
-- The spec's draft view used `atlas_dispatches.id::uuid = verifier_runs.task_id`,
-- but verifier_runs.task_id is a text task name (not a uuid), so that JOIN can't
-- work. We instead key the trace on commit_sha, which all four agents do record:
--   * verifier_runs.commit_sha (text)
--   * designer_runs has no direct sha, so we time-window-join on created_at
--   * memory_runs.metadata->>'commit_sha' (when present in metadata)
--   * atlas_snapshots is purely time-based
--
-- View-only; never write to it directly. Refresh comes from the underlying
-- canonical tables. Limit 50 keeps cardinality bounded for the dashboard card.

CREATE OR REPLACE VIEW public.atlas_workflow_trace AS
WITH ships AS (
  SELECT
    v.task_id,
    v.commit_sha AS sha,
    v.ran_at AS verifier_ran_at,
    CASE WHEN v.passed THEN 'pass' ELSE 'fail' END AS verifier_verdict,
    CASE
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
  -- Designer audit for the same task within ±10 min of the verifier run
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
  -- Memory ingest that mentions this commit in its metadata, OR any github-history
  -- ingest within 15 min after the ship (the conductor runs ingest in batched mode)
  SELECT mr.ran_at, mr.chunks_added
  FROM public.memory_runs mr
  WHERE mr.operation IN ('ingest', 'ingest:github-history')
    AND mr.ran_at BETWEEN s.verifier_ran_at AND s.verifier_ran_at + interval '15 min'
    AND (
      mr.metadata->>'commit_sha' = s.sha
      OR mr.source = 'github-history'
    )
  ORDER BY mr.ran_at DESC
  LIMIT 1
) m ON true
LEFT JOIN LATERAL (
  -- The first Atlas snapshot taken after the verifier finished
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
  'Phase 1.10ad — read-only view joining verifier/designer/memory/atlas runs per shipped commit. Powers the Atlas dashboard "Workflow trace" card. Never write to this view directly.';

-- Index hotspots so the lateral joins stay snappy as tables grow.
-- (verifier_runs already has commit_sha but no time index; add one for the WHERE clause.)
CREATE INDEX IF NOT EXISTS idx_verifier_runs_ran_at_mode
  ON public.verifier_runs (ran_at DESC, mode);

CREATE INDEX IF NOT EXISTS idx_memory_runs_operation_ran_at
  ON public.memory_runs (operation, ran_at DESC);

-- Read access: anyone can SELECT (powers the public Atlas dashboard).
-- Views inherit RLS from underlying tables, but Postgres requires explicit
-- grant on the view itself for non-table-owner roles.
GRANT SELECT ON public.atlas_workflow_trace TO anon, authenticated, service_role;
