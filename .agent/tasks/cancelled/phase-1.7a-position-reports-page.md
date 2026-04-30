# Task: Phase 1.7a — Position reports page

**Master plan reference:** §11.2 row 1.7 (Position reports + analytics); §1.7 Subscriber portal; §7.4 Market Price Intelligence (ABC reports surface).
**Context:** Adela's ABC scraper already populates `position_reports` (1.00e). Phase 1.7 surfaces this data to subscribers as the first non-toy customer-facing intelligence page. Establishes the visual + data-fetching pattern that Phase 1.8 (price intelligence) and 1.9 (dashboard) will reuse.
**Estimated effort:** ~75 min Builder time
**Model:** claude-opus-4-7 (UI quality matters; user has flagged earlier UI ships as weak)

model: claude-opus-4-7

---

## Goal

Build `/insights/position-reports` route that subscribers can open to see ABC monthly Position Report data:

1. **Header card** — latest report month (e.g. "March 2026 Position Report"), total shipments and inventory headline numbers, MoM/YoY % deltas with green/red styling
2. **Time-series chart** — 24-month bar+line combo: bars = monthly shipments (domestic + export stacked), line = end-of-period inventory. Recharts (already in use; see `src/components/atlas/StatusGrid.tsx`)
3. **Variety breakdown table** — pivot from `position_report_varieties` (created in 1.6e) showing each variety's shipments + inventory for the latest report
4. **Export-vs-domestic split** — donut chart of latest month's split
5. **Raw report download** — link to the original PDF (via `position_reports.report_url`)
6. **Export to CSV** button — downloads the full 24-month series as CSV

## Architecture

```
src/
├── pages/
│   └── insights/
│       └── PositionReports.tsx       (NEW)
├── components/
│   └── insights/
│       ├── PositionReportHeader.tsx  (NEW)
│       ├── ShipmentInventoryChart.tsx (NEW)
│       ├── VarietyBreakdownTable.tsx  (NEW)
│       ├── ExportSplitDonut.tsx       (NEW)
│       └── CsvDownloadButton.tsx      (NEW — generic, reusable)
├── hooks/
│   └── usePositionReports.ts         (NEW — React Query around supabase queries)
└── lib/
    └── insights-queries.ts           (NEW — typed Supabase query builders)
```

Add `/insights/position-reports` to `src/App.tsx`. Behind `RouteGuard requires="auth"` (subscribers only — public can see Phase 1.5 landing teaser, but raw data is subscriber-gated).

## Design system (REQUIRED — Designer agent will audit)

- Use `slate-50/950` neutrals + `emerald-600/700` brand from existing Tailwind config
- All cards use `rounded-lg border bg-card p-4 space-y-3` (matches StatusGrid pattern)
- KPI cards mirror `KpiCard` from `StatusGrid.tsx` — copy, don't reinvent
- Chart palette: emerald-600 = primary (shipments), emerald-300 = secondary (inventory), red-500 = warn (negative deltas)
- Mobile: stack everything single-column under `md:` breakpoint
- Accessibility: every chart has `role="img"` + `aria-label` summarizing the data
- Loading: skeleton placeholders with `animate-pulse` (already in use)
- Empty state: friendly text "No position reports yet — Adela's first scrape runs at 06:00 UTC daily"

## Data layer

```typescript
// src/lib/insights-queries.ts
export async function fetchPositionReportSeries(monthsBack = 24) {
  const { data, error } = await supabase
    .from('position_reports')
    .select('report_date, total_shipments_lbs, total_inventory_lbs, domestic_shipments_lbs, export_shipments_lbs, report_url')
    .eq('source', 'ABC')
    .order('report_date', { ascending: false })
    .limit(monthsBack)
  if (error) throw error
  return (data ?? []).reverse()  // oldest-first for charts
}

export async function fetchLatestVarieties() {
  // join via latest position_report id
  const { data: latest } = await supabase
    .from('position_reports')
    .select('id, report_date')
    .eq('source', 'ABC')
    .order('report_date', { ascending: false })
    .limit(1)
    .single()
  if (!latest) return { reportDate: null, varieties: [] }
  const { data: varieties } = await supabase
    .from('position_report_varieties')
    .select('variety, shipments_lbs, inventory_lbs')
    .eq('position_report_id', latest.id)
    .order('shipments_lbs', { ascending: false })
  return { reportDate: latest.report_date, varieties: varieties ?? [] }
}
```

Use `@tanstack/react-query` if already installed (verify `package.json`); otherwise plain `useEffect + useState`. Cache key: `['position-reports', monthsBack]`. Stale time: 30 min.

## Files

- `src/pages/insights/PositionReports.tsx` (NEW)
- `src/components/insights/PositionReportHeader.tsx` (NEW)
- `src/components/insights/ShipmentInventoryChart.tsx` (NEW)
- `src/components/insights/VarietyBreakdownTable.tsx` (NEW)
- `src/components/insights/ExportSplitDonut.tsx` (NEW)
- `src/components/insights/CsvDownloadButton.tsx` (NEW)
- `src/hooks/usePositionReports.ts` (NEW)
- `src/lib/insights-queries.ts` (NEW)
- `src/App.tsx` (extend — add `/insights/position-reports` route, replace existing `<NotImplemented phase="1.50-landing-real" />` for `/insights` with a links page eventually; for now leave `/insights` alone and add the specific child)

## Success criteria

- `npm run build` passes
- `npm run dev`, navigate to `/insights/position-reports` (after auth) — page renders
- All 5 panels populate from real DB data
- CSV download produces well-formed CSV with header row + N data rows
- Lighthouse mobile score: ≥85 performance, ≥95 accessibility
- No `console.error`s on page load
- Information-wall check: page is behind RouteGuard `requires="auth"`; public users see redirect
- Designer agent (1.10n) post-audit: passes (verdict ≥ 0.7)

## Risks + mitigations

- **Risk:** Empty database (e.g., dev env). **Mitigation:** Empty state with explicit "Adela first scrape runs at 06:00 UTC" copy.
- **Risk:** Recharts bundle size. **Mitigation:** It's already in use for Atlas dashboard — no incremental bundle hit.
- **Risk:** PDF link from `position_reports.report_url` is HTTPS-redirected by ABC → CORS issues. **Mitigation:** open in new tab via `target="_blank" rel="noopener"`; download not in-app.

## NEVER list

- No exposing supplier-side or broker-side data (this page is only customer/public-side aggregate ABC data — no information-wall risk, but reviewer must confirm)
- No client-side AI calls — pure DB queries only
- No mock data fallback in production (handoff §10 anti-pattern)
