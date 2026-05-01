-- Phase 1.10al — Atlas smart-diagnosis cache + verifier waivers.
--
-- atlas_diagnosis_cache memoises classifier results for 24h so the same
-- (artifact_kind, payload-hash) doesn't burn a Claude call on every refresh.
--
-- verifier_waivers records intentional stub-page failures the user has
-- explicitly acknowledged ("yes, this <NotImplemented/> is intentional"),
-- so the verifier stops re-flagging them as Active Artifacts.

CREATE TABLE IF NOT EXISTS public.atlas_diagnosis_cache (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_kind text        NOT NULL CHECK (
    artifact_kind IN ('designer_audit', 'verifier_run', 'workflow_violation', 'open_fork', 'pending_spec')
  ),
  payload_sha   text        NOT NULL,         -- sha256 hex of the canonical-JSON payload
  bucket        text        NOT NULL CHECK (
    bucket IN ('auto-remediate', 'claude-code', 'in-app-action', 'discuss')
  ),
  result        jsonb       NOT NULL,         -- the full DiagnosisBucket object
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (artifact_kind, payload_sha)
);

CREATE INDEX IF NOT EXISTS idx_atlas_diagnosis_cache_lookup
  ON public.atlas_diagnosis_cache (artifact_kind, payload_sha)
  WHERE expires_at > now();

CREATE INDEX IF NOT EXISTS idx_atlas_diagnosis_cache_expiry
  ON public.atlas_diagnosis_cache (expires_at);

ALTER TABLE public.atlas_diagnosis_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "diagnosis_cache_service" ON public.atlas_diagnosis_cache;
CREATE POLICY "diagnosis_cache_service" ON public.atlas_diagnosis_cache
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.atlas_diagnosis_cache IS
  'Phase 1.10al: 24h memo of artifact-failure classifications (auto-remediate / claude-code / in-app-action / discuss).';

-- ─── verifier_waivers ───────────────────────────────────────────────────────
-- Marks a (verifier_run.id + check) pair as intentionally accepted so it stops
-- showing up as an Active Artifact. The in-app-action "Mark stub as intentional"
-- writes here.

CREATE TABLE IF NOT EXISTS public.verifier_waivers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  verifier_run_id uuid,                                            -- nullable: a waiver may apply across runs
  task_id         text        NOT NULL,
  check_name      text        NOT NULL,                            -- e.g. 'gemini-judgment', 'page-not-stub'
  reason          text        NOT NULL,
  waived_by       text        NOT NULL,                            -- phone, 'service', or 'atlas-auto'
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, check_name)
);

CREATE INDEX IF NOT EXISTS idx_verifier_waivers_task_check
  ON public.verifier_waivers (task_id, check_name);

ALTER TABLE public.verifier_waivers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "verifier_waivers_service" ON public.verifier_waivers;
CREATE POLICY "verifier_waivers_service" ON public.verifier_waivers
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.verifier_waivers IS
  'Phase 1.10al: explicit intentional-failure waivers from the diagnose UI in-app-action bucket.';
