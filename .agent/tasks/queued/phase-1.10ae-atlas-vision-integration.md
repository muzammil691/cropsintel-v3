---
priority: 4
depends-on:
  - phase-1.10ab-atlas-brain-page
  - phase-1.10ac-atlas-pd-page
  - phase-1.10ad-verifier-research-and-reloop
---

# Task: Phase 1.10ae — Atlas vision integration polish

**Master plan reference:** §1.6 Atlas; user directive 2026-05-01: "complete vision of Atlas, then I will have complete control and UI."
**Context:** With 1.10z (events + dr-atlas) + 1.10aa (brain backend) + 1.10ab (`/atlas-brain`) + 1.10ac (`/atlas-pd`) + 1.10ad (verifier reloop) shipping, the V1 Atlas vision is in code. This spec is the polish + integration layer: nav linking, workflow runbook docs, end-to-end smoke tests, and the "single Atlas surface" stitched together.
**Estimated effort:** ~60 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

1. **Atlas surface unification** — the rebuilt Atlas dashboard from 1.10w gains:
   - Top-nav link to `/atlas-brain` (Multi-Brain debates)
   - Top-nav link to `/atlas-pd` (Project Development)
   - Tab/breadcrumb pattern so user can move between Atlas surfaces without losing context
2. **Workflow runbook** — `docs/atlas-workflow-runbook.md` documents the canonical 7-agent workflow (per 1.10ad Part B), with state diagrams + failure modes + escalation paths. This is human-readable; Atlas references it in chat ("see runbook section X").
3. **Atlas system-prompt update (1.10q)** — extend honesty rules with knowledge of:
   - The new tools shipped in 1.10z+aa+ad (drAtlas events, brain debates, workflow trace view)
   - The full agent inventory + their endpoints (so Atlas doesn't have to memorize, knows what to call when)
4. **End-to-end smoke test** — a Playwright spec at `e2e/atlas-vision.spec.ts` that:
   - Logs in as admin
   - Visits `/atlas`, clicks through to `/atlas-brain`, runs a debate
   - Visits `/atlas-pd`, creates a proposal, runs AI review
   - Returns to `/atlas`, verifies new artifacts surface in the dashboard
   - Total runtime ≤ 90s
5. **Nav consolidation** — single source of truth `src/lib/atlas-nav.ts` lists all Atlas surfaces with metadata (path, label, icon, RBAC requirement). Both 1.10w shell + new pages read from this.

## Architecture

```
src/
├── lib/
│   └── atlas-nav.ts                     (NEW — central Atlas surface registry)
├── pages/
│   └── Atlas.tsx                        (extend — top-nav with /atlas-brain, /atlas-pd links)
├── components/
│   └── atlas/
│       └── AtlasTopNav.tsx              (NEW — shared header for all Atlas surfaces)
docs/
└── atlas-workflow-runbook.md            (NEW)
e2e/
└── atlas-vision.spec.ts                 (NEW — Playwright)
atlas/
└── src/
    └── lib/
        └── system-prompt.ts             (extend with new tool inventory)
```

## atlas-nav.ts

```typescript
import { LayoutDashboard, Brain, FolderKanban, Activity } from 'lucide-react'

export interface AtlasSurface {
  path: string
  label: string
  description: string
  icon: typeof LayoutDashboard
  requires: 'auth' | 'team' | 'admin'
  shipped: boolean
}

export const ATLAS_SURFACES: AtlasSurface[] = [
  { path: '/atlas',         label: 'Atlas',          description: 'Conductor dashboard', icon: LayoutDashboard, requires: 'admin', shipped: true },
  { path: '/atlas-brain',   label: 'Brain',          description: 'Multi-Brain debates', icon: Brain,           requires: 'admin', shipped: true },
  { path: '/atlas-pd',      label: 'Project Dev',    description: 'Proposals + decisions', icon: FolderKanban,    requires: 'admin', shipped: true },
  { path: '/atlas/events',  label: 'Events',         description: 'atlas_events live tail', icon: Activity,        requires: 'admin', shipped: false }, // future
]
```

`AtlasTopNav` renders these as a horizontal nav bar at the top of every Atlas surface. Active surface highlighted. Mobile: dropdown.

## Workflow runbook

`docs/atlas-workflow-runbook.md` content outline (Builder writes the prose):

1. **Vision** — what Atlas is supposed to do (master spec §1)
2. **Agent inventory** — table of all 7 agents + endpoints + responsibilities
3. **Canonical workflow** — text version of the diagram in 1.10ad Part B
4. **Failure modes** — when each agent fails, what happens
   - Builder timeout → watchdog kills, moved to failed/, WhatsApp ping
   - Verifier fail (high conf) → research + reloop (1.10ad)
   - Verifier fail (low conf) → push with warning
   - Designer fail → remediation queued
   - Atlas conductor stale → snapshot anomaly detected, self-heal in auto mode
   - Memory drift → daily reconcile cron (future)
5. **Escalation paths** — what triggers a WhatsApp ping vs a fork question vs an emergency stop
6. **Trust mode behaviors** — passive / chat / confirm / auto matrix of what each mode allows
7. **Cost discipline** — budget gates per provider, alert thresholds
8. **Reading runtime state** — quick-reference: which Supabase view to query for which question

## System prompt extension

In `atlas/src/lib/system-prompt.ts`, append a "Tool inventory" section listing every tool with its purpose. So when Atlas needs to answer "how do I do X," its system prompt has the answer.

Also reference the runbook: "When asked about workflow, cite docs/atlas-workflow-runbook.md sections rather than improvising."

## E2E smoke test

```typescript
// e2e/atlas-vision.spec.ts (sketch)
import { test, expect } from '@playwright/test'

test.describe('Atlas vision', () => {
  test.beforeEach(async ({ page }) => {
    // Auth as admin (use Supabase test user)
    await page.goto('/auth')
    // ... log in steps
  })

  test('full Atlas surface walkthrough', async ({ page }) => {
    await page.goto('/atlas')
    await expect(page.getByRole('heading', { name: /Atlas/i })).toBeVisible()
    
    await page.getByRole('link', { name: 'Brain' }).click()
    await expect(page).toHaveURL(/atlas-brain/)
    await page.getByRole('button', { name: 'Run Multi-Brain debate' }).click()
    // ... fill prompt, submit, wait for SSE completion
    
    await page.getByRole('link', { name: 'Project Dev' }).click()
    await expect(page).toHaveURL(/atlas-pd/)
    await page.getByRole('button', { name: 'New Proposal' }).click()
    // ... fill + submit + AI review
    
    await page.getByRole('link', { name: 'Atlas' }).click()
    // Verify the proposal/debate now surfaces in the dashboard's artifacts pane
  })
})
```

## Files

- `src/lib/atlas-nav.ts` (NEW)
- `src/components/atlas/AtlasTopNav.tsx` (NEW)
- `src/pages/Atlas.tsx` (extend — render AtlasTopNav)
- `src/pages/AtlasBrain.tsx` (extend — render AtlasTopNav)
- `src/pages/AtlasPD.tsx` (extend — render AtlasTopNav)
- `docs/atlas-workflow-runbook.md` (NEW)
- `e2e/atlas-vision.spec.ts` (NEW)
- `atlas/src/lib/system-prompt.ts` (extend with tool inventory + runbook reference)
- `playwright.config.ts` (verify exists; if not, scaffold)

## Success criteria

- All 3 Atlas surfaces (`/atlas`, `/atlas-brain`, `/atlas-pd`) share AtlasTopNav with active state
- Mobile nav works (drawer or dropdown)
- `docs/atlas-workflow-runbook.md` exists with all 8 sections
- `npm run build` clean
- `npx playwright test e2e/atlas-vision.spec.ts` passes (≤90s) — if Playwright isn't yet set up, this spec installs + scaffolds it
- Atlas (after redeploy) cites runbook in answers about workflow ("see atlas-workflow-runbook.md §3 for canonical workflow")
- Designer agent verdict ≥ 0.7 across all touched UI files

## Risks + mitigations

- **Risk:** Playwright install adds heavy dev dep. **Mitigation:** Phase 1.14 was already going to install Playwright; we're just bringing forward.
- **Risk:** AtlasTopNav breaks 1.10w's layout. **Mitigation:** AtlasTopNav slots ABOVE the existing header; layout grid adjusts.
- **Risk:** System prompt growth (1.10q already long; this adds tool inventory). **Mitigation:** keep tool inventory terse — name + 1-line purpose; runbook is for depth.

## NEVER list

- Never make Atlas top-nav visible to non-admin/team
- Never let Playwright tests run against production Supabase (use staging/test project)
- Never let runbook fall behind code — Builder updates runbook in same commit when adding/removing agents
