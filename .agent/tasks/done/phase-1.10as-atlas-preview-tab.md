---
priority: 2
depends-on: []
---

# Task: Phase 1.10as — Atlas Preview tab (live app embed + Designer screenshot history)

**Master plan reference:** §1.10 Atlas conductor; user vision discussion 2026-05-02 ("preview tab which shows the app").

**Context:** Today the cockpit's tab bar has Plan, Queue, Agents, Audit, Workflows, Artifacts, Team. There is no way to actually SEE the running CropsIntel V3 app from inside Atlas — the user has to open another tab. This spec adds a **Preview** tab that embeds the live app + shows Designer's most recent screenshot artifacts so the user can compare "what was before" vs "what's live now".

**Estimated effort:** ~45 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Tab registration

`src/components/atlas/AtlasTabBar.tsx`: add a `preview` tab key to the existing `ATLAS_TABS` const with `label: 'Preview'` and a fitting `lucide-react` icon (`Monitor`).

`src/components/atlas/AtlasCockpit.tsx`: lazy-load `AtlasPreviewTab` and route `'preview'` to it.

### Part B — Preview tab content

**`src/components/atlas/tabs/AtlasPreviewTab.tsx`** (NEW):

Three sub-views via internal toggle (NOT separate cockpit tabs — keep cockpit tab count manageable):

```
┌─────────────────────────────────────────────────────────┐
│ PREVIEW                       [Live] [GH Pages] [Designer screenshots] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  <iframe sandbox of the running app>                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Live view:** `<iframe>` of `https://cropsintel.com/` (with `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`). On load fail (e.g., DNS not pointed yet), show a fallback card: "cropsintel.com not responding — DNS still pending. Use GH Pages preview instead." with a button to switch to the next view.

**GH Pages view:** `<iframe>` of `https://muzammil691.github.io/` (the current frontend deploy target). This is the source of truth right now since DNS isn't cut over.

**Designer screenshots view:** A grid of the most recent ~12 Designer screenshots fetched from `designer_runs.screenshot_url` (already a column on the table). Each card shows:
- The screenshot image
- Commit sha + truncated subject
- Verdict badge (pass/fail/partial)
- Timestamp
- Click → opens the full image in a Dialog

If `screenshot_url` is null on every recent row (Designer doesn't always capture screenshots — depends on the audit type), fall back to a copy block: "Designer hasn't captured screenshots recently. Trigger a full audit on a UI commit to populate this view."

### Part C — Refresh + open-in-new-tab affordances

Above each iframe view, a tiny toolbar:
- `↻ Refresh` button → reloads the iframe
- `↗ Open in new tab` → opens the URL standalone
- `📅 Last loaded: 12:34` — shows a tabular-nums timestamp
- `🔍 Inspect commit` → if a commit-sha query param is set on the URL, jumps to the Audit tab filtered by that sha

### Part D — Backend: GET `/atlas/designer/recent-screenshots`

Add to `atlas/src/server.ts` — pulls latest 12 `designer_runs` rows where `screenshot_url IS NOT NULL`, ordered by `created_at DESC`. Auth: viewer+. Returns `[{ id, task_id, verdict, screenshot_url, created_at }]`.

### Part E — Mobile

On `<sm` viewports, the iframe shrinks to fit. Designer-screenshot grid collapses to single column. Sub-view toggle becomes a `<select>` dropdown for compactness.

## Files

- `src/components/atlas/tabs/AtlasPreviewTab.tsx` (NEW)
- `src/components/atlas/AtlasTabBar.tsx` (extend — add `preview` tab)
- `src/components/atlas/AtlasCockpit.tsx` (extend — lazy-load + route)
- `src/lib/atlas-client.ts` (extend — `fetchRecentScreenshots`)
- `atlas/src/server.ts` (extend — GET `/atlas/designer/recent-screenshots`)

## Success criteria

- `npm run build` clean
- Cockpit tab bar shows new `Preview` tab with Monitor icon
- Click Preview → defaults to GH Pages view → iframe of `muzammil691.github.io` renders
- Toggle to Live → tries cropsintel.com, falls back gracefully if unreachable
- Toggle to Designer screenshots → grid of recent screenshots renders OR helpful empty-state copy
- Refresh button reloads iframe; Open-in-new-tab button works

## Risks + mitigations

- **Risk:** iframe gets blocked by GH Pages X-Frame-Options. **Mitigation:** Fallback to a "open in new tab" pattern if frame load fails (detect via timeout).
- **Risk:** Designer screenshot URLs are signed Supabase Storage URLs that expire. **Mitigation:** Server endpoint can re-sign on the fly via `createSignedUrl(storage_path, 3600)` if `screenshot_url` is empty but a `screenshot_path` column exists.
- **Risk:** Mobile users on slow connections see blank iframe. **Mitigation:** Show skeleton + 5s timeout → fallback card.

## NEVER list

- Never embed the production app with `allow-top-navigation` (sandbox attribute must NOT include it — would let the app break out of the cockpit).
- Never expose unsigned Supabase Storage URLs in this view.
- Never block the cockpit shell on the iframe loading — the rest of the cockpit must render even if the preview iframe stalls.
