---
phase: 1.10aj
title: Plan tab build cockpit — concepts panel, selection wizard, phase actions, build runner
status: planned
gate: in-progress count <= 2 AND phase 1.10ai shipped
order: final-atlas-spec-before-cropsintel-v1
estimated_builder_minutes: 35
estimated_cost_usd: 8
master_plan_section: 11.7
---

# Phase 1.10aj — Plan tab build cockpit

## Why this exists

Today's Plan tab is a read-only viewer. After this spec, it becomes the **build cockpit** — the single screen Muzammil uses to drive every CropsIntel V1 phase from concept to shipped feature. After this lands, Muzammil curates the *what* via clicks; Atlas handles the *how* and the execution. Manual hand-coding of specs by humans (or by Cowork-Claude) becomes the exception, not the rule.

The cockpit has four parts:
1. **Concepts panel** — where ideas come in.
2. **Plan workspace** — where the sequenced phase tree lives, with per-node actions.
3. **Selection wizard** — where Atlas turns vague phases into concrete specs through multi-choice questions.
4. **Build runner** — where Atlas executes the plan with approval gates.

## Foundation-first check

- ✅ `atlas_plan_node_state` Supabase table exists.
- ✅ `atlas/src/lib/plan-parser.ts` reads master-plan.md.
- ✅ `atlas/src/lib/plan-server.ts` serves Plan API.
- ✅ `src/components/atlas-plan/PlanTree.tsx` renders the tree.
- ✅ `src/components/atlas/tabs/AtlasPlanTab.tsx` is the consumer.
- ✅ `atlas/src/lib/claude-code-prompt-builder.ts` exists (Atlas already writes Claude prompts — we extend this for spec authoring).
- ✅ Twilio + WhatsApp integration exists (`atlas/src/lib/twilio.ts`, `atlas/src/lib/whatsapp-split.ts`).
- ✅ Supabase Storage exists with `voice-notes` bucket — pattern reusable for `concepts` bucket.

We are extending these, not replacing.

## What ships

### Part A — Concepts panel (left rail, ~280px wide)

A new component `src/components/atlas-plan/ConceptsPanel.tsx`:

**Inputs accepted:**
- **Paste text** — large textarea, "Paste a concept" button, persists to `concepts` Supabase table.
- **Upload file** — drag-drop or button. Supported: txt, md, pdf, png, jpg, docx. Goes to `chat-attachments` Storage bucket (reuse from spec 1.10ad if shipped, or create here if not).
- **Link past chat** — search box: "Find concept from past Cowork or Atlas chat." Hits `agent_audit_log` and chat history; returns matching threads; user picks one and it's referenced as a concept.
- **Voice memo** — record button, ElevenLabs Whisper transcribes, stores both audio and transcript.

**Display:**
- List of concepts as cards: `{title, source_type, created_at, used_in_phases: [...]}`.
- Click a card → opens detail drawer with full content + "use in current phase" button.
- Tag each concept with `theme` (auto-suggested by Claude Haiku at intake): "auth", "data spine", "ui polish", etc. User can override.

**Storage:**
- New table `concepts(id uuid pk, title text, content text, source_type text, source_ref text, theme text, used_in_phases jsonb, created_at timestamptz default now(), created_by uuid references profiles(id))`.
- Migration: `supabase/migrations/<ts>_concepts.sql`.

### Part B — Plan workspace (center, full remaining width)

Extension of existing `PlanTree.tsx`. Each phase node gains 4 action buttons:

| Button | What it does |
|---|---|
| **Add** | Insert a new sub-phase under this node. Opens the wizard (Part C) seeded with parent context. |
| **Modify** | Edit this phase. Opens wizard with current phase as starting point. |
| **Follow** | Commit this phase to the build queue. Spec(s) are written and moved to `.agent/tasks/queued/` in dependency order. |
| **Revisit** | Mark phase `status: revisit` — visible in tree, dimmed, skipped during build runner. Click again to un-revisit. |

The "Build" button at the bottom of the tree triggers the **Build runner** (Part D) over all phases with `status: follow`.

A node's status drives its visual:
- `planned` — neutral, no action taken
- `wizard-active` — yellow, wizard is being filled
- `follow` — emerald, queued for build
- `revisit` — slate-400, dimmed
- `building` — blue with pulse, currently in flight
- `built` — emerald-700 with check, in `done/`

### Part C — Selection wizard

When user clicks Add or Modify, opens a modal `<PhaseWizard>` (or right rail panel — designer decides).

**The wizard logic:**
1. Atlas reads: parent phase context, master plan section, all concepts tagged with relevant theme, recent done specs.
2. Atlas (via Claude Sonnet) proposes 3-7 multi-choice questions that resolve the phase from vague to concrete. Examples:
   - "What's the primary user role for this feature?" [registered / verified / admin / any]
   - "Should this integrate with WhatsApp?" [yes — outbound / yes — inbound / no]
   - "Data shape: read-only / read+write / event-based?"
   - "Approve auto-confirmation on small offers?" [yes / no — always Maxons review]
3. User clicks through. Each answer narrows scope.
4. Final question is always: "Looks good — generate spec?" → Atlas generates a full spec markdown file, shows a preview, user clicks "Save & Add to Follow list."
5. Free-text override available at any step ("None of the above — let me describe it") → falls back to a textarea.

**Backend:** new endpoint `POST /atlas/plan/wizard/propose` takes phase context + concepts, returns questions. `POST /atlas/plan/wizard/finalize` takes answers, returns spec markdown + suggested filename.

This is `claude-code-prompt-builder.ts` extended — Atlas was already writing Claude prompts for itself; now it writes them for the human's plan too.

### Part D — Build runner

When user clicks **Build** at bottom of tree:

1. **Pre-flight check:** Atlas checks all `follow` phases — are their dependencies (other phases) also followed? If a phase needs another not in the build, warn and offer to add. Sequence them topologically.
2. **Confirmation modal:** "Build runner will queue 5 phases (12 specs) over ~3 hours wall clock. Approve all? Or per phase?"
   - Clicking "Approve all" → all specs queue at once, Atlas conductor runs them in order based on `gate:` conditions.
   - Clicking "Per phase" → first phase queues, others wait.
3. **Per-phase mode:** before each phase starts:
   - Atlas posts to dashboard chat: `"Phase 1.3 Auth ready to start. 3 specs queued, est. 25min, will deliver: registered/verified/admin tiers, V1/V2 user bridge, 4 login methods. Approve?"`
   - Same message goes to WhatsApp.
   - Same message visible in Plan tab as a sticky banner with Approve/Modify/Skip/Pause buttons.
4. User confirms (chat reply "yes," WhatsApp "approve," or button click) → phase ships.
5. After phase ships, Verifier audits, Designer audits, fix loop runs if needed, **only when phase is verified-clean does the next confirmation fire.**
6. If any phase fails 3 audit rounds, runner pauses, asks user via WhatsApp + chat + banner: "Phase X failed audit. Auto-investigate? Skip? Manual takeover?"

### Part E — Approval API surface

Three input channels, all converge to one endpoint `POST /atlas/plan/approve`:

| Channel | How it lands |
|---|---|
| Plan tab button | Direct API call |
| Atlas chat reply ("yes/approve/proceed") | Chat handler matches keyword, fires API |
| WhatsApp reply ("YES" or "yes" alone, or "approve") | Twilio webhook routes to API |

Approvals are recorded in `agent_audit_log` with `kind=phase_approval`, `phase_id`, `approved_via` (panel/chat/whatsapp), `approved_at`. Audit trail is single-source.

### Part F — Master plan v1.7 update

When the user "Follows" a phase that wasn't in the master plan (a brand-new phase added via Add button), the master plan must be updated to reflect it. The cockpit:

1. After "Follow" click on a brand-new phase, Atlas writes a master plan diff append.
2. Diff is shown to user inline with "Confirm plan update."
3. On confirm, master-plan.md is appended-to (NOT rewritten — incremental rule), version bumped.
4. Commit message: `docs(plan): bump to v1.7 — add phase X.Y from cockpit wizard`.

This keeps the master plan as the single source of truth even as the cockpit drives changes.

### Part G — Tests

`e2e/plan-cockpit.spec.ts`:

- (a) Paste a concept → assert it appears in concepts panel.
- (b) Click Add on a phase → wizard opens with questions populated.
- (c) Answer wizard questions → assert spec markdown generated, preview shown.
- (d) Click Save & Add to Follow → assert phase status changes to `follow`.
- (e) Click Build → assert confirmation modal.
- (f) Approve all → assert specs land in `.agent/tasks/queued/` in dependency order.
- (g) Test per-phase approval: WhatsApp webhook fires "approve" → assert next phase queues.
- (h) Test Revisit: click Revisit → assert phase dims and is skipped during build.

## Acceptance criteria

- Plan tab loads cockpit layout (concepts panel, workspace, wizard placeholder).
- Concepts panel accepts paste, upload, voice memo, past chat link. All 4 inputs work.
- Each plan node has Add / Modify / Follow / Revisit buttons.
- Wizard generates valid spec markdown (parseable by existing Builder lifecycle).
- Build button queues specs in dependency order.
- Per-phase approval works via dashboard, chat, AND WhatsApp.
- A wizard-created phase appears in master-plan.md after confirmation.
- `npm run build` clean.
- `npx playwright test e2e/plan-cockpit.spec.ts` green (8 scenarios).
- Spec lands in `done/` (lifecycle confirmed).

## Information walls

- Concepts panel + plan workspace + wizard: admin tier only.
- The cockpit drives the build of CropsIntel itself, so it's an internal tool — Maxons team only sees this. Customer + verified tiers never see this tab.
- Approvals via WhatsApp must validate the sender's phone number against the admin profile before acting.

## Files touched

- `src/components/atlas-plan/ConceptsPanel.tsx` (NEW)
- `src/components/atlas-plan/PhaseWizard.tsx` (NEW)
- `src/components/atlas-plan/PlanActionButtons.tsx` (NEW — 4 buttons per node)
- `src/components/atlas-plan/BuildRunnerModal.tsx` (NEW)
- `src/components/atlas-plan/PhaseApprovalBanner.tsx` (NEW)
- `src/components/atlas-plan/PlanTree.tsx` (extend — render action buttons + status colors)
- `src/components/atlas/tabs/AtlasPlanTab.tsx` (extend — 3-column layout with concepts left)
- `atlas/src/server.ts` (5 new routes)
- `atlas/src/lib/wizard-engine.ts` (NEW — Claude Sonnet question generator + finalizer)
- `atlas/src/lib/spec-from-wizard.ts` (NEW — answers → spec markdown)
- `atlas/src/lib/plan-action-handler.ts` (NEW — Add/Modify/Follow/Revisit logic)
- `atlas/src/lib/build-runner.ts` (NEW — orchestrates queued phase sequence with approval gates)
- `atlas/src/lib/approval-router.ts` (NEW — unifies dashboard / chat / WhatsApp approvals)
- `atlas/src/lib/master-plan-updater.ts` (NEW — incremental v1.7 append on cockpit-added phases)
- `supabase/migrations/<ts>_concepts_and_phase_approvals.sql` (NEW)
- `e2e/plan-cockpit.spec.ts` (NEW)

## Out of scope

- Editing master-plan.md WHOLESALE from the UI (only incremental appends).
- Multi-user collaboration on the same plan (single-user Maxons admin only for v1).
- Plan branching / what-if scenarios (linear plan only).
- Reverting a "Built" phase from the cockpit (use force-cancel + git revert manually).
- Importing plans from other formats (Markdown master plan only).
- Real-time collaborative editing (single-user, single-writer at a time).

## Realistic time estimate

Based on calibration data (1.10ag was 9 files / 987 lines / 15 min; 1.10ag2 was 3 files / 11 min; 1.10ai was 6 files / 12 min):

- This spec has ~14 new files + 2 extensions + 1 migration + 1 e2e test.
- Expect: **30-50 minutes Builder time.**
- Plus Verifier audit (~5 min).
- Plus Designer audit + likely remediation (~5-10 min — UI-heavy spec, Designer will have things to say).
- Total wall clock: ~50-75 min.

This is the largest spec we've shipped. Verifier + Designer scrutiny will be heavy. Expect 1-2 remediation rounds before the spec is fully clean. That's normal for a feature this size; the multi-brain audit is doing its job.

## Dependencies

All shipped:
- 1.10ae trust-mode runtime fix
- 1.10af dashboard live state truth
- 1.10ag zombie reaper + heartbeat + ghost-prevention
- 1.10ag2 Builder lifecycle completion fix
- 1.10ai Atlas real-signal decisions
