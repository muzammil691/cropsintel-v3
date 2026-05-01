---
priority: 1
human-review: false
research-confidence: 0.79
---

# Task: phase-1.10an-atlas-unified-cockpit remediation 001 of 3

**Reason:** Verifier blocked push at 2026-05-01T15:52:07Z (conf=0.85). Original
remediation spec content was lost — heredoc generated an empty file in commit
155fd6c. This remediation re-derives the gaps from a code audit of the cockpit
shell shipped in commit de494be.

## Gaps identified by audit

### high: layout
- **Description:** Desktop split-pane wrapper at `AtlasCockpit.tsx:133` had
  `flex-1 flex overflow-hidden` with no `hidden md:flex`, so on mobile the
  empty wrapper still claimed `flex-1` of the column-flex parent and competed
  for vertical space with the mobile section. Result: cramped mobile layout.
- **Fix:** Add `hidden md:flex` to the wrapper; remove redundant `hidden md:flex`
  on the inner `<main>`.

### medium: error visibility
- **Description:** The "Atlas link: error" banner was nested inside the
  desktop main pane, so mobile viewports would never see API degradation.
- **Fix:** Hoist the error banner to be a sibling of both desktop + mobile
  sections so it renders on all viewports.

### medium: code quality (mid-file imports)
- **Description:** `CockpitChat.tsx` had two `import` statements at lines
  373 (`SLASH_COMMANDS`) and 396 (`ChevronRight, ChevronDown`) — buried in
  the middle of the file. Legal in TS (imports hoist) but a code-quality
  smell that violates V3-CODING-INSTRUCTIONS conventions.
- **Fix:** Move all imports to the top.

### low: scope completeness (slash registry)
- **Description:** `/team` was added as a tab in 1.10ao but the slash command
  registry was never updated, so `/team` doesn't open the Team tab.
- **Fix:** Add `{ name: 'team', kind: 'navigate', targetTab: 'team' }` to
  `SLASH_COMMANDS` and extend the `targetTab` union type.

## Action

Fixed. `npm run build` clean. Atlas chunk = 72.82 KB / 22.19 KB gzipped
(under the 100KB target).
