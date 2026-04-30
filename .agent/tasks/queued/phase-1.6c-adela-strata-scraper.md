# Task: Phase 1.6c — Adela Strata price scraper

**Master plan reference:** §11.2 row 1.6 (6 scrapers); §7.4 Market Price Intelligence (price observations).
**Context:** Strata Almond publishes weekly almond market commentary + indicative price ranges by variety / size / form on a publicly accessible page. This scraper extracts those price points and writes them to `price_observations` (created in 1.6a).
**Estimated effort:** ~50 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

Add `adela/src/scrapers/strata.ts` that:

1. Fetches the Strata Almond weekly market commentary page (URL configurable; default `https://www.stratamarketing.com/almond-market-commentary/` — verify and update at build time)
2. Parses the latest week's price ranges (variety, size, form, FAS/CIF range in USD/lb)
3. Inserts one row per (variety × size × form × trade_basis) into `price_observations` with `source='strata'`
4. Idempotent on (`source`, `observation_date`, `variety`, `size_grade`, `product_form`, `trade_basis`) — use ON CONFLICT DO UPDATE for `price_usd_per_lb` (so re-running mid-week corrects updated prices)
5. Schedule: weekly Friday 13:00 UTC (`0 13 * * 5`) — captures end-of-week posting
6. Uses Gemini Pro for extraction (page is unstructured prose with embedded tables)
7. Stores raw HTML in Supabase Storage `adela-raw/strata/` for audit replay

## Architecture

```
adela/
├── src/
│   ├── scrapers/
│   │   ├── abc.ts (existing — pattern reference)
│   │   ├── usda.ts (1.6b)
│   │   └── strata.ts (NEW)
│   └── scheduler.ts (extend)
```

Reuse `gemini.ts` `extractPdfJson` pattern but for HTML — likely needs a sibling `extractHtmlJson` helper. Pass the page HTML (after `cheerio` strip-tags) as text to Gemini with a strict JSON schema.

## Extraction schema (Zod)

```typescript
const StrataPriceSchema = z.object({
  observation_date: z.string(),               // 'YYYY-MM-DD' of the report
  observations: z.array(z.object({
    variety: z.string(),                       // 'Nonpareil' | 'Independence' | 'Carmel' | etc.
    size_grade: z.string().nullable(),         // '23/25', '27/30'
    product_form: z.enum(['inshell', 'shelled', 'blanched']),
    trade_basis: z.enum(['FAS', 'CIF', 'FOB']),
    price_usd_per_lb_low: z.number().nullable(),
    price_usd_per_lb_high: z.number().nullable(),
    notes: z.string().nullable(),
  })),
})
```

When inserting, use the midpoint of low/high as `price_usd_per_lb` and store both endpoints in `raw`.

## Files

- `adela/src/scrapers/strata.ts` (NEW)
- `adela/src/gemini.ts` (extend) — new `extractHtmlJson(html, schema, prompt)` helper
- `adela/src/config.ts` (extend) — `strata` config block
- `adela/src/scheduler.ts` (extend) — register `runStrataScraper`

No new tables — uses `price_observations` from 1.6a.

## Success criteria

- Manual run produces ≥6 rows in `price_observations` with `source='strata'` from a real fetched page
- Re-run produces 0 new rows (idempotency via UPSERT)
- `adela_runs` row with `scraper='strata'`, `status='success'`
- Page HTML stored in Supabase Storage at `adela-raw/strata/<observation_date>.html`

## Risks + mitigations

- **Risk:** Strata changes page HTML structure. **Mitigation:** Gemini extraction is robust to layout changes; strict Zod schema rejects bad payloads; on validation fail, log full HTML to `adela_runs.metadata` and ping WhatsApp `notify_whatsapp` so a human can update the prompt.
- **Risk:** Strata blocks the bot User-Agent. **Mitigation:** use the same `CropsIntel-Adela/1.0` UA pattern; if 403 persists, fall back to a generic browser UA after 1 retry.
- **Risk:** Page doesn't have prices that week (skip week). **Mitigation:** if Gemini returns empty `observations`, `finishRun(status='skipped')` and don't error.

## NEVER list

- No CAPTCHA bypass / headless browsers — if the page protects with bot detection, escalate to user instead of bypassing.
- No exfiltrating account-gated content (Strata's free pages only).
