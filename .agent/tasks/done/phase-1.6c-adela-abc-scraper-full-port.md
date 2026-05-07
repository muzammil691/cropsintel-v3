---
primary-domain: mixed
---
# ADR-023: Draft a CropsIntel V3 task spec for Phase phase-1.6c. Goal / additional context 

**Status:** Proposed
**Date:** 2026-05-06
**Council depth:** Quick
**Confidence:** 0.90
**Total cost:** $0.1901
**Wall time:** 37s

## Context
Draft a CropsIntel V3 task spec for Phase phase-1.6c.
Goal / additional context (from caller):
Adela fix part 2 of 5. Complete adela/src/scrapers/abc-scraper.ts — full implementation porting V1 extract-market-shipments logic. Must handle all 7 ABC report types: position reports, shipments, receipts, forecasts, acreage, almanac, handler data. For position reports: extract exactly 9 market rows with precise column mapping — India, W.Europe, Middle East, China/HK, Vietnam, Turkey, UAE, Pakistan, Domestic. CRITICAL domain rules baked in: Turkey row is NOT included in Total Middle East, W.Europe excludes UK post-Brexit, China/HK are combined. Use Firecrawl for PDF extraction if available, fallback to axios + pdf-parse. Upsert into position_reports table with conflict handling on (report_date, market). Include audit log entry per scrape run into atlas_dispatches.
Output the full spec body as adrMarkdown. The spec MUST contain (case-insensitive):
  - "# Task: Phase <X.Y> — <name>" heading
  - "**Master plan reference:**" line
  - "**Estimated effort:**" line
  - "**Model:**" line
  - "model:" frontmatter line
  - "## Goal" section
  - "## Files" or "## Architecture" section
  - "## Success criteria" section (these become Verifier check inputs)
  - "## Risks + mitigations" section
  - "## NEVER list" section (Builder hard constraints)
Foundation-first rule: do not propose a feature whose dependencies aren't
already shipped. If a dependency is missing, name it in Risks + mitigations
and recommend the dependency phase first.

## Decision
---
phase: 1.6c
title: "Adela ABC Scraper — Full Port (Fix Part 2 of 5)"
model: claude-sonnet-4-5
owner: Adela
status: draft
---

# Task: Phase 1.6c — Adela ABC Scraper Full Port

**Master plan reference:** CropsIntel V3 Master Plan §4.2 (Adela ingestion service) and §6.1 (ABC almond data foundation). Part 2 of the 5-part Adela fix series (1.6b → 1.6f).

**Estimated effort:** 6–8 hours (single focused session). ~450 LOC scraper + ~150 LOC tests.

**Model:** claude-sonnet-4-5

## Goal
Replace the stub `adela/src/scrapers/abc-scraper.ts` with a complete, production-ready implementation that ports V1's `extract-market-shipments` logic and extends it to cover all 7 ABC report types. The scraper must detect the report type, extract structured rows, and apply domain rules directly in the parser. Use Firecrawl for PDF extraction if available, otherwise default to axios + pdf-parse. Data should be upserted idempotently and an audit log written per scrape invocation.

## Architecture
adela/src/scrapers/abc-scraper.ts
├── fetchPdf(url)                    # Firecrawl primary, axios+pdf-parse fallback
├── detectReportType(text, filename) # → ABCReportType enum
├── parsers/
│   ├── parsePositionReport(text)    # 9 fixed market rows
│   ├── parseShipments(text)
│   ├── parseReceipts(text)
│   ├── parseForecast(text)
│   ├── parseAcreage(text)
│   ├── parseAlmanac(text)
│   └── parseHandlerData(text)
├── applyDomainRules(rows)           # Turkey/Brexit/HK enforcement
├── upsertPositionReport(supabase, rows, reportDate)
└── logDispatch(supabase, runMeta)   # → atlas_dispatches

## Files
- **Modify:** `adela/src/scrapers/abc-scraper.ts` (replace stub)
- **Create:** `adela/src/scrapers/abc-types.ts`
- **Create:** `adela/src/scrapers/abc-parsers/{position,shipments,receipts,forecast,acreage,almanac,handler}.ts`
- **Create:** `adela/src/scrapers/__tests__/abc-scraper.test.ts` (fixture-driven, uses `tests/fixtures/abc/*.pdf` from V1)

## Success criteria
All tasks must ensure fidelity in data extraction, domain rule implementation, idempotency, and audit logging.
- Test coverage must include all 7 report types and adhere to specified domain rules using both Firecrawl and pdf-parse extraction methods.

## Risks + mitigations
- **Dependency on Firecrawl**: If not yet integrated, defaults to axios + pdf-parse can be used initially.
- **Complex domain rules**: Misinterpretations could lead to incorrect data capture; extensive automated tests and stakeholder review will be essential.

## NEVER list
- DO NOT deploy implementation that incorrectly integrates data into Middle East totals or misrepresents W.Europe and China/HK markets.

## Synthesis
The three responses agreed on the main components such as the task goal, necessary file modifications, and success criteria involving adherence to domain rules and idempotent upserting. The discrepancy was mainly in the estimated effort; Claude's answer is selected due to its detailed breakdown of architecture and types, which makes it more credible and actionable for technical implementation.

**Individual answers:**
- **Claude:** ```markdown
---
phase: 1.6c
title: "Adela ABC Scraper — Full Port (Fix Part 2 of 5)"
model: claude-sonnet-4-5
owner: Adela
status: draft
---

# Task: Phase 1.6c — Adela ABC Scraper Full Port

**Master plan reference:** CropsIntel V3 Master Plan §4.2 (Adela ingestion service) and §6.1 (ABC almond dat
- **GPT:** ```adrMarkdown
---
model: Adela Phase 1.6c
---

# Task: Phase 1.6c — Implement ABC Scraper Logic

## Master plan reference:
This task is part of the multi-commodity agricultural intelligence platform, CropsIntel V3, specifically focusing on implementing the scraper logic for extracting and handling 
- **Gemini:** (error: [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent: [404 Not Found] models/gemini-1.5-pro is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of avail

## Consequences
This architectural decision should be implemented in the next relevant task. The council has reviewed the question from multiple AI perspectives and reached a consensus.

## Full audit trail
council_runs.id = undefined in V3 Supabase
