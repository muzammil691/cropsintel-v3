---
priority: 3
depends-on:
  - phase-1.10z-atlas-events-and-dratlas-sdk
---

# Task: Phase 1.10ac — /atlas-pd page (Project Development surface)

**Master plan reference:** §1.6; §11.3 Phase 2.11 brought forward; user directive 2026-05-01.
**Context:** V1's `/atlas-pd` was the project-management surface — Master Plan viewer, Proposals queue, Approvals, Evidence, Decision Log, Validation results, Benchmarks, Review Bundles. It also had a `pd-ai-review` edge function that ran proposals through Claude for verdict + gaps. Together with `/atlas-brain` (1.10ab), these two pages constitute the V1 "PM cockpit" the user wants ported to V3.
**Estimated effort:** ~120 min Builder time (large)
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

A `/atlas-pd` page with 7 tabs:

1. **Master Plan** — read-only viewer of `.agent/master-plan.md`. Anchor links to phase rows. Shows current phase highlight (computed from `atlas_snapshots.current_phase`).
2. **Proposals** — CRUD on `pd_proposals` table. Filter by status (draft/in-review/approved/rejected/shipped). Each row → modal with full description + linked evidence + decisions.
3. **Approvals** — proposals where `status = 'in-review'`. Approve / reject / request-changes buttons (admin only). Approval logs to `pd_decisions` immutably.
4. **Evidence** — uploads/links of artefacts (commits, screenshots, audit reports) tied to a proposal. Drag-drop file upload to Supabase Storage `pd-evidence/`.
5. **Decision Log** — append-only log of every PD decision. Filterable by date / proposer / verdict. Cannot be edited — only appended.
6. **Validation** — `pd_auto_validation` runs (where Claude auto-judges proposal quality). Each row shows the AI verdict + raw response.
7. **Benchmarks** — track KPIs over time (e.g. "specs shipped per day", "verifier pass rate", "cost burn"). Sparkline per metric.
8. **Review Bundles** — group multiple proposals + evidence + decisions into a "review bundle" for stakeholder share. Generates a static markdown export.

Plus: **AI Review** button on each proposal → calls `pd-ai-review` edge fn → returns verdict + gap list → persists to `pd_auto_validation`.

## Schema

```sql
-- supabase/migrations/20260501070000_pd_tables.sql
CREATE TABLE IF NOT EXISTS public.pd_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  motivation text,
  status text NOT NULL DEFAULT 'draft',  -- 'draft' | 'in-review' | 'approved' | 'rejected' | 'shipped' | 'archived'
  proposer_id uuid REFERENCES auth.users(id),
  related_phase text,                     -- e.g. '1.10w'
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pd_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid REFERENCES public.pd_proposals(id) ON DELETE CASCADE,
  artefact_type text NOT NULL,           -- 'commit' | 'screenshot' | 'audit-report' | 'note'
  artefact_url text,
  description text,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pd_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid REFERENCES public.pd_proposals(id) ON DELETE CASCADE,
  verdict text NOT NULL,                 -- 'approved' | 'rejected' | 'changes-requested'
  rationale text NOT NULL,
  decided_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pd_auto_validation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid REFERENCES public.pd_proposals(id) ON DELETE CASCADE,
  verdict text NOT NULL,                 -- 'pass' | 'needs-work' | 'reject'
  ai_model text NOT NULL,                -- 'claude-opus-4-7' etc.
  reasoning text,
  gaps jsonb DEFAULT '[]'::jsonb,
  cost_usd numeric(10,4) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pd_review_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  proposal_ids uuid[] NOT NULL,          -- batch reference
  exported_markdown text,                -- cached rendered bundle
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pd_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key text NOT NULL,              -- 'specs_shipped_per_day' | 'verifier_pass_rate' | 'cost_today'
  value numeric NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

-- RLS: all PD tables admin/team only
DO $$ DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['pd_proposals','pd_evidence','pd_decisions','pd_auto_validation','pd_review_bundles','pd_benchmarks']) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY "%s_admin_team" ON public.%I FOR ALL USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'team'))$p$, t, t);
  END LOOP;
END $$;

CREATE INDEX idx_pd_proposals_status ON pd_proposals (status, updated_at DESC);
CREATE INDEX idx_pd_decisions_proposal ON pd_decisions (proposal_id, created_at);
CREATE INDEX idx_pd_benchmarks_metric ON pd_benchmarks (metric_key, observed_at DESC);
```

Storage bucket: `pd-evidence` (admin-team write, admin-team read).

## Research phase (MANDATORY)

`docs/atlas-pd-ui-research.md` committed BEFORE TSX. References:

- **Linear projects + cycles** — proposal lifecycle UX
- **Notion databases** — flexible tab views
- **GitHub Projects** — kanban + table dual-view
- **Productboard** — feature proposal management
- **Pitch / Coda** — review bundle aesthetic

## Architecture

```
src/
├── pages/
│   └── AtlasPD.tsx                       (NEW — tab orchestrator)
├── components/
│   └── atlas-pd/
│       ├── MasterPlanView.tsx             (NEW — markdown render)
│       ├── ProposalsTab.tsx               (NEW)
│       ├── ProposalDetailModal.tsx        (NEW)
│       ├── ProposalEditor.tsx             (NEW — markdown editor)
│       ├── ApprovalsTab.tsx               (NEW)
│       ├── EvidenceTab.tsx                (NEW — drag-drop upload)
│       ├── DecisionLogTab.tsx             (NEW)
│       ├── ValidationTab.tsx              (NEW)
│       ├── BenchmarksTab.tsx              (NEW — sparklines)
│       ├── ReviewBundlesTab.tsx           (NEW)
│       └── AiReviewButton.tsx             (NEW — invokes pd-ai-review)
├── hooks/
│   ├── usePdProposals.ts                  (NEW)
│   ├── usePdDecisions.ts                  (NEW)
│   └── usePdBenchmarks.ts                 (NEW)
└── lib/
    └── pd-client.ts                       (NEW)
supabase/
└── functions/
    └── pd-ai-review/
        └── index.ts                        (NEW — Claude review of a proposal)
```

## pd-ai-review edge function

`POST /pd-ai-review` body `{ proposal_id }`. Reads the proposal, sends to Claude Opus 4.7 with system prompt scoring criteria (clarity, scope, dependencies, NEVER-list compliance). Returns + persists to `pd_auto_validation`.

Cost log per call.

## Files

- `docs/atlas-pd-ui-research.md` (NEW — separate commit)
- `supabase/migrations/20260501070000_pd_tables.sql` (NEW)
- `supabase/functions/pd-ai-review/index.ts` (NEW)
- `src/pages/AtlasPD.tsx` (NEW)
- `src/components/atlas-pd/*.tsx` (10+ new files)
- `src/hooks/usePd*.ts` (NEW)
- `src/lib/pd-client.ts` (NEW)
- `src/App.tsx` (extend — add `/atlas-pd` route under admin guard)
- `src/lib/nav-config.ts` (extend — add nav item)

## Success criteria

- Research doc committed first (separate commit)
- `/atlas-pd` renders for admin/team; redirects others
- Master Plan tab renders the actual `.agent/master-plan.md` (fetch via Supabase fn or direct git read — pick one and document)
- Create proposal → appears in Proposals tab
- Submit for review → moves to Approvals
- Approve → logs to Decision Log immutably
- AI Review button → calls edge fn → result persists to Validation tab
- Upload evidence → file lands in `pd-evidence/` bucket
- Benchmarks tab shows ≥3 sparklines populated from `pd_benchmarks` (seed at least one cron-fed metric)
- Review Bundle tab generates downloadable markdown for selected proposals
- Lighthouse mobile ≥80, desktop ≥90, accessibility ≥95
- Designer agent verdict ≥ 0.7
- All tabs RBAC-gated

## Risks + mitigations

- **Risk:** Tab count = 7. Easy to ship as half-built. **Mitigation:** Each tab has its own `.tsx` + hook + tests; Verifier audits per tab; spec ships ONLY if all 7 work, otherwise remediation loop.
- **Risk:** Master plan markdown render needs a renderer. **Mitigation:** reuse existing markdown rendering from ChatPanel.tsx (already supports headers/lists/code blocks).
- **Risk:** Storage bucket `pd-evidence` security. **Mitigation:** RLS-equivalent on bucket; signed URLs only; never public.

## NEVER list

- Never let a proposal change status without a `pd_decisions` row
- Never delete `pd_decisions` rows (immutable log)
- Never expose proposal evidence to non-admin/team
