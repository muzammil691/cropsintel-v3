# Task: Phase 1.9a — Subscriber dashboard widget grid

**Master plan reference:** §11.2 row 1.9 (Dashboard with ~10 widgets); §1.7 Subscriber portal.
**Context:** With Phase 1.7 (Position Reports) and 1.8 (Price Intelligence + News) shipping page-level intelligence views, the subscriber landing inside the SubscriberShell needs a digest view at `/dashboard` — small KPI tiles that summarize the most recent state across all data sources. This is the "what should I look at first today" page.
**Estimated effort:** ~75 min Builder time
**Model:** claude-opus-4-7 (information design + visual hierarchy matter)

model: claude-opus-4-7

---

## Goal

Build a 10-widget dashboard at `/dashboard` (replacing the current placeholder Dashboard page) inside `SubscriberShell` (1.7b). Each widget is small, single-purpose, click-to-expand to its full page.

## The 10 widgets

| # | Widget | Source | Click target |
|---|---|---|---|
| 1 | Latest position report — total shipments + MoM | `position_reports` | `/insights/position-reports` |
| 2 | Latest position report — total inventory + MoM | `position_reports` | `/insights/position-reports` |
| 3 | Nonpareil 23/25 latest price (USD/lb) | `price_observations` filtered | `/insights/price-intelligence?variety=Nonpareil&size=23/25` |
| 4 | 4-week price trend sparkline (Nonpareil avg) | `price_observations` | same |
| 5 | Top export destination this month (FAS GATS) | `usda_exports` | `/insights/position-reports` (until 1.9b ships export page) |
| 6 | Today's news headlines count by tag | `news_items` last 24h | `/insights/news` |
| 7 | Top news headline (most recent) | `news_items` newest | external |
| 8 | Active market signals count | `market_signals` unacknowledged | placeholder until 1.11 |
| 9 | Adela last scrape status — health check (green if last 24h) | `scraper_sources` | `/insights` |
| 10 | "Welcome back, <name>" + days since last login + verified-tier badge | `profiles` | `/settings` (placeholder) |

## Architecture

```
src/
├── pages/
│   └── Dashboard.tsx                  (rewrite — was placeholder)
├── components/
│   └── dashboard/
│       ├── WidgetCard.tsx             (NEW — generic card frame)
│       ├── KpiWithDeltaWidget.tsx     (NEW — used by widgets 1, 2, 3)
│       ├── SparklineWidget.tsx        (NEW — widget 4)
│       ├── ExportDestinationWidget.tsx (NEW — widget 5)
│       ├── NewsTagDigestWidget.tsx    (NEW — widget 6)
│       ├── HeadlineWidget.tsx         (NEW — widget 7)
│       ├── MarketSignalsWidget.tsx    (NEW — widget 8)
│       ├── AdelaHealthWidget.tsx      (NEW — widget 9)
│       └── WelcomeWidget.tsx          (NEW — widget 10)
└── lib/
    └── dashboard-queries.ts           (NEW — one query per widget, parallelized in Promise.all)
```

## Layout

CSS grid, 12-column responsive:

- Mobile: 1 column, all widgets stack
- Tablet (`md:`): 2 columns
- Desktop (`xl:`): 4 columns; KPI tiles span 1, larger widgets (sparkline, news) span 2

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 p-4">
  <WelcomeWidget className="md:col-span-2 xl:col-span-4" />
  <KpiWithDeltaWidget label="Shipments (Mar)" ... />
  <KpiWithDeltaWidget label="Inventory (Mar)" ... />
  <KpiWithDeltaWidget label="Nonpareil 23/25" ... />
  <SparklineWidget className="xl:col-span-2" ... />
  ...
</div>
```

## Data layer

`dashboard-queries.ts` exports one async fn per widget. Dashboard page calls them all in parallel via React Query (or `Promise.allSettled` if React Query not installed). Each widget owns its loading and error states (no shared spinner — partial render is better than blocking).

## Design system

- `WidgetCard` is the canonical primitive — all widgets wrap their content in it
- Headers: `text-xs font-semibold uppercase tracking-wide text-muted-foreground`
- Numbers: `text-2xl font-bold tabular-nums`
- Click affordance: subtle `hover:bg-muted/30 cursor-pointer transition-colors`
- Skeleton loading: `animate-pulse` placeholders matching final layout
- Empty state per widget: friendly inline message ("Awaiting first scrape" etc.), never blank box

## Files

- `src/pages/Dashboard.tsx` (REWRITE — preserve any existing logic worth keeping; check before deleting)
- `src/components/dashboard/*.tsx` (10 new files)
- `src/lib/dashboard-queries.ts` (NEW)

## Success criteria

- `/dashboard` renders inside SubscriberShell with all 10 widgets
- Each widget loads independently — slow query doesn't block others
- Each widget click navigates to its target route
- Empty data → empty state with explanation, not a crash
- Lighthouse mobile perf ≥80, desktop ≥90, accessibility ≥95
- Designer agent post-audit: passes (verdict ≥ 0.7)
- No `console.error` on load with empty DB
- Mobile: widgets stack 1-column; nothing horizontally scrolls

## Risks + mitigations

- **Risk:** 10 parallel Supabase queries on every load = burst. **Mitigation:** `staleTime: 5 * 60 * 1000` on React Query; combine related queries via Postgres views in a follow-up if needed.
- **Risk:** Widget grid feels cluttered if all 10 are KPI-style. **Mitigation:** mix tile sizes — span 2 for sparkline/news; keep visual rhythm.
- **Risk:** First-time user with empty DB sees mostly empty states. **Mitigation:** WelcomeWidget shows onboarding-style nudge: "Adela's first scrape runs at 06:00 UTC" + link to `/insights`.

## NEVER list

- No widgets requiring info-wall breaches (e.g., no "broker commission this month" — that's broker-portal only, Phase 3)
- No client-side AI-generated insights — that's Zyra, Phase 2+
- No re-implementing Atlas dashboard's status grid — Atlas is a separate dev-time surface
