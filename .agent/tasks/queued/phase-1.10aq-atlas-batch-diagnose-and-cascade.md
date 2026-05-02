---
priority: 1
depends-on: []
---

# Task: Phase 1.10aq — Batch diagnose, cascade analysis, severity tiering, self-fix loop

**Master plan reference:** §1.10 conductor self-management; user vision discussion 2026-05-02.

**Context:** The Diagnose flow shipped in 1.10al + Phase B works for single artifacts but produces a churning artifact panel because:

1. **No multi-select** — user must click Diagnose 16 times for 16 artifacts. They want one click that diagnoses all selected and emits ONE combined Claude Code prompt.

2. **No cascade analysis** — when commit Y has gaps, Atlas can't tell the user "these gaps were introduced by commit X (your fix)" or "these are net-new issues unrelated to prior fixes". The user has to mentally diff every audit pair.

3. **No severity separation** — high/medium/low all rendered identically in a single list. User wants high-priority surfaced separately from polish.

4. **No self-fix loop** — when Diagnose returns `auto-remediate`, the suggestion is shown but the user has to manually queue the spec, watch it ship, and re-audit to verify it worked. The user wants Atlas to: try the auto-fix → wait for the next audit → report whether the gap is gone, and if not, escalate to claude-code with the full prompt.

This spec adds all four.

**Estimated effort:** ~70 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Multi-select + batch diagnose

**Frontend `src/components/atlas/tabs/AtlasArtifactsTab.tsx` + `AtlasAuditTab.tsx`:**

- Each artifact row gets a checkbox on the left (already exists in ArtifactsPane from 1.10ak's spec; verify present).
- Toolbar at top of pane:
  - "Select all" / "Clear selection" / "Select failed only" buttons
  - When ≥1 selected: bulk action bar appears
    - `[Diagnose all (N)]` — calls new `POST /atlas/artifacts/diagnose-batch` with the array of artifact refs
    - `[Discuss all (N)]` — sends combined `chat_seed` to chat
    - `[Queue auto-fixes (N)]` — for any selected with bucket=auto-remediate, queues all the spec drafts in one push
    - `[Copy combined CC prompt]` — single prompt that addresses all selected gaps
    - `[Dismiss all]`

**Server route `POST /atlas/artifacts/diagnose-batch`:**
- Body: `{ items: [{kind, ref, payload}] }`
- Internally: dispatch each through the existing `diagnose()` classifier in parallel (max 5 concurrent to keep AI costs sane).
- Returns: `{ results: [{kind, ref, bucket}], combined: { autoRemediate: SpecDraft[], claudeCode: { prompt, affectedFiles[] }, inApp: ActionId[], discuss: { seed } } }`
- The `combined.claudeCode.prompt` merges per-row prompts into a single addressable message:
  ```
  You're fixing 4 issues in cropsintel-v3 in one pass.
  HEAD: <sha>
  AFFECTED FILES: <union of all file lists, deduped>
  
  ## Issue 1: <task_id>
  <verbatim per-row gap details>
  
  ## Issue 2: ...
  
  ## What to do
  Apply each issue's fix in order. Run `npm run build` after each.
  Commit once at the end with: `fix(atlas-pd): batch fix N artifacts — <comma-separated task_ids>`.
  ```

### Part B — Cascade analysis (was this caused by my last fix?)

**New helper `atlas/src/lib/cascade.ts`:**

For an artifact with `commit_sha`, look up the commits that touched the gap-affected files in the last 7 days. Return:

```typescript
type CascadeRelation =
  | { kind: 'introduced-here'; reason: 'first commit to touch this file' }
  | { kind: 'introduced-by-prior-fix'; prior_sha: string; prior_subject: string; same_check: boolean }
  | { kind: 'pre-existing'; oldest_sha: string; days_old: number }
  | { kind: 'unknown' }
```

Heuristic:
- If gap.file was created in the same commit being audited → `introduced-here`
- If gap.check matches a `fix(atlas-pd)` follow-up commit's check on the same file → `introduced-by-prior-fix` (means our fix introduced a new variant of the same issue)
- If gap.file was first touched >7 days ago and the gap pattern matches → `pre-existing`
- Else `unknown`

**Server route `POST /atlas/artifacts/cascade`:**
- Body: `{ commit_sha, gap }` → `CascadeRelation`
- Used to enrich Diagnose result rows with a small chip: `🔗 Introduced by your last fix (3892ad)` — clickable, opens the prior commit on GitHub.

**Frontend rendering:**
- Each gap in the diagnosis card shows the cascade chip if non-`unknown`.
- This answers user's question: "is the new audit because of previous change?" — explicitly yes/no with the linked commit.

### Part C — Severity tiering in the artifact panel

Today every gap renders identically. Split into two sections:

```
ARTIFACTS — high priority (3)
  ❌ phase-X-foo · designer · fail · 2 gaps · conf 0.95
  ❌ phase-Y-bar · verifier · fail · ...
  ...

ARTIFACTS — polish (13)
  ⚠️ phase-Z · designer · 7 gaps (all medium/low)
  ...
  [Bulk diagnose polish (13)]   [Hide polish until next ship]
```

**Filter logic:**
- High priority = any gap with `severity: 'high'` OR a check in {`files-exist`, `components-implemented`, `accessibility:critical`, `verifier_audit_missing`}
- Polish = everything else (motion, mobile-responsive, states, low-severity accessibility)
- "Hide polish until next ship" sets a `localStorage` flag with a 24h TTL; the polish section renders collapsed with a `Show (13)` toggle.

### Part D — Self-fix loop

When Diagnose returns `bucket=auto-remediate`, the diagnosis card shows three buttons:

- `[Auto-fix now]` — confirms, calls `builder.queue_spec` with the suggested body, marks the artifact `state=auto-fix-pending` in `atlas_diagnosis_cache`
- `[Generate Claude Code prompt instead]` — escalates to claude-code bucket
- `[Discuss first]` — opens chat with diagnosis as context

When user clicks `[Auto-fix now]`:
1. Atlas queues the spec (1 commit)
2. Builder picks it up, ships it (15-25 min depending on size)
3. Designer/Verifier re-audits the new commit
4. Atlas's existing invariant checker (`checkWorkflowTraceInvariants`) catches the new audit
5. Atlas correlates: did the original gap (`gap.check + gap.file`) clear in the new audit?
   - YES → diagnosis card flips to `✅ Resolved by autofix (commit abc1234)`. Original artifact dismissed.
   - PARTIAL (some gaps cleared, some new) → card shows split state with cascade analysis on the new ones.
   - NO (gap still present) → card flips to `❌ Auto-fix failed; gap still present. Generate Claude Code prompt?` with a one-click escalate button. Reason field explains why (e.g., "Builder shipped but Designer re-audit shows the same hover sites without transitions — Builder's edit didn't address the actual issue").

**State machine:**
- `pending-user` (initial) → `auto-fix-queued` (after click) → `auto-fix-shipped` (after Builder commit) → `auto-fix-resolved` | `auto-fix-failed`

State persisted in `atlas_diagnosis_cache.lifecycle_state`.

**Conductor integration:** `atlas/src/cron/conductor.ts` runs every 5 min. Add a new pass: for every `auto-fix-shipped` row in cache that's >30 min old, run the cascade comparison. Update lifecycle_state. If `auto-fix-failed`, send a WhatsApp ping with the escalation prompt.

### Part E — UI feedback during the loop

The diagnosis card during auto-fix lifecycle shows progress:

```
🔧 Auto-fix in progress
   Step 1/4: Spec queued ✓  (12:34)
   Step 2/4: Builder shipping... (currently 4 min in)
   Step 3/4: Verifier audit pending
   Step 4/4: Cascade check pending
   [View live log ↗]
```

Each step ticks live as the conductor heartbeat updates the row. User always sees what's happening.

### Part F — Combined diagnose result rendering

When `Diagnose all` returns the combined result, render in a single card:

```
DIAGNOSIS RESULT — 16 artifacts processed
─────────────────────────────────────────
🟢 Auto-fix candidates (4) — 1 click to queue all
🔵 Need Claude Code (8) — 1 prompt covers all
🟡 In-app actions (2) — buttons below
⚪ Discuss (2) — seed copied to chat

[Queue 4 auto-fixes]   [Copy combined CC prompt (8 issues)]
[Apply in-app actions (2)]   [Send 2 to chat]
```

## Files

- `src/components/atlas/tabs/AtlasArtifactsTab.tsx` (extend — multi-select toolbar + severity split + bulk-diagnose result card)
- `src/components/atlas/tabs/AtlasAuditTab.tsx` (extend — same multi-select pattern)
- `src/components/atlas/diagnose/BatchDiagnoseToolbar.tsx` (NEW)
- `src/components/atlas/diagnose/CombinedDiagnosisCard.tsx` (NEW)
- `src/components/atlas/diagnose/CascadeChip.tsx` (NEW)
- `src/components/atlas/diagnose/AutoFixProgress.tsx` (NEW)
- `atlas/src/lib/cascade.ts` (NEW)
- `atlas/src/server.ts` (extend — `/atlas/artifacts/diagnose-batch`, `/atlas/artifacts/cascade`)
- `atlas/src/cron/conductor.ts` (extend — auto-fix lifecycle pass)
- `supabase/migrations/20260502120000_diagnosis_lifecycle.sql` (extend `atlas_diagnosis_cache` with `lifecycle_state`, `lifecycle_updated_at`, `auto_fix_spec_filename`, `auto_fix_commit_sha`)
- `src/lib/atlas-client.ts` (extend — batch diagnose + cascade helpers)

## Success criteria

- `npm run build` clean
- Audit tab: select 4 failed rows → click `[Diagnose all]` → single result card appears within ~10s with bucket breakdown
- Combined CC prompt is paste-ready and addresses all 4 issues in one shot
- Cascade chip on a gap reads "Introduced by your fix bb59236" (clickable, opens commit) when applicable
- Severity split renders `high priority` and `polish` sections with counts; polish hides under a 24h flag
- Click `[Auto-fix now]` on an auto-remediate gap → spec queues, card switches to progress UI, ticks through 4 steps as Builder ships, ends with ✅ resolved or ❌ failed-with-escalate-button
- `auto-fix-failed` state sends a WhatsApp with the escalation prompt
- Diagnosis cache survives Atlas redeploy (lifecycle state persists)

## Risks + mitigations

- **Risk:** Batch diagnose runs 16 LLM calls, costs spike. **Mitigation:** Hard cap of 8 per batch + display cost estimate before dispatch ("This will cost ~$0.40").
- **Risk:** Auto-fix loop creates infinite remediation cycles. **Mitigation:** Lifecycle state caps at one auto-fix attempt per artifact; on `auto-fix-failed` only the user can re-trigger.
- **Risk:** Cascade analysis runs `git log` on every diagnose, slow at scale. **Mitigation:** Cache per-file commit history for 5 min in memory.
- **Risk:** Conductor pass for lifecycle updates collides with other git ops. **Mitigation:** Wrap in existing `withGitLock`.

## NEVER list

- Never auto-trigger `auto-fix` without user click — even on cascade re-evaluation. The user is always the one who says go.
- Never escalate `auto-fix-failed` to claude-code without showing the user why it failed (Builder's commit log, the un-cleared gap detail).
- Never delete diagnosis cache rows automatically — keep them for ≥7 days as audit history.
- Never hide a `severity: 'high'` artifact in the polish section.
