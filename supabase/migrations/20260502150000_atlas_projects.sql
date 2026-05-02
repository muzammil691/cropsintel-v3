-- Phase 1.10av — Multi-project Atlas.
--
-- Atlas becomes a standalone product hosting N projects. Each project owns
-- its own plan, queue, agents, chat context. CropsIntel V3 is seeded as the
-- first project so the migration is no-op for existing deployments.

CREATE TABLE IF NOT EXISTS public.atlas_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  display_name text NOT NULL,
  description text,
  repo_url text,
  master_plan_path text NOT NULL DEFAULT '.agent/master-plan.md',
  task_dir_path text NOT NULL DEFAULT '.agent/tasks',
  builder_url text,
  verifier_url text,
  designer_url text,
  council_url text,
  memory_url text,
  anthropic_key_env text,
  openai_key_env text,
  gemini_key_env text,
  whatsapp_to text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by uuid REFERENCES public.atlas_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.atlas_projects (slug, display_name, description, repo_url, whatsapp_to, anthropic_key_env, openai_key_env, gemini_key_env)
VALUES (
  'cropsintel-v3',
  'CropsIntel V3',
  'Almond market intelligence platform — first project running inside Atlas.',
  'git@github.com:muzammil691/cropsintel-v3.git',
  '+971562556592',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY'
)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.atlas_project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.atlas_projects(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.atlas_members(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','operator','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_atlas_project_members_member
  ON public.atlas_project_members(member_id);
CREATE INDEX IF NOT EXISTS idx_atlas_project_members_project
  ON public.atlas_project_members(project_id);

INSERT INTO public.atlas_project_members (project_id, member_id, role)
SELECT
  (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3'),
  id,
  role
FROM public.atlas_members
WHERE status = 'active'
ON CONFLICT DO NOTHING;

-- last_project_id on atlas_sessions so resolver can default to the most recent
-- project the member was working in.
ALTER TABLE public.atlas_sessions
  ADD COLUMN IF NOT EXISTS last_project_id uuid REFERENCES public.atlas_projects(id);

-- Add project_id to per-project tables. NULLABLE for backward compat; new rows
-- must populate it. Existing rows are backfilled to cropsintel-v3 below.
ALTER TABLE public.atlas_conversations  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_chat_summaries ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_events         ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_pending_specs  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_decisions      ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);

UPDATE public.atlas_conversations  SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_chat_summaries SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_events         SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_pending_specs  SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_decisions      SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_atlas_conversations_project
  ON public.atlas_conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_atlas_chat_summaries_project
  ON public.atlas_chat_summaries(project_id);
CREATE INDEX IF NOT EXISTS idx_atlas_events_project
  ON public.atlas_events(project_id);
CREATE INDEX IF NOT EXISTS idx_atlas_pending_specs_project
  ON public.atlas_pending_specs(project_id);
CREATE INDEX IF NOT EXISTS idx_atlas_decisions_project
  ON public.atlas_decisions(project_id);

ALTER TABLE public.atlas_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atlas_projects_service" ON public.atlas_projects;
CREATE POLICY "atlas_projects_service" ON public.atlas_projects FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_project_members_service" ON public.atlas_project_members;
CREATE POLICY "atlas_project_members_service" ON public.atlas_project_members FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
