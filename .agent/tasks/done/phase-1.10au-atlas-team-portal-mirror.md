---
priority: 2
depends-on: [phase-1.10ao-atlas-team-management]
---

# Task: Phase 1.10au — Team portal mirror (errors visible to team, team reports back)

**Master plan reference:** §1.10 Atlas conductor; user vision discussion 2026-05-02 ("If something needs team action → notify the team. Errors surfaced in both Atlas UI (your view) and Team Portal (team's face). Team can report errors from the team portal back into Atlas").

**Context:** Atlas's cockpit is for the owner only — viewers/operators/admins can sign in (per 1.10ao roles) but the cockpit is a single shared view. The user wants a **simplified team-portal** at `/team` that:

1. Shows the subset of artifacts that need team action (filtered, role-aware).
2. Lets team members report new errors / observations back to Atlas without owner needing to be online.

**Estimated effort:** ~70 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — `/atlas/team-portal` route

A separate route from `/atlas` (the cockpit). Opens a stripped-down, focused view:

```
┌──────────────────────────────────────────────────────────┐
│ Atlas Team Portal — <member display_name>  [Logout]      │
├──────────────────────────────────────────────────────────┤
│ ASSIGNED TO YOU (3)                                       │
│ ❌ verifier audit fail · phase-1.X · 12 min ago           │
│   [View detail]  [Mark as fixed]  [Send to owner]         │
│ ...                                                       │
├──────────────────────────────────────────────────────────┤
│ REPORT AN ERROR                                           │
│ Subject: [_________________________]                      │
│ Description: [______________________________________]     │
│ Severity: [low / medium / high]                           │
│ Attach screenshot: [📎]                                   │
│ [Submit report]                                           │
├──────────────────────────────────────────────────────────┤
│ ANNOUNCEMENTS FROM ATLAS                                  │
│ • Build is healthy as of 13:24                            │
│ • Phase 1.10ar shipping in ~25 min                        │
└──────────────────────────────────────────────────────────┘
```

Designed for non-developer team members — they see what they need to act on, plus a simple report form, plus a one-line build-health summary. NO direct access to specs, agents tab, or any owner-only tooling.

### Part B — Routes + auth gate

`src/pages/atlas/AtlasTeamPortal.tsx` (NEW): registered at `/team` in `App.tsx`. Wrapped in the same `AtlasAuthGuard` as the cockpit.

**Role behavior:**
- `owner`: redirects to `/atlas` (the cockpit) — owners use the full cockpit, not the portal.
- `admin`: sees the portal AND has a "Switch to cockpit" button at top-right.
- `operator`: sees the portal, can submit reports, can mark items as fixed.
- `viewer`: sees the portal in read-only mode (no action buttons, can still submit reports).

Add a "Switch to portal" button in the cockpit header for owners who want to preview what the team sees.

### Part C — Schema

Migration `supabase/migrations/20260502140000_team_portal.sql`:

```sql
-- Items assigned to a team member (or unassigned, broadcast to all admins).
CREATE TABLE IF NOT EXISTS public.atlas_team_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_kind text NOT NULL,        -- 'verifier_run' | 'designer_audit' | 'open_fork' | 'manual_report'
  artifact_ref text NOT NULL,
  assigned_to_member_id uuid REFERENCES public.atlas_members(id),  -- NULL = broadcast to all admins
  assigned_by uuid REFERENCES public.atlas_members(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed','escalated','dismissed')),
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_atlas_team_assignments_open
  ON public.atlas_team_assignments (assigned_to_member_id, status, created_at DESC) WHERE status = 'open';

-- Reports submitted from the team portal back to Atlas.
CREATE TABLE IF NOT EXISTS public.atlas_team_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_member_id uuid NOT NULL REFERENCES public.atlas_members(id),
  subject text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  attachments jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  triaged_at timestamptz,
  triaged_by uuid REFERENCES public.atlas_members(id),
  triage_notes text
);
CREATE INDEX IF NOT EXISTS idx_atlas_team_reports_new
  ON public.atlas_team_reports (status, created_at DESC) WHERE status = 'new';

ALTER TABLE public.atlas_team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_team_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "atlas_team_assignments_service" ON public.atlas_team_assignments
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "atlas_team_reports_service" ON public.atlas_team_reports
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
```

### Part D — Server routes

All under `/atlas/team-portal/*`, all auth-gated.

- **GET `/atlas/team-portal/assignments`** — returns open items assigned to the calling member OR broadcast (`assigned_to_member_id IS NULL` AND member role >= admin).
- **POST `/atlas/team-portal/assignments/:id/resolve`** — body `{ status: 'fixed'|'escalated'|'dismissed', notes? }`. Updates the row + writes an `atlas_events` row.
- **GET `/atlas/team-portal/announcements`** — recent build-health snapshot (cost today, queue depth, in-flight) + last 3 ship commits + any pinned messages from owner.
- **POST `/atlas/team-portal/reports`** — body `{ subject, description, severity, attachments? }`. Inserts an `atlas_team_reports` row + sends a WhatsApp ping to owner (`+971562556592`) with the subject + reporter name.
- **GET `/atlas/team-portal/reports`** — owner+admin only — list of all reports for triage.
- **POST `/atlas/team-portal/reports/:id/triage`** — owner+admin — body `{ status, notes }`. Optional: if status='triaged' AND severity='high', auto-create an `atlas_team_assignments` row pointing to the reporter so they're notified of progress.

### Part E — Owner cockpit integration

In the existing cockpit's Artifacts tab, each artifact card gets a new action: **`[Assign to team]`** dropdown (owner only). Picks a member from `atlas_members` (admin/operator role only — viewers can't be assigned), creates an `atlas_team_assignments` row.

The Artifacts tab also gets a "Reports inbox" sub-section showing new `atlas_team_reports` rows so the owner sees what the team is reporting without leaving the cockpit.

### Part F — Frontend file structure

- `src/pages/atlas/AtlasTeamPortal.tsx` (NEW)
- `src/components/atlas/team-portal/AssignmentList.tsx` (NEW)
- `src/components/atlas/team-portal/AssignmentRow.tsx` (NEW)
- `src/components/atlas/team-portal/ReportForm.tsx` (NEW)
- `src/components/atlas/team-portal/AnnouncementsBanner.tsx` (NEW)
- `src/components/atlas/team-portal/AssignToTeamMenu.tsx` (NEW — dropdown used by owner in the cockpit Artifacts tab)
- `src/components/atlas/tabs/AtlasArtifactsTab.tsx` (extend — `[Assign to team]` button + Reports inbox sub-section)
- `src/lib/atlas-client.ts` (extend — team-portal API helpers)

## Success criteria

- `npm run build` clean
- Migration applies cleanly; `atlas_team_assignments` and `atlas_team_reports` tables exist.
- Sign in as owner → see "Switch to portal" button in cockpit header.
- Sign in as a `viewer` test account → land on `/team`, see read-only assignment list + report form (no action buttons on assignments).
- Submit a report → owner gets a WhatsApp ping with the subject; the report appears in cockpit Artifacts tab "Reports inbox".
- Owner clicks `[Assign to team]` on an artifact → assignment created → member sees it in their `/team` portal within a 5s poll cycle.
- Member clicks `[Mark as fixed]` → assignment status flips, owner sees it cleared in cockpit.

## Risks + mitigations

- **Risk:** Spam reports from compromised member account. **Mitigation:** Rate-limit `POST /atlas/team-portal/reports` to 5 per member per hour.
- **Risk:** Attachments in reports could exfiltrate sensitive data. **Mitigation:** attachments are file URLs only (Supabase Storage); RLS prevents cross-member reads.
- **Risk:** Owner gets notification spam. **Mitigation:** Only `severity: 'high'` reports trigger immediate WhatsApp; medium/low are batched into a daily summary.

## NEVER list

- Never expose owner-only routes (specs, agents, costs in detail) inside `/team`.
- Never let a `viewer` role mark items as fixed (read-only).
- Never let a non-owner triage reports.
- Never strip `attachments` from the WhatsApp ping payload — owner needs to see what the team attached.
