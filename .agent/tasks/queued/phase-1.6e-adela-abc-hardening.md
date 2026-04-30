# Task: Phase 1.6e — Adela ABC scraper hardening

**Master plan reference:** §11.2 row 1.6; §13.1 Scope Guardian rule "fix in place, do not parallel-restart."
**Context:** The ABC scraper shipped in 1.00e at `adela/src/scrapers/abc.ts` is functional but has gaps: (1) no retry-and-notify on hard failures, (2) no metrics back to `scraper_sources.last_run_at` (created in 1.6a), (3) no extraction of by-variety detail rows into a child table, (4) no monthly summary email/WhatsApp digest. This spec hardens it without rewriting.
**Estimated effort:** ~40 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

1. Update `scraper_sources.last_run_at` and `last_status` after every ABC run
2. On 3rd consecutive failure, escalate via WhatsApp + write a `market_signals` row with `signal_type='shipment_anomaly'`, `severity='critical'`
3. Promote `by_variety` extracted JSON into a new table `position_report_varieties` so it can be queried (each row: position_report_id, variety, shipments_lbs, inventory_lbs, commodity_id)
4. After successful run, send a WhatsApp summary message: "ABC March 2026 Position Report ingested — 240M lbs shipped, 480M lbs in inventory (down 3% MoM)"
5. Add `tests/abc.test.ts` (Vitest or Node `test`) with at least 2 unit tests:
   - HTML parser correctly extracts a known PDF href from a fixture HTML
   - Report-date parser correctly converts a known PDF path to YYYY-MM-DD

## Schema

```sql
-- migration 20260501000003_position_report_varieties.sql
CREATE TABLE IF NOT EXISTS public.position_report_varieties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_report_id uuid NOT NULL REFERENCES public.position_reports(id) ON DELETE CASCADE,
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  variety text NOT NULL,
  shipments_lbs numeric,
  inventory_lbs numeric,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(position_report_id, variety)
);
ALTER TABLE position_report_varieties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read varieties" ON position_report_varieties FOR SELECT USING (true);
CREATE POLICY "Team can insert varieties" ON position_report_varieties FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'team'));
CREATE INDEX idx_prv_report ON position_report_varieties (position_report_id);
```

## Files

- `adela/src/scrapers/abc.ts` (extend — DO NOT rewrite from scratch)
- `adela/src/lib/scraper-sources.ts` (NEW) — helpers `markRunStart(scraper_key)` and `markRunEnd(scraper_key, status)` that update `scraper_sources` row
- `adela/src/lib/digest.ts` (NEW) — formats post-run WhatsApp summary
- `adela/tests/abc.test.ts` (NEW) — fixture-based unit tests
- `adela/tests/fixtures/abc-index-sample.html` (NEW) — captured HTML snippet for parser test
- `adela/package.json` (extend) — add `"vitest": "^1.6.0"` to devDependencies; add `"test": "vitest run"` script
- `supabase/migrations/20260501000003_position_report_varieties.sql` (NEW)

## Success criteria

- `cd adela && npm test` — all tests pass
- After a manual run, `scraper_sources` row for `'abc'` has `last_run_at` updated within 60 s and `last_status='success'`
- After a manual run, `position_report_varieties` has ≥3 rows for the latest report (Nonpareil, Carmel, Independence at minimum)
- WhatsApp message arrives at +971562556592 with summary text
- TypeScript build still passes
- After 3 simulated failures (mock fetch to throw), a `market_signals` row is created with `severity='critical'`

## Risks + mitigations

- **Risk:** Existing scraper logic regressions. **Mitigation:** never delete code; only add. Run existing scraper end-to-end after edits to confirm equivalent behavior.
- **Risk:** WhatsApp send fails (Twilio outage). **Mitigation:** wrap in try/catch; never let notification failure mark the scrape itself as failed.
- **Risk:** Test fixture HTML drifts from real page over time. **Mitigation:** fixture is a snapshot; we accept that future Strata HTML changes won't break the existing test (it tests the parser logic against a fixed input).

## NEVER list

- No "rewrite ABC scraper from scratch." This is hardening — additive only.
- No deleting `position_reports.extracted` JSON column (still load-bearing for replay).
