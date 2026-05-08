---
phase: 1.10al
title: Cockpit v1.2 — Idea file (canonical product vision Atlas reads on every wizard run)
status: planned
gate: in-progress count <= 2 AND phase 1.10ak shipped
order: 2-of-4 cockpit upgrade bundle
estimated_builder_minutes: 20
estimated_cost_usd: 3
master_plan_section: 11.7
---

# Phase 1.10al — Cockpit v1.2: Idea file (canonical product vision)

## Why this exists

Today the wizard reads master plan + concepts. Concepts are short cards (paste/upload/voice). Master plan is structural (phases, sub-tasks). Neither is **the canonical product vision** — the "this is what CropsIntel IS, this is who it's FOR, this is what it DOES" document.

Without that, every wizard run reasons from scratch about what the product is. Phase 1.3 auth gets planned without reference to "this is for almond traders, mostly Gulf and South Asia, who need verified buyer/seller separation." Phase 1.7 multi-portal frontend gets planned without "the product feels like Bloomberg-for-almonds, premium and dense." The product loses coherence across phases.

This spec adds an **idea file** — `.agent/idea.md` — that:
- Is version-controlled in the repo
- Is the single source of product truth (vision, audience, tone, non-goals)
- Is read by the wizard on every run (after 1.10ak ships, via repo reader)
- Is editable directly from the cockpit (write button in Plan tab)

## Foundation-first check

- ✅ Master plan exists at `.agent/master-plan.md` — but it's structural, not a vision doc.
- ✅ Cockpit shipped (1.10aj) — concepts panel exists, but concepts are ephemeral cards.
- ✅ GitHub repo reader will exist after 1.10ak — wizard can pull idea file content.
- ❓ No idea file exists today. Net-new file.

## What ships

### 1. Idea file template

Create `.agent/idea.md` with this initial content (Builder writes it; user edits later):

```markdown
# CropsIntel V1 — Product Vision

> Canonical product vision. Read by Atlas on every wizard run. Edit directly from cockpit Plan tab.
> Last updated: <date>

## What it is

CropsIntel is a global almond market intelligence + trading workflow platform. It pairs Bloomberg-style market data (position reports, Strata pricing, news) with a verified-counterparty trading workflow (inquiry → offer → contract → fulfillment → audit).

## Who it's for

- **Tier 1 — Registered users:** anyone curious about almonds. Sees teaser data, public news, basic price index. Free.
- **Tier 2 — Verified users:** vetted commodity traders, processors, growers, brokers. Sees real-time data, positions, exclusive insights, and can transact via Maxons workflow. Paid.
- **Tier 3 — Admin (Maxons):** internal Maxons team. Verifies users, runs reports, manages the platform.

Geographic focus: Gulf, South Asia, Central Asia, Turkey. Operating language: English with Arabic-aware UI elements.

## What it does (in launch order)

- **V1.0 alpha:** auth + RBAC + verified queue + V2 user migration. Single product (almonds). Read-only insights at /insights.
- **V1.0 beta:** Adela data spine live (position reports + Strata + IMAP news). Inquiry/offer/contract flow. Three-tier RBAC enforced.
- **V1.5:** multi-commodity (walnut, pistachio enabled). Multi-portal frontend per role. Reports library.
- **V2.0:** prescriptions (hyper-personalized directives), AI-driven inquiry matching, audit-trail compliance reports.

## Non-goals (do NOT build)

- General agricultural data platform (we are almond-first, not multi-crop generalist).
- Consumer-facing app (B2B only).
- Spot exchange or brokerage license features (we are intelligence + workflow, not a market-maker).
- Real-time chat between counterparties (offers + contracts only — chat is out of scope).

## Voice and feel

- **Premium and dense.** Like Bloomberg Terminal, not consumer apps. Information density is a feature, not a problem.
- **Brown + yellow palette** (Maxons brand) accented with the data viz palette.
- **English first, Arabic-aware.** Right-to-left support where Arabic content is shown.
- **Trust signals are loud.** Verified badges, audit timestamps, source attribution.

## Hard rules (do NOT violate)

1. Foundation-first — extend the 12-table foundation in 20260428_v3_foundation.
2. Anti-restart — fix in place, never `file-2.tsx` alternatives.
3. Multi-commodity from day 1 — every domain row has `commodity_id UUID FK`.
4. AI keys server-side only — zero `VITE_ANTHROPIC_*`, `VITE_OPENAI_*`, `VITE_GOOGLE_*`.
5. Information walls are load-bearing — RLS at DB layer, app layer respects.

## Known constraints

- **Stack:** Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui + Supabase + 7 Railway services.
- **Builder budget:** ~$15/day on Atlas budget cap.
- **Founder:** Muzammil Akhtar, Maxons General Trading, Dubai.
```

### 2. Cockpit edit UI

Add to the Plan tab cockpit (in `src/components/atlas/tabs/AtlasPlanTab.tsx` or a new sub-component):

- A button labeled **"Idea file"** at the top of the Plan workspace.
- Clicking opens a modal with `.agent/idea.md` content as a markdown editor (use `@uiw/react-md-editor` or similar — already in deps from past UI specs, otherwise add it).
- Save button writes the new content via `POST /atlas/repo/idea` (see endpoint below) which Builder picks up and commits.

User can also edit the file directly in VS Code; both flows produce the same git commit.

### 3. New API endpoints

- `GET /atlas/repo/idea` — returns current idea file content (uses GitHub reader from 1.10ak).
- `POST /atlas/repo/idea` — accepts new content, writes a small spec to `queued/` that asks Builder to update the file (Atlas read-only, Builder writes — same flow as the rest of the system).

  Wait — this would require Builder to ship for every idea edit, which is too slow. Better approach:
  - User edits in VS Code → commits via Claude Code → done.
  - User edits in cockpit modal → cockpit saves to a Supabase `idea_drafts` table → user clicks "Sync to repo" → Builder gets a small spec like `phase-idea-sync-<timestamp>.md` that just commits the new content. Slow but auditable.
  
  For v1.2, ship the **VS Code editing flow** as primary (everyone working on the project edits markdown in VS Code anyway). The cockpit modal is **read-only** for now. Mark write-from-cockpit as a follow-up if user requests it.

So:
- `GET /atlas/repo/idea` — returns current idea file content via GitHub reader.
- (No POST endpoint in v1.2 — VS Code is the editor.)

### 4. Wizard integration

Extend `atlas/src/lib/wizard-engine.ts` (extended in 1.10ak) to read idea file and inject into Claude prompt:

```typescript
async function proposeQuestions(phaseId, masterPlanContext, concepts) {
  const ideaFile = await getFileContent('.agent/idea.md')  // from 1.10ak
  const repoIndex = await getRepoIndex()
  // ...
  const prompt = `
Product vision (canonical, Muzammil-edited):
${ideaFile}

Master plan context:
${masterPlanContext}

Concepts user has saved:
${concepts.map(c => `- ${c.title}: ${c.content.slice(0, 200)}`).join('\n')}

Repo facts:
... (from 1.10ak)

Now propose 3-7 questions that REFLECT the product vision. If a question would conflict with non-goals or hard rules, don't ask it. Ground every option in the vision, not generic possibilities.

Return JSON: { questions: [...] }
`
  // ...
}
```

This is the key mechanic: every wizard question is now anchored to the idea file. Phase 1.3 auth questions will reflect "verified buyer/seller separation, Gulf+South Asia, Maxons-managed verification queue." Phase 1.7 multi-portal questions will reflect "premium dense Bloomberg feel, English+Arabic, brown+yellow palette."

### 5. Idea file rendered in cockpit

In the Plan tab, add a small "View vision" link near the top that opens a side drawer with the idea file rendered as markdown. So user can read it without leaving the cockpit, even if editing happens in VS Code.

### 6. Tests

`e2e/idea-file.spec.ts`:

- (a) Builder writes initial `.agent/idea.md` → assert file exists in repo.
- (b) Wizard run → assert idea file content appears in Claude prompt (intercept the Claude API call).
- (c) Cockpit "View vision" drawer → assert markdown renders correctly.
- (d) `GET /atlas/repo/idea` → assert returns current file content.

## Acceptance criteria

- `.agent/idea.md` exists in repo with the template content above.
- Wizard `proposeQuestions` includes idea file in Claude prompt.
- "View vision" drawer in cockpit displays rendered markdown.
- `GET /atlas/repo/idea` endpoint returns content.
- 4 e2e tests pass.
- Spec lands in `done/`.

## Out of scope

- Cockpit-side editing (write from cockpit) — VS Code is the editor for v1.2.
- Multi-language idea files (English only).
- Idea file versioning / diff history beyond git log.
- Auto-suggesting idea-file changes when wizard finds a conflict (separate spec if needed).

## Realistic time estimate

- Idea file template write: ~2 min
- Cockpit "View vision" drawer: ~5 min
- Wizard engine extension: ~3 min
- API endpoint: ~2 min
- 4 e2e tests: ~3 min
- Misc + lint: ~5 min
- **Builder total: ~20 min**

## Dependencies

- 1.10ak shipped (GitHub reader exists for the wizard to read idea file).
- 1.10aj shipped (cockpit exists to add "View vision" drawer to).
