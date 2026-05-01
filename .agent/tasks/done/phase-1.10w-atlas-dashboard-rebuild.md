# Task: Phase 1.10w — Atlas dashboard UI rebuild from scratch (research-driven)

**Master plan reference:** Atlas master spec §13; user directive 2026-05-01: "research how UI best should be and then rebuild it from scratch."
**Context:** The current Atlas dashboard at `src/pages/Atlas.tsx` was built incrementally across 1.10k–1.10l. It works but is utilitarian. User has said earlier UI ships were aesthetically weak, and that Atlas's dashboard specifically deserves a rebuild as the primary surface they collaborate with. This spec calls for explicit research first, then a from-scratch rebuild keeping the existing API surface intact.
**Estimated effort:** ~4-5 h Builder time (longest spec in this batch — design + build are both heavy)
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

A best-in-class conductor dashboard for Atlas with three primary capabilities surfaced equally well:

1. **Conversation** (text + voice, the primary interaction)
2. **Live status** (queue, in-flight, recent ships, costs, signals)
3. **Active artifacts** (pending spec drafts from 1.10r, open forks, design audits)

Plus secondary surfaces:
- Live mode (1.10u) panel slide-over
- Voice toggle + picker (1.10s)
- Trust mode + cost gauges
- Wizards (open phase / approve ADR / cancel task)

## Research phase (MANDATORY — do this BEFORE coding)

Builder MUST examine the public marketing pages + dashboard screenshots of these AI conductor / agent UIs and produce a `docs/atlas-ui-research.md` summary before writing any TSX. Each reference gets a paragraph: what works, what to borrow, what NOT to copy.

References:
- **Cursor IDE composer pane** — chat with diff inline; tool calls expanded to file changes; "Accept / Reject" gates
- **Claude.ai chat with artifacts** — conversation primary, artifact panel secondary; both editable
- **Linear AI** — quiet integration; suggestions surfaced contextually rather than full pane
- **GitHub Copilot Workspace** — task → plan → implementation panes; explicit progress gates
- **Devin's UI (cognition.ai screenshots)** — long-running task feed; tool calls as collapsible event log
- **Replit Agent** — chat + code + preview tri-pane; reasonable mobile fallback
- **Vercel v0** — generation log + preview iframe + chat
- **Plaud / Granola** (note-taking UX) — voice-first interaction, transcript panel

The research summary commits to `docs/atlas-ui-research.md` as part of this task. Use it to drive the design.

## Design tokens (locked, no negotiation)

- Colors: emerald-600/700 brand, slate-50/950 neutrals, semantic green/amber/red
- Typography: existing Geist font (already loaded)
- Radii: rounded-lg primary, rounded-md secondary, rounded-full for chips/avatars
- Spacing: 4 / 8 / 12 / 16 / 24 / 32 — no arbitrary values
- Shadow: shadow-sm hover, shadow-lg modal, no neon glow
- Motion: 150 ms transitions on hover; 250 ms on layout shifts; respect `prefers-reduced-motion`

## Layout (proposed three-pane on desktop)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ATLAS  [trust badge]  [voice toggle]  [live mode btn]   [wizards]   │ Header
├──────────────────┬─────────────────────────────┬───────────────────┤
│  CONVERSATION    │  ACTIVE ARTIFACTS            │  LIVE STATUS       │
│  (primary)       │  (drafts / forks / audits)   │  (queue / costs)   │
│  - chat stream   │  ┌─ Pending spec draft ──┐  │  Phase: 1.10       │
│  - tool chips    │  │ phase-1.10r ...       │  │  Queue: 7          │
│  - audio replay  │  │ [view] [queue] [drop] │  │  In-flight: 1      │
│  - compose box   │  └───────────────────────┘  │  Today: $4.23      │
│  + voice button  │  ┌─ Designer audit fail ─┐  │  Verifier: 87%     │
│                  │  │ commit abc123 ...     │  │  Memory: 6755 chk  │
│                  │  │ [3 gaps] [remediate]  │  │                    │
│                  │  └───────────────────────┘  │  Recent ships      │
│                  │  ┌─ Open fork ───────────┐  │  ✓ 1.3c (2h)       │
│                  │  │ Builder pickup logic? │  │  ✓ 1.10p (3h)      │
│                  │  │ [option A] [option B] │  │  ⚠ 1.10n (4h)      │
│                  │  └───────────────────────┘  │                    │
└──────────────────┴─────────────────────────────┴───────────────────┘
                                                Mobile: tabbed (chat default)
```

Mobile: bottom-tab nav with Chat (default) / Artifacts / Status, plus FAB for voice / live mode.

## Architecture

```
src/
├── pages/
│   └── Atlas.tsx                       (REWRITE — orchestrator only, no layout-grunt)
├── components/
│   └── atlas/
│       ├── AtlasShell.tsx              (NEW — three-pane wrapper, header)
│       ├── ChatPane/
│       │   ├── ChatPane.tsx            (REWRITE — uses ChatPanel under hood; cleaner empty + loading states)
│       │   ├── ComposeBar.tsx          (NEW — input + mic + send; richer than current)
│       │   └── MessageBubble.tsx       (REWRITE — markdown + tool chips + audio replay)
│       ├── ArtifactsPane/
│       │   ├── ArtifactsPane.tsx       (NEW)
│       │   ├── PendingSpecCard.tsx     (NEW — preview spec draft, accept/queue/drop)
│       │   ├── DesignerAuditCard.tsx   (NEW — show gaps, remediate button)
│       │   └── OpenForkCard.tsx        (NEW — radio-options + approve)
│       ├── StatusPane/
│       │   ├── StatusPane.tsx          (REWRITE — denser, more legible than StatusGrid)
│       │   ├── PhaseHeader.tsx         (NEW)
│       │   ├── LiveCounters.tsx        (NEW — queue / in-flight / done24h)
│       │   ├── CostGauges.tsx          (NEW — radial gauge per provider)
│       │   ├── VerifierSpark.tsx       (REWRITE — sparkline only, denser)
│       │   └── RecentShipsTimeline.tsx (REWRITE — vertical timeline)
│       ├── LiveModePanel.tsx           (existing 1.10u — slide-over from right)
│       └── ... (keep TrustModeBadge, WizardBar, VoiceToggle, MicButton, AudioPlayer)
└── hooks/
    ├── useArtifacts.ts                 (NEW — pending specs, design audits, open forks)
    └── ... (existing)
```

## API additions

Atlas server side needs to expose pending artifacts. Endpoints:

| Method | Path | Returns |
|---|---|---|
| GET | `/atlas/artifacts/pending-specs` | `atlas_pending_specs` rows where `resolved_at IS NULL` |
| GET | `/atlas/artifacts/design-audits` | recent `designer_runs` where `verdict='fail'` not yet remediated |
| GET | `/atlas/artifacts/open-forks` | `atlas_decisions` rows where `chosen_option IS NULL` |
| POST | `/atlas/artifacts/forks/:id/decide` | body `{ chosen, rationale }` |

## Files

- `src/pages/Atlas.tsx` (REWRITE)
- `src/components/atlas/**` (most files NEW or rewritten — see arch above)
- `src/hooks/useArtifacts.ts` (NEW)
- `src/lib/atlas-client.ts` (extend — fetchPendingSpecs, fetchDesignAudits, decideFork)
- `atlas/src/server.ts` (extend — three new GET endpoints + fork-decide POST)
- `docs/atlas-ui-research.md` (NEW — research summary, MUST commit before any TSX)

## Success criteria

- `docs/atlas-ui-research.md` committed first (separate commit) covering all 8 references with what-to-borrow/what-not
- Atlas dashboard re-rendered: three-pane desktop / tabbed mobile
- Conversation works identically (no regression of 1.10k chat)
- Pending spec card shows full markdown preview + 3 actions (View / Queue / Drop)
- Designer audit card lists gaps with severity colors + Remediate button (calls existing 1.10p flow)
- Open fork card with options + Approve button → calls `/atlas/decisions/:id/approve` (existing endpoint from spec §5)
- Status pane is denser AND more readable than current StatusGrid
- Lighthouse: mobile perf ≥85, desktop perf ≥90, accessibility ≥95
- Designer agent (1.10n) post-audit verdict ≥ 0.7
- All existing voice / live-mode / trust-mode / wizard features still work

## Risks + mitigations

- **Risk:** Big rewrite breaks 1.10s/t/u/v that are mid-flight (queued in same batch). **Mitigation:** This spec must ship AFTER 1.10s+t+u+v queue but should be sequenced LAST in the alphabetical pickup. Specs ahead of it will land first; their hooks/components are referenced by exact filenames.
- **Risk:** Research phase gets skipped. **Mitigation:** Success criteria explicitly require `docs/atlas-ui-research.md` committed in a SEPARATE commit BEFORE any TSX changes — Verifier audits this.
- **Risk:** Three-pane layout breaks on tablet (768–1024 px). **Mitigation:** Three breakpoints: <768 tabs, 768–1280 two-column (chat | artifacts; status drawer), ≥1280 three-column.
- **Risk:** Designer agent doesn't yet have a Railway service (1.10n shipped code, service not yet created — see baby-step list). **Mitigation:** Designer post-audit gracefully degrades (already in `tools.ts:168` — returns `verdict: unknown` if URL unset). The audit becomes mandatory once the service is live.

## NEVER list

- Never ship without the research document.
- Never use `style={{}}` overrides for design tokens (Tailwind config only).
- Never block conversation pane on artifact panel data — they fetch independently.
- Never delete the existing `Atlas.tsx` until the new shell renders cleanly side-by-side in dev. (Use a feature flag `?legacyAtlas=1` query param for the fallback during transition.)
