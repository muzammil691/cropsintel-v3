# Atlas PD UI Research

**Author:** Builder agent (phase-1.10ac)
**Date:** 2026-05-01
**Purpose:** Inform the from-scratch design of `/atlas-pd`, the admin-only Project Development cockpit. Each reference below documents what works for managing a long-lived backlog of proposals, decisions, and evidence; what to borrow for Atlas PD; and what NOT to copy.

This document **must** be committed in its own commit before any TSX work in this task. Findings drive the seven-tab layout, the proposal lifecycle states, the immutable Decision Log motion, and the AI Review summary card.

---

## Goals the UI must serve

1. **Master Plan is the spine.** Every proposal lives or dies against the master plan. The plan tab must render as readable prose with anchor links per phase, and the **current phase highlight** must be impossible to miss.
2. **Proposals have a lifecycle, not a status field.** `draft → in-review → approved | rejected | shipped` is a flow with quiet transitions, not a freeform dropdown. The UI must surface what state a proposal is in *and* what's allowed next.
3. **Decisions are immutable.** Once approved/rejected, a proposal's outcome is locked. The Decision Log is append-only. The UI must visually communicate "this is history, not editable" through layout, tone, and the absence of edit affordances.
4. **AI Review is a second opinion, not a verdict.** Claude's gap analysis informs the human approver — it never auto-approves. The AI Review card must read as advice ("here are 3 gaps to consider"), not as a stamp.
5. **Evidence is one-click attach.** Drag-drop file upload + paste-link affordance. Evidence must surface inline on the proposal modal, not in a separate "files" page that breaks context.
6. **Bundles are exportable.** Stakeholders read markdown in Slack/email, not webapps. Every Review Bundle must export as plain markdown that survives copy-paste into any chat tool.
7. **Benchmarks are ambient.** Sparklines per metric, no axes, no tooltips that demand interaction. The user glances and gets a directional signal, not a forensic audit.

---

## 1. Linear — Projects + Cycles

**What works:** Linear's project lifecycle (`backlog → planned → in progress → completed`) is enforced by the UI: the status pill is the one place state changes, transitions log to an activity feed, and the activity feed is *append-only*. Cycles (sprint-equivalent) bound proposals to a window so the team sees what's on the table this week vs. backlog. Crucially, Linear's project page has tabs (Overview / Issues / Updates / Properties) and the tabs preserve scroll position when switching back.

**Borrow for Atlas PD:**
- **Tab state preservation.** When the user clicks Proposals → opens a modal → switches to Decision Log → comes back to Proposals, the previous filter + scroll position must restore. Use `useSearchParams` for tab + filter state so deep-links work.
- **Proposal status pill is the one source of truth.** Status is not changeable from within an open modal — only from the explicit "Submit for review" / "Approve" / "Reject" buttons. No raw select dropdown.
- **Activity feed = Decision Log.** Every status transition writes a `pd_decisions` row. Decisions render with author avatar + timestamp + verdict badge + rationale block. Never editable.

**Do NOT copy:**
- Linear's "snooze" feature on proposals — Atlas PD doesn't snooze; either it's in-review or it's not. Snoozing creates ambiguity about who owns the proposal next.
- Linear's keyboard-driven command palette as the *primary* nav. Admin/team will use this on mobile too — buttons + tabs need to stand on their own without keyboard shortcuts.

---

## 2. Notion — Database views (table / board / gallery)

**What works:** Notion lets one underlying table render as table, board, or gallery, with each view persisting its own filters/sort. The user picks the view that matches their current task: triaging? board. Browsing? table. Reading? gallery. Filters are one-click chips at the top, never buried in a side panel.

**Borrow for Atlas PD:**
- **Filter chips at top of Proposals tab.** Status (draft / in-review / approved / rejected / shipped) renders as a row of clickable chips with counts. Multi-select. The chips are the filter UI — no separate "Filter" button.
- **Modal preserves the row position.** Notion's database row → modal pattern keeps the row highlighted in the table behind the modal. When the modal closes, the table scroll position is unchanged. Use this exact pattern for Proposals.

**Do NOT copy:**
- Notion's view switcher (table/board/gallery toggle). Atlas PD has *one* view per tab — adding view switching multiplies the surface area without serving a real workflow. Pick the right view per tab and commit.
- Notion's inline-editable cells. Proposals are dense markdown; editing inline is a UX trap. Open the modal to edit.

---

## 3. GitHub Projects — Kanban + table dual-view

**What works:** GitHub Projects' table view shows a flat list of issues with sortable columns, status pills, and assignees. Filters are persisted in the URL. The "Group by status" toggle visually clusters rows by their lifecycle bucket. Most useful: GitHub's PR review UI shows a **diff view + comment thread side-by-side**, with the comment thread anchored to specific lines.

**Borrow for Atlas PD:**
- **Group by status as default in Proposals tab.** Rows cluster under `in-review (N)`, `draft (N)`, etc. Each group is collapsible. Mirrors how GitHub's Projects board reads.
- **Approvals tab = focused subset.** Approvals tab shows ONLY `status = 'in-review'` rows in a single dense list — no group-by, no filter chips. Each row has Approve / Reject / Request Changes inline buttons (no need to open the modal for a quick decision).

**Do NOT copy:**
- GitHub's deep nesting of comment threads on PRs. Decision Log is flat, append-only — a single chronological list. Don't introduce thread reply nesting; rationale is a single paragraph.

---

## 4. Productboard — Feature proposal management

**What works:** Productboard's "feature" object has a *proposal* state that tracks evidence (linked tickets, customer quotes, screenshots). The right side of every feature card shows linked evidence as compact pill-rows with thumbnail previews. Drag-drop attach works from the OS file picker AND from a paste event.

**Borrow for Atlas PD:**
- **Evidence pill-rows** on the proposal modal: each `pd_evidence` row renders as a compact row with type icon (commit/screenshot/audit-report/note), description, and a "view" link. New evidence drops below the existing list with a fade-in.
- **Drag-drop + paste both work.** Drag a file onto the modal → upload to `pd-evidence/` bucket. Paste a URL → insert as `artefact_type='note'` with `artefact_url` populated.

**Do NOT copy:**
- Productboard's "score this proposal 1–5 stars" voting widget. Atlas PD is admin-only, single-user (or small team) — voting introduces ceremony for no payoff. The Approve/Reject buttons + AI Review are sufficient signal.
- Productboard's customer-tagged feedback weighting. We don't have customer-tagged feedback yet; don't build the surface.

---

## 5. Pitch / Coda — Review bundle aesthetic

**What works:** Pitch decks and Coda docs both use **wide horizontal layouts** with generous whitespace for read-only review surfaces. Sections have soft headers, no boxes, plenty of vertical rhythm. Pitch's "share" generates a clean URL that opens to a read-only doc — no auth wall, no comments, no UI chrome.

**Borrow for Atlas PD (Review Bundles tab):**
- **Bundle preview = read-only markdown render**, full width, no sidebar, no chrome. Mimics the experience of reading the bundle in Slack/email.
- **Export-as-markdown button** copies to clipboard AND downloads a `.md` file. Two affordances, one source of truth.

**Do NOT copy:**
- Pitch's collaborative cursors / real-time co-editing. Bundles are exported snapshots — they don't need to be live. Snapshot at export time, store in `exported_markdown`, render from that.

---

## 6. Cursor / GitHub Copilot — AI review summary card

**What works:** Cursor's "review my code" panel and GitHub Copilot's PR review summary both surface AI feedback as a single card with: verdict badge (pass/needs-work/fail), 1-paragraph reasoning, bulleted gap list, and a model-attribution footer ("reviewed by claude-3.5-sonnet, $0.04, 2.3s"). The card never auto-applies its suggestions — the human is always the actor.

**Borrow for Atlas PD (Validation tab + AI Review button):**
- **AI Review card layout:** verdict pill (color-coded: pass=emerald, needs-work=amber, reject=red), 1-paragraph reasoning, bulleted `gaps` list (each with a checkbox the human can tick), and a small footer with model + cost + duration.
- **AI Review never mutates proposal status.** It writes to `pd_auto_validation`. The human still has to click Approve/Reject in the Approvals tab. AI is advice, not the decision.

**Do NOT copy:**
- Copilot's "auto-apply suggestion" button. We never auto-apply; PD is governance-grade, not a coding tool.
- Cursor's per-line inline comments on a code file. Proposals are markdown narratives, not code; per-line comments would be over-engineered.

---

## 7. Sparklines — Tufte / Datadog / Linear

**What works:** Tufte's original sparkline spec: word-length, baseline-aligned, no axes, no labels in the chart itself. Datadog and Linear both render this — a thin trend line, the latest value as a number to the right, optional band shading for min/max. Reads in 200ms; no interaction required.

**Borrow for Atlas PD (Benchmarks tab):**
- **Per-metric sparkline + latest value + delta-vs-prior.** Three columns: metric label, sparkline (recharts, no axes), `123 ▲ +5` style trailing value+delta.
- **No tooltips that fire on hover.** The strip is the data — clicking a sparkline navigates to a detail view (later phase). For 1.10ac, no detail view yet.

**Do NOT copy:**
- Datadog's full timeseries explorer. We have ≤6 metrics; an explorer is overkill. Static sparkline list is enough.

---

## Synthesis: layout decisions locked

- **Page shell:** top tab bar with 7 tabs. Tabs persist in `?tab=` URL param. Mobile: same tabs, horizontally scrollable.
- **Tab 1 — Master Plan:** fetch raw `.agent/master-plan.md`, render with custom markdown renderer (reuse `Atlas` page's `renderMarkdown` if available, else write small renderer). Anchor `id` per `## Phase X.Y` heading. Top of pane shows current phase (from `atlas_snapshots.current_phase` if present, else from latest `pd_proposals` `related_phase`).
- **Tab 2 — Proposals:** group-by-status table with filter chips at top. New Proposal button top-right. Row click → modal with title, description (markdown), motivation, status pill, evidence list, decisions list, AI Review button.
- **Tab 3 — Approvals:** dense list of `status = 'in-review'`. Each row has inline Approve / Reject / Request-Changes buttons (each opens a small dialog requiring rationale). Decision logged to `pd_decisions`.
- **Tab 4 — Evidence:** flat list of all `pd_evidence` rows, grouped by `proposal_id`. Drag-drop + paste affordance at top. Filter by proposal title.
- **Tab 5 — Decision Log:** append-only chronological list. Filter chips: date range, verdict, decided_by. Each row: timestamp, proposal title, verdict pill, rationale paragraph. No edit affordance anywhere.
- **Tab 6 — Validation:** list of `pd_auto_validation` rows (latest first). Each: verdict pill, model, reasoning, gaps list, cost. Click row → expand to full reasoning.
- **Tab 7 — Benchmarks:** list of metric rows; sparkline + latest + delta. Currently 3 seeded metrics (`specs_shipped_per_day`, `verifier_pass_rate`, `cost_today`) — more to come from cron in later phases.
- **Tab 8 — Review Bundles:** list of bundles + "Create Bundle" button (opens dialog: title, description, multi-select proposals). Each bundle row → full-width preview with copy-as-markdown + download buttons.
- **AI Review button** lives on the proposal modal. Click → POST `/pd-ai-review {proposal_id}` → wait for response (8–15s, show spinner) → result inserts into Validation tab + appears as a card under the modal's AI Review section.
- **RBAC:** entire page gated to admin OR team via inline `useAuth()` check (mirrors `/atlas-brain` pattern).
- **Storage bucket:** `pd-evidence` (admin-team RLS, signed URLs only, never public).
- **Reduce-motion:** respect `prefers-reduced-motion`; fade-ins gated behind the media query.
