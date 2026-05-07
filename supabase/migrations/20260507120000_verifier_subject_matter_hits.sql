-- Migration: add subject_matter_hits column to verifier_runs (rem3 follow-up)
-- Source: ADR-2026-05-07-verifier-cluster-1778161030385.md (rem3) +
-- .agent/tasks/queued/phase-verifier-parser-subject-matter-immunity.md
--
-- The deterministic council parser at verifier/src/lib/council-parser.ts now
-- buckets fail-keyword matches that sit inside backticks, fenced blocks,
-- short quoted strings, task-id tokens, file paths, or 40-word
-- post-introducer windows as `subjectMatterHits` rather than as fail
-- verdicts. We persist the count per run so we can monitor the
-- false-positive rate post-fix on investigation/ADR-style specs.

ALTER TABLE public.verifier_runs
  ADD COLUMN IF NOT EXISTS subject_matter_hits int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.verifier_runs.subject_matter_hits IS
  'Count of fail-keyword matches the council parser bucketed as subject-matter rather than verdict. Non-zero only on investigation/ADR specs whose subject is itself a failure cluster.';
