---
priority: 3
depends-on: [phase-1.10ao-atlas-team-management]
---

# Task: Phase 1.10av — Multi-project Atlas (project switcher + per-project isolation)

**Master plan reference:** §1.10 Atlas conductor; user vision discussion 2026-05-02 ("Atlas is a standalone product. Each project has its own plan, queue, agents, chat context — fully isolated. CropsIntel V3 is the first project running inside it").

**Context:** Today everything in Atlas implicitly assumes a single project ("CropsIntel V3"). The user's vision is that Atlas is a STANDALONE product that hosts MULTIPLE projects. CropsIntel is just the first. This spec adds the data layer + UI switcher so the same Atlas instance can manage N projects with isolated plan/queue/agents/chat.

This is the biggest single architectural change in the v2 sprint. Scoped tightly to avoid scope creep — actual second project setup is out of scope; this just creates the infrastructure so a second project COULD be added.

**Estimated effort:** ~90 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — `atlas_projects` table + seed CropsIntel as project #1

Migration `supabase/migrations/20260502150000_atlas_projects.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.atlas_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,           -- 'cropsintel-v3', 'project-2', etc.
  display_name text NOT NULL,
  description text,
  repo_url text,                        -- the git repo this project lives in
  master_plan_path text NOT NULL DEFAULT '.agent/master-plan.md',
  task_dir_path text NOT NULL DEFAULT '.agent/tasks',
  -- Per-project Builder/Verifier/Designer endpoints (so different projects can use different agents).
  builder_url text,
  verifier_url text,
  designer_url text,
  council_url text,
  memory_url text,
  -- Per-project AI key labels (don't store keys here — store env var NAMES that Atlas resolves at runtime).
  anthropic_key_env text,
  openai_key_env text,
  gemini_key_env text,
  -- WhatsApp settings per project.
  whatsapp_to text,                     -- recipient phone for owner notifications
  -- Lifecycle.
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by uuid REFERENCES public.atlas_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the existing project so day-1 nothing changes for the user.
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

-- Project membership: which atlas_members can access which project (and at what role).
CREATE TABLE IF NOT EXISTS public.atlas_project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.atlas_projects(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.atlas_members(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','operator','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, member_id)
);

-- Day-1: every existing atlas_members gets attached to cropsintel-v3 with the same role they have globally.
INSERT INTO public.atlas_project_members (project_id, member_id, role)
SELECT
  (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3'),
  id,
  role
FROM public.atlas_members
WHERE status = 'active'
ON CONFLICT DO NOTHING;

-- Add project_id to existing per-project tables. NULLABLE for backward compat;
-- new rows must populate it. Migration backfills existing rows to cropsintel-v3.
ALTER TABLE public.atlas_conversations ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_chat_summaries ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_events ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_pending_specs ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);
ALTER TABLE public.atlas_decisions ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.atlas_projects(id);

UPDATE public.atlas_conversations SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_chat_summaries SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_events SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_pending_specs SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;
UPDATE public.atlas_decisions SET project_id = (SELECT id FROM public.atlas_projects WHERE slug = 'cropsintel-v3') WHERE project_id IS NULL;

ALTER TABLE public.atlas_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_project_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "atlas_projects_service" ON public.atlas_projects FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "atlas_project_members_service" ON public.atlas_project_members FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
```

### Part B — Server: project context resolver

**`atlas/src/lib/project-context.ts`** (NEW):

Every authenticated request resolves to a `currentProjectId`:
1. Header `X-Atlas-Project: <slug>` if present and the member has access.
2. Else the session's last-active project (`atlas_sessions.last_project_id`, NEW column on the migration above).
3. Else the first project the member has access to.
4. Else error 403 "no project access".

**Add `last_project_id` to `atlas_sessions`** in the same migration.

**`requireAuth()` in `server.ts`** (extend):
- Resolve `currentProjectId` after authenticating the principal.
- Return `{ phone, sessionId, role, memberId, projectId }` instead of just the phone+role.
- Every existing query that filters by thread / spec / etc. now ALSO filters by `project_id = principal.projectId`.

### Part C — Project switcher in the cockpit header

`src/components/atlas/AtlasHeader.tsx` (extend):

Top-left, after the Atlas logo: a project chip showing the current project name. Click → opens a popover with:
- List of projects the member has access to (with their role per project)
- "+ New project" button (owner only) → opens a Dialog with form: slug, display_name, description, repo_url. Submit creates an `atlas_projects` row + auto-attaches the owner.

Selecting a project from the list:
- Updates `atlas_sessions.last_project_id` server-side via `POST /atlas/projects/:slug/select`.
- Frontend: full reload of cockpit (cleanest way to re-fetch all per-project state).

### Part D — Server routes

- **GET `/atlas/projects`** — list projects the calling member has access to.
- **POST `/atlas/projects`** — owner only. Body `{ slug, display_name, description?, repo_url? }`.
- **GET `/atlas/projects/:slug`** — full project metadata + member list (owner+admin only).
- **POST `/atlas/projects/:slug/select`** — sets `atlas_sessions.last_project_id`.
- **POST `/atlas/projects/:slug/members`** — owner+admin invite member to project (similar to team invite but project-scoped).
- **DELETE `/atlas/projects/:slug/members/:member_id`** — remove member from project (owner only).

### Part E — Filesystem layout (per-project)

Each project's spec/queue/done dirs are isolated by repo. `cropsintel-v3` lives in its own repo (current). Future projects would each be cloned into their own directory.

For day-1, ONLY `cropsintel-v3` is operational. The `atlas_projects.repo_url` field is populated for cropsintel; future projects would set their own. The Builder agent loop already clones based on `REPO_URL` env var — multi-project Builder routing is OUT of scope for this spec (each project gets its own Builder Railway service in a future spec).

What this spec enables:
- One Atlas dashboard manages multiple projects' DATA (chat, plans, audits)
- Each project has isolated chat threads, plan trees, artifact lists
- Future spec adds the per-project Builder / agent routing

### Part F — Migrate the in-memory chat handler

`atlas/src/server.ts` chat handler today uses `thread_id = 'web-default'` as the canonical thread. After this spec, the canonical thread is `<project_slug>:web-default` and all queries scope by project.

For backward compatibility: requests that send `thread_id = 'web-default'` (no project prefix) get auto-prefixed with the current project's slug. So the frontend doesn't need to change immediately.

## Files

- `supabase/migrations/20260502150000_atlas_projects.sql` (NEW)
- `atlas/src/lib/project-context.ts` (NEW)
- `atlas/src/server.ts` (extend — auth resolves project, all queries scope by project, new routes)
- `src/components/atlas/AtlasHeader.tsx` (extend — project chip + popover + new-project dialog)
- `src/components/atlas/projects/ProjectSwitcher.tsx` (NEW)
- `src/components/atlas/projects/NewProjectDialog.tsx` (NEW)
- `src/lib/atlas-client.ts` (extend — projects API)

## Success criteria

- `npm run build` clean
- Migration runs cleanly; `cropsintel-v3` project exists; existing members are attached.
- Existing data (conversations, summaries, events, pending specs, decisions) all have `project_id = cropsintel-v3` after backfill.
- Cockpit header shows "CropsIntel V3" project chip.
- Click chip → see only the cropsintel-v3 project listed.
- Owner clicks "+ New project" → form opens → can create a stub project (e.g., slug=test-proj).
- Switching to test-proj → cockpit reloads with empty plan/queue/audits/chat (per-project isolation works).
- Switching back to cropsintel-v3 → original data restored.
- Existing API calls without `X-Atlas-Project` header continue working (default to cropsintel-v3 via `atlas_sessions.last_project_id`).

## Risks + mitigations

- **Risk:** Backfill of `project_id` on large tables locks the DB. **Mitigation:** existing tables are small (<10k rows), single UPDATE is fine; if scaling becomes an issue, batch it.
- **Risk:** Forgetting to scope a query by `project_id` leaks data across projects. **Mitigation:** explicit code review checkpoint — every SELECT/INSERT/UPDATE on the touched tables MUST include `project_id` filter or value. Document at the top of `server.ts`.
- **Risk:** Existing frontend code uses `thread_id = 'web-default'` directly. **Mitigation:** Server auto-prefixes for backward compat (Part F).

## NEVER list

- Never let a member access a project they're not a member of — every server route checks via `atlas_project_members`.
- Never delete a project (only archive). Data retention.
- Never assume project_id from the URL alone — always cross-check against the authenticated member's access list.
- Never run a Supabase migration in this spec that drops or renames an existing column. Add-only.
