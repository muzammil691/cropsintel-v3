---
phase: 1.10ab
title: Queue card expansion + plain-English summary
status: planned
gate: in-progress count <= 5 AND no spec stuck >2h
estimated_builder_minutes: 90
estimated_cost_usd: 3
master_plan_section: 11.3
---

# Phase 1.10ab — Queue card expansion + plain-English summary

## Why this exists

Today's Queue tab shows each spec as a card with three buttons: `view spec`, `view live log`, and `force-cancel`. To know what a spec actually does, the user has to click `view spec` (opens raw markdown in GitHub) or `view live log` (opens raw log file). Neither is helpful to glance at. Muzammil wants each card to expand inline and show, in plain English, what's being built and how it's progressing.

## Foundation-first check

- ✅ `src/components/atlas/tabs/AtlasQueueTab.tsx` exists.
- ✅ `atlas/src/server.ts` already has `/queue/list` returning queue + in-progress.
- ✅ Builder writes live logs to `.agent/tasks/logs/<spec>-<timestamp>.log` and these are git-tracked (we saw this in tonight's commits).
- ✅ Cost-log table exists (`atlas/src/lib/cost-log.ts`).

We're extending the existing component and API.

## What ships

### 1. Queue card → expand on click

Each card today is a static block. Make the entire card a click target (with a chevron indicator). Clicking expands a panel below the card with the content described in steps 2-7. Clicking again collapses. Default: collapsed. Persist expanded state per spec id in `localStorage` (`atlas.queue.expanded.<spec_id>=true`) so toggle survives page refresh.

### 2. Plain-English summary (3-5 bullets)

When a card is expanded for the first time, fetch a summary from a new endpoint `GET /queue/summary/<spec_id>`. The endpoint:

- Reads the spec markdown.
- Calls Claude (Haiku model — cheap, fast) with prompt: *"Summarize this build spec in 3-5 plain-English bullet points for a non-developer. Focus on what the user will see / what changes for them. Skip technical implementation. Max 25 words per bullet."*
- Caches the result in a new Supabase table `spec_summaries` keyed by `spec_path + spec_content_sha`.
- Returns `{summary: ["bullet 1", "bullet 2", ...], cached: true|false}`.

If the cache hits, response is sub-100ms and zero cost. If miss, takes ~3-5s and costs ~$0.001.

Show the bullets at the top of the expanded panel.

### 3. Current Builder thought (live)

For specs in `in-progress/`, show a "currently doing" line that updates every 5 seconds. Source: tail the live log file, extract the most recent line that looks like a Builder action (heuristic: first 200 chars of the last non-empty line that isn't a system message). Display as italic gray text below the bullets.

For queued / done / cancelled specs, this section is hidden.

### 4. Files changed so far

For specs in `in-progress/`, run `git diff --name-only <spec_start_sha>..HEAD` (where `spec_start_sha` is the commit when the spec moved to in-progress) and show as a clean list. Cap at 10; show "+ N more" if longer. For done specs, show the same list against the spec's done-commit.

### 5. Estimated time + cost so far

- **Time so far** = wall-clock since the spec entered in-progress. Format: `1h 12m`.
- **Estimated remaining** = if the spec front-matter has `estimated_builder_minutes`, show `(~28m remaining)` based on (estimate − elapsed). Skip if no estimate.
- **Cost so far** = sum of cost_log rows for this spec_id. Show in USD to 2 decimals.

### 6. Verifier interim verdict (if available)

If Verifier has produced any verdict for this spec yet (read from `verifier_runs` table), show a small badge: `Verifier: pass` (green), `Verifier: fail` (rose), `Verifier: warn` (amber), or `Verifier: pending` (gray). Click the badge → opens Verifier's full report in a side drawer.

### 7. Action buttons in expanded panel

Same `force-cancel` and `view spec` and `view live log` that exist on the card today, just better laid out within the expanded panel. Add one new button: **`re-queue`** for cancelled or failed specs (moves the spec back to `queued/`).

## Acceptance criteria

- Click any queue card → expands smoothly (max 200ms transition). Click again → collapses.
- Expanded panel shows: 3-5 plain bullets, current Builder thought (for in-progress), files changed, time + cost, Verifier badge.
- First expansion of a card costs <$0.005 in Claude tokens; subsequent expansions are free (cache hit).
- `re-queue` button on a cancelled spec moves it from `cancelled/` to `queued/`, commits with message `atlas: re-queue <spec> by user`.
- `npm run build` passes.
- `npx playwright test e2e/queue-expansion.spec.ts` green.

## Information walls

Admin-tier only.

## Files touched

- `src/components/atlas/tabs/AtlasQueueTab.tsx` (extend)
- `src/components/atlas/queue/QueueCardExpanded.tsx` (NEW)
- `src/components/atlas/queue/QueueCardSummary.tsx` (NEW)
- `atlas/src/server.ts` (new route)
- `atlas/src/lib/spec-summary.ts` (NEW — Claude Haiku call + cache)
- `supabase/migrations/<ts>_spec_summaries.sql` (NEW)
- `e2e/queue-expansion.spec.ts` (NEW)

## Out of scope

- Editing specs from the UI.
- Reordering specs (already exists via drag).
- Bulk cancel / bulk re-queue (separate spec if needed).
