# Task: Phase 1.8a — Market Price Intelligence page

**Master plan reference:** §11.2 row 1.8 (Market Price Intelligence); §7.4 (Live Margin Engine inputs).
**Context:** Adela's Strata + USDA scrapers (1.6b, 1.6c) populate `price_observations` with daily/weekly almond price points by variety, size, form, and trade basis. Phase 1.8a surfaces this as the second customer-facing intelligence page after Position Reports (1.7a). Same pattern: chart + table + filter + CSV export.
**Estimated effort:** ~70 min Builder time
**Model:** claude-opus-4-7 (UI quality + filter UX matter)

model: claude-opus-4-7

---

## Goal

Build `/insights/price-intelligence` that lets a subscriber:

1. See current week's almond price ranges by variety + size + form (table view, default sort: most-traded variety = Nonpareil first)
2. Plot a price-over-time line chart with toggleable series (one line per variety) — default 12-week lookback
3. Filter by variety multi-select, size_grade, product_form, trade_basis (FAS/CIF/etc.), source (Strata vs USDA)
4. Compare two date ranges (week-over-week deltas) with green/red indicators
5. CSV export of the filtered view (reuse `CsvDownloadButton` from 1.7a)

## Architecture

```
src/
├── pages/
│   └── insights/
│       └── PriceIntelligence.tsx       (NEW)
├── components/
│   └── insights/
│       ├── PriceTrendChart.tsx         (NEW)
│       ├── PriceTableFilterable.tsx    (NEW)
│       ├── PriceFilterBar.tsx          (NEW)
│       └── PriceDeltaBadge.tsx         (NEW)
└── lib/
    └── insights-queries.ts             (extend — add price queries)
```

Reuse `SubscriberShell` (1.7b) and `CsvDownloadButton` (1.7a). Add nav entry to `src/lib/nav-config.ts`.

## Filter design

Top of page: filter pills row.

```
[Variety: Nonpareil ×] [Size: 23/25 ×] [Form: shelled ×] [Basis: FAS ×]
[12 wks ▾]                    [Source: All ▾]                [Export CSV]
```

State held in URL search params (`?variety=Nonpareil&size=23%2F25&...`) so links are shareable. Use `useSearchParams` from react-router.

## Data layer

```typescript
// extend src/lib/insights-queries.ts
export interface PriceFilter {
  varieties?: string[]
  sizes?: string[]
  forms?: string[]
  bases?: string[]
  sources?: string[]
  weeksBack?: number
}

export async function fetchPriceObservations(filter: PriceFilter) {
  let q = supabase
    .from('price_observations')
    .select('observation_date, source, variety, size_grade, product_form, trade_basis, price_usd_per_lb, source_url')
    .order('observation_date', { ascending: true })
  if (filter.varieties?.length) q = q.in('variety', filter.varieties)
  if (filter.sizes?.length) q = q.in('size_grade', filter.sizes)
  if (filter.forms?.length) q = q.in('product_form', filter.forms)
  if (filter.bases?.length) q = q.in('trade_basis', filter.bases)
  if (filter.sources?.length) q = q.in('source', filter.sources)
  if (filter.weeksBack) {
    const since = new Date(Date.now() - filter.weeksBack * 7 * 24 * 60 * 60 * 1000)
    q = q.gte('observation_date', since.toISOString().slice(0, 10))
  }
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}
```

## Files

- `src/pages/insights/PriceIntelligence.tsx` (NEW)
- `src/components/insights/PriceTrendChart.tsx` (NEW)
- `src/components/insights/PriceTableFilterable.tsx` (NEW)
- `src/components/insights/PriceFilterBar.tsx` (NEW)
- `src/components/insights/PriceDeltaBadge.tsx` (NEW)
- `src/lib/insights-queries.ts` (extend)
- `src/lib/nav-config.ts` (extend — enable Price Intelligence nav item)
- `src/App.tsx` (extend)

## Success criteria

- `/insights/price-intelligence` renders inside `SubscriberShell`
- All filter combinations work; URL reflects current state; back-button works
- Chart re-renders on filter change without flicker (memoize derived series)
- Empty state: "No price observations yet. Strata scraper runs Fridays 13:00 UTC." (after 1.6c ships)
- CSV export matches the filtered view exactly
- Lighthouse mobile perf ≥80, accessibility ≥95
- Designer agent post-audit: passes

## Risks + mitigations

- **Risk:** Empty `price_observations` table (Strata + USDA scrapers haven't run yet). **Mitigation:** seed 50 fake observations via a dev-only seed script under `supabase/seed-dev/` (NOT in production migrations). Document in spec.
- **Risk:** `price_observations.size_grade` has many distinct values (`23/25`, `25/27`, `27/30`, ...). **Mitigation:** Filter dropdown queries DISTINCT values dynamically.
- **Risk:** Cross-variety comparison misleading without normalization. **Mitigation:** Add a small "Compared at midpoint of stated range" footnote.

## NEVER list

- No exposing supplier-side acquisition cost (information walls — customers see published price ranges only)
- No client-side AI inference of "should I buy" — that is Zyra (Phase 1.10 of OLD plan, deferred to Phase 2)
- No storing user filter preferences server-side (URL state is enough; respects user privacy)
