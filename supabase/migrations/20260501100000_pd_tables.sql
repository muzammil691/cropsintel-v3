-- Phase 1.10ac — pd (Project Development) tables.
--
-- Six tables backing the /atlas-pd UI and pd-ai-review edge function:
--   pd_proposals       — feature/change proposals through their lifecycle
--   pd_evidence        — artefacts attached to a proposal (commits, screenshots, etc.)
--   pd_decisions       — append-only log of approve/reject/changes-requested
--   pd_auto_validation — Claude-judged proposal quality (advice, never the verdict)
--   pd_review_bundles  — grouped proposal+evidence+decision exports for stakeholder share
--   pd_benchmarks      — KPI samples (specs/day, verifier pass rate, cost burn)
--
-- All admin/team-only via has_role() RLS. Service role bypasses RLS so the
-- pd-ai-review edge function can write freely. Spec used 20260501070000 but
-- that slot was already taken by atlas_events; using 20260501100000 to keep
-- migrations chronologically ordered.

CREATE TABLE IF NOT EXISTS public.pd_proposals (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text          NOT NULL,
  description   text          NOT NULL,
  motivation    text,
  status        text          NOT NULL DEFAULT 'draft',  -- 'draft' | 'in-review' | 'approved' | 'rejected' | 'shipped' | 'archived'
  proposer_id   uuid          REFERENCES auth.users(id),
  related_phase text,                                     -- e.g. '1.10w'
  metadata      jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pd_evidence (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id   uuid          REFERENCES public.pd_proposals(id) ON DELETE CASCADE,
  artefact_type text          NOT NULL,                  -- 'commit' | 'screenshot' | 'audit-report' | 'note'
  artefact_url  text,
  description   text,
  uploaded_by   uuid          REFERENCES auth.users(id),
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pd_decisions (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  uuid          REFERENCES public.pd_proposals(id) ON DELETE CASCADE,
  verdict      text          NOT NULL,                   -- 'approved' | 'rejected' | 'changes-requested'
  rationale    text          NOT NULL,
  decided_by   uuid          REFERENCES auth.users(id),
  created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pd_auto_validation (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  uuid          REFERENCES public.pd_proposals(id) ON DELETE CASCADE,
  verdict      text          NOT NULL,                   -- 'pass' | 'needs-work' | 'reject'
  ai_model     text          NOT NULL,                   -- 'claude-opus-4-7' etc.
  reasoning    text,
  gaps         jsonb         DEFAULT '[]'::jsonb,
  cost_usd     numeric(10,4) DEFAULT 0,
  created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pd_review_bundles (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text         NOT NULL,
  description        text,
  proposal_ids       uuid[]       NOT NULL,
  exported_markdown  text,
  created_by         uuid         REFERENCES auth.users(id),
  created_at         timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pd_benchmarks (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key   text          NOT NULL,                   -- 'specs_shipped_per_day' | 'verifier_pass_rate' | 'cost_today'
  value        numeric       NOT NULL,
  observed_at  timestamptz   NOT NULL DEFAULT now(),
  metadata     jsonb         DEFAULT '{}'::jsonb
);

-- RLS: admin/team only on every PD table.
ALTER TABLE public.pd_proposals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pd_evidence        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pd_decisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pd_auto_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pd_review_bundles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pd_benchmarks      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pd_proposals_admin_team" ON public.pd_proposals FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role));

CREATE POLICY "pd_evidence_admin_team" ON public.pd_evidence FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role));

-- pd_decisions: read for admin/team; insert for admin/team; NO update/delete.
CREATE POLICY "pd_decisions_select" ON public.pd_decisions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role));
CREATE POLICY "pd_decisions_insert" ON public.pd_decisions FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role));
-- Intentionally no UPDATE or DELETE policies — Decision Log is immutable.

CREATE POLICY "pd_auto_validation_admin_team" ON public.pd_auto_validation FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role));

CREATE POLICY "pd_review_bundles_admin_team" ON public.pd_review_bundles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role));

CREATE POLICY "pd_benchmarks_admin_team" ON public.pd_benchmarks FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_pd_proposals_status      ON public.pd_proposals (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pd_evidence_proposal     ON public.pd_evidence (proposal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pd_decisions_proposal    ON public.pd_decisions (proposal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pd_decisions_created_at  ON public.pd_decisions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pd_auto_validation_proposal ON public.pd_auto_validation (proposal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pd_benchmarks_metric     ON public.pd_benchmarks (metric_key, observed_at DESC);

-- Auto-bump updated_at on pd_proposals.
CREATE OR REPLACE FUNCTION public.pd_proposals_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pd_proposals_touch_updated_at ON public.pd_proposals;
CREATE TRIGGER trg_pd_proposals_touch_updated_at
  BEFORE UPDATE ON public.pd_proposals
  FOR EACH ROW EXECUTE FUNCTION public.pd_proposals_touch_updated_at();

-- Storage bucket for pd-evidence uploads. Private bucket; signed URLs only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('pd-evidence', 'pd-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: admin/team can read/write; nobody else.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'pd_evidence_admin_team_read') THEN
    CREATE POLICY "pd_evidence_admin_team_read" ON storage.objects FOR SELECT
      USING (
        bucket_id = 'pd-evidence'
        AND (public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'team'::public.app_role))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'pd_evidence_admin_team_write') THEN
    CREATE POLICY "pd_evidence_admin_team_write" ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'pd-evidence'
        AND (public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'team'::public.app_role))
      );
  END IF;
END $$;

-- Seed at least one of each benchmark metric so the Benchmarks tab renders
-- a non-empty sparkline on first load. Cron-fed updates land in later phases.
INSERT INTO public.pd_benchmarks (metric_key, value, metadata)
VALUES
  ('specs_shipped_per_day', 4, '{"source":"seed"}'::jsonb),
  ('verifier_pass_rate',    0.82, '{"source":"seed"}'::jsonb),
  ('cost_today',            12.40, '{"source":"seed"}'::jsonb)
ON CONFLICT DO NOTHING;
