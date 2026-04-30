# Task: Phase 1.6d — Adela news RSS aggregator

**Master plan reference:** §11.2 row 1.6 (6 scrapers); §7.4 Market Price Intelligence (news as input).
**Context:** Almond market commentary often hinges on weather, crop disease, water-allocation, tariff, and trade-policy news. Aggregating these sources gives Zyra (Phase 2) and the prescription engine (1.11) raw signal. Many sources publish RSS feeds — no scraping needed.
**Estimated effort:** ~45 min Builder time
**Model:** claude-sonnet-4-6 (low reasoning load — just parse, dedupe, insert)

model: claude-sonnet-4-6

---

## Goal

Add `adela/src/scrapers/news.ts` that:

1. Fetches a curated list of RSS/Atom feeds (configurable in `scraper_sources.config`)
2. Parses each feed entry → headline, summary, source URL, published_at
3. Deduplicates via sha256 hash of source URL (stored in `news_items.hash`)
4. Inserts new entries into `news_items` (created in 1.6a)
5. Auto-tags entries when headline matches keyword categories (`weather`, `tariff`, `disease`, `harvest`, `price`, `policy`)
6. Schedule: hourly (`0 * * * *`)
7. Tags entries with `commodity_id=almonds` if headline matches almond-related keywords; otherwise `commodity_id=NULL` (general agri news)

## Default feed list

Seed in `scraper_sources` row's `config` JSONB:

```json
{
  "feeds": [
    "https://www.almonds.org/rss",
    "https://www.westernfarmpress.com/rss.xml",
    "https://www.agweb.com/rss",
    "https://feeds.feedburner.com/UsdaNass",
    "https://www.fresnobee.com/news/business/agriculture/?widgetName=rssfeed&widgetContentId=712015&getXmlFeed=true",
    "https://www.farmprogress.com/rss.xml",
    "https://feeds.bbci.co.uk/news/business/economy/rss.xml"
  ],
  "almond_keywords": ["almond", "almonds", "tree nut", "California Central Valley", "ABC", "Almond Board"]
}
```

Builder MUST verify each URL returns 200 + valid feed format at build time; drop and log any invalid feed in `adela_runs.metadata.invalid_feeds`.

## Architecture

```
adela/
├── src/
│   ├── scrapers/
│   │   └── news.ts (NEW)
│   └── lib/
│       └── feed-parser.ts (NEW — thin wrapper around fast-xml-parser or rss-parser)
```

Use the npm package `rss-parser` (battle-tested, ~30k weekly downloads, MIT). Add to `adela/package.json`.

## Files

- `adela/src/scrapers/news.ts` (NEW)
- `adela/src/lib/feed-parser.ts` (NEW)
- `adela/src/config.ts` (extend) — `news` block
- `adela/src/scheduler.ts` (extend) — register `runNewsScraper`
- `adela/package.json` — add `"rss-parser": "^3.13.0"`

## Implementation notes

- For each feed, fetch with timeout 15s; on failure, log to `adela_runs.metadata.feed_errors[<feed_url>]` and continue with remaining feeds (one bad feed must NOT block the others).
- Use `crypto.createHash('sha256').update(item.link).digest('hex')` for the dedup hash.
- INSERT with `ON CONFLICT (hash) DO NOTHING`.
- Auto-tag via case-insensitive keyword match on `headline + summary`.

## Success criteria

- Manual run produces ≥20 rows in `news_items` from real feeds
- Re-run within the hour produces 0 new rows (dedup works)
- `adela_runs` shows `scraper='news'`, `status='success'`, `rows_inserted=<N>`
- Per-feed failure does not stop other feeds (verify by intentionally including 1 bad URL)

## Risks + mitigations

- **Risk:** Some feeds rate-limit. **Mitigation:** stagger requests with 500 ms delay between feeds.
- **Risk:** Duplicate articles across feeds (same article from 2 syndicators). **Mitigation:** hash on canonicalized URL (strip query params + tracking) — implement `canonicalizeUrl` helper.
- **Risk:** Feeds drift / break. **Mitigation:** on >50 % feeds failing in a single run, send WhatsApp alert.

## NEVER list

- No paywall bypass / login-gated feeds
- Headlines/summaries only — never store full article body without explicit licensing review
