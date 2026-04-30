# Task: Phase 1.8b — News headlines page

**Master plan reference:** §11.2 row 1.8 (Market Price Intelligence — news subset); §7.4 (news as input).
**Context:** Adela's RSS aggregator (1.6d) populates `news_items` hourly. This spec is a lightweight reader page so subscribers see current industry news without leaving CropsIntel — closes the "no reason to come back daily" gap.
**Estimated effort:** ~40 min Builder time
**Model:** claude-sonnet-4-6 (low complexity, list rendering)

model: claude-sonnet-4-6

---

## Goal

Build `/insights/news` that:

1. Lists news items from `news_items`, newest-first, paginated 20/page
2. Tag-filter chips at top (`weather`, `tariff`, `disease`, `harvest`, `price`, `policy`, `all`)
3. Source-filter dropdown (almonds.org, USDA, Western Farm Press, etc.)
4. Each item: headline (links out, opens new tab), source name, published timestamp, tag chips, optional summary
5. Keyword search box (client-side filter on visible items; for >1000 items extend with server-side text search later)
6. Empty state guidance + last-scrape timestamp

## Architecture

```
src/
├── pages/
│   └── insights/
│       └── News.tsx                  (NEW)
├── components/
│   └── insights/
│       ├── NewsList.tsx              (NEW)
│       ├── NewsItem.tsx              (NEW)
│       ├── NewsTagFilter.tsx         (NEW)
│       └── NewsPagination.tsx        (NEW — generic, reusable)
└── lib/
    └── insights-queries.ts           (extend — fetchNewsItems with pagination)
```

## Data layer

```typescript
export async function fetchNewsItems(opts: {
  tags?: string[]
  source?: string
  page?: number
  pageSize?: number
}) {
  const page = opts.page ?? 0
  const pageSize = opts.pageSize ?? 20
  let q = supabase
    .from('news_items')
    .select('id, source, source_url, headline, summary, published_at, tags', { count: 'exact' })
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (opts.tags?.length) q = q.contains('tags', opts.tags)
  if (opts.source) q = q.eq('source', opts.source)
  const { data, count, error } = await q
  if (error) throw error
  return { items: data ?? [], totalCount: count ?? 0 }
}
```

## UI design

Card-list layout, each card:

```
┌────────────────────────────────────────────────────────────┐
│ [tag] [tag]                              published_at       │
│ Headline text — full headline visible                       │
│ Summary excerpt if present (line-clamp-2)                   │
│ Source: Western Farm Press →                                │
└────────────────────────────────────────────────────────────┘
```

Hover lifts card slightly (`hover:shadow-sm transition-shadow`); click anywhere on card opens source URL in new tab.

## Files

- `src/pages/insights/News.tsx` (NEW)
- `src/components/insights/NewsList.tsx` (NEW)
- `src/components/insights/NewsItem.tsx` (NEW)
- `src/components/insights/NewsTagFilter.tsx` (NEW)
- `src/components/insights/NewsPagination.tsx` (NEW)
- `src/lib/insights-queries.ts` (extend)
- `src/lib/nav-config.ts` (extend — enable News nav item)
- `src/App.tsx` (extend)

## Success criteria

- `/insights/news` lists items from real `news_items` rows
- Tag filter narrows results; URL reflects state
- Pagination Next/Prev works (disabled at boundaries)
- Click on a card opens `source_url` in new tab with `rel="noopener noreferrer"`
- Empty state shows last-scrape timestamp from `scraper_sources` row for `news`
- Lighthouse: mobile perf ≥85, accessibility ≥95
- Keyboard: tab through cards, Enter opens source, arrow keys move tag chip focus

## Risks + mitigations

- **Risk:** Aggressive feeds publish 100s of items/day → page floods. **Mitigation:** default page size 20; never load all rows.
- **Risk:** Some `published_at` are NULL. **Mitigation:** secondary sort on `ingested_at`; render "—" timestamp.
- **Risk:** Linking out to syndicators may be a UX dead-end if their site is offline. **Mitigation:** open in new tab, never replace the user's CropsIntel tab.

## NEVER list

- No storing or caching full article body (licensing risk)
- No embedded iframe of source site (security + UX hazards)
- No bot-fetching the source URL on page load (only on user click)
