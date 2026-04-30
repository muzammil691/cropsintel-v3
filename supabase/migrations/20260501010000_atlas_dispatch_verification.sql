-- Phase 1.10q — Atlas honesty mode: post-condition verification on every write-tool dispatch
-- Records the moment a verifier confirmed (or failed to confirm) a side effect, plus the evidence collected.
-- Status='partial' is now allowed for dispatches whose tool fn returned success but post-condition verification did not confirm it.

ALTER TABLE public.atlas_dispatches
  ADD COLUMN IF NOT EXISTS verified_at      timestamptz,
  ADD COLUMN IF NOT EXISTS verified_evidence jsonb;

CREATE INDEX IF NOT EXISTS idx_atlas_dispatches_verified_at
  ON public.atlas_dispatches (verified_at DESC NULLS LAST);

COMMENT ON COLUMN public.atlas_dispatches.verified_at IS
  'Timestamp when the post-condition verifier ran. NULL means no verifier defined for this tool.';

COMMENT ON COLUMN public.atlas_dispatches.verified_evidence IS
  'JSON evidence collected by the verifier — e.g. {verified: true, evidence: {fileInQueue: true, actualHead: "abc123"}, error: null}.';
