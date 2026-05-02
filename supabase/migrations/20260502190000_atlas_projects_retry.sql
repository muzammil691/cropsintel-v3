-- =============================================================================
-- Migration: atlas_projects + atlas_project_members retry (phase-1.10av follow-up)
-- =============================================================================
-- Same migration-tracking quirk as 20260502170000: the prior 1.10av migration
-- (20260502150000_atlas_projects.sql) was registered in
-- supabase_migrations.schema_migrations but the CREATE TABLE statements never
-- ran. Result: every authenticated request 403/401s because requireAuth
-- resolves project-context which queries these missing tables.
--
-- This blocks OTP login: the verify-otp handler issues a session token, the
-- frontend stores it and redirects to /atlas, AtlasAuthGuard validates via
-- /atlas/auth/me, /me's requireAuth → resolveProjectContext → throws because
-- atlas_project_members doesn't exist → 401 → frontend wipes localStorage →
-- bounce back to /atlas/login. Hence the user-reported "verify and return to
-- the very start" loop.
--
-- This migration is idempotent: CREATE TABLE IF NOT EXISTS, ALTER COLUMN guards.
-- =============================================================================

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
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atlas_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atlas_projects_service" ON public.atlas_projects;
CREATE POLICY "atlas_projects_service" ON public.atlas_projects FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Seed CropsIntel V3 as the first project. ON CONFLICT prevents duplicate seed.
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
ON CONFLICT (slug) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      description  = EXCLUDED.description,
      repo_url     = EXCLUDED.repo_url;

CREATE TABLE IF NOT EXISTS public.atlas_project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.atlas_projects(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.atlas_members(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','operator','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, member_id)
);

ALTER TABLE public.atlas_project_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atlas_project_members_service" ON public.atlas_project_members;
CREATE POLICY "atlas_project_members_service" ON public.atlas_project_members FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Backfill: every existing active atlas_members row gets attached to
-- cropsintel-v3 with their global role. Idempotent via UNIQUE + ON CONFLICT.
INSERT INTO public.atlas_project_members (project_id, member_id, role)
SELECT
  (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3'),
  id,
  role
FROM public.atlas_members
WHERE status = 'active'
ON CONFLICT (project_id, member_id) DO NOTHING;

-- last_project_id on atlas_sessions for the resolver's default-fallback.
ALTER TABLE public.atlas_sessions
  ADD COLUMN IF NOT EXISTS last_project_id uuid REFERENCES public.atlas_projects(id);

-- project_id columns on per-project tables. All NULLABLE for backward compat.
ALTER TABLE public.atlas_conversations    ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_chat_summaries   ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_events           ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_pending_specs    ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_decisions        ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);

-- Backfill project_id on existing rows.
UPDATE public.atlas_conversations  SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_chat_summaries SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_events         SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_pending_specs  SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_decisions      SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;

-- Reload PostgREST schema cache so the new tables are queryable immediately.
NOTIFY pgrst, 'reload schema';
