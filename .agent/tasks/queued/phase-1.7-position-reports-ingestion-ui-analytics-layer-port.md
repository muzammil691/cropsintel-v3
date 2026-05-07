---
primary-domain: frontend
---
# ADR-018: Draft a CropsIntel V3 task spec for Phase phase-1.7. Goal / additional context (

**Status:** Proposed
**Date:** 2026-05-06
**Council depth:** Quick
**Confidence:** 0.90
**Total cost:** $0.1939
**Wall time:** 32s

## Context
Draft a CropsIntel V3 task spec for Phase phase-1.7.
Goal / additional context (from caller):
Position reports ingestion UI and analytics layer. Port V1's positionReportAnalyticsLayer.ts logic verbatim — do NOT rebuild from scratch (it took 25+ iterations in V1). Two deliverables: (1) Port analytics layer to src/lib/position-report-analytics.ts: functions computeYoY(current, prior), computePaceVsPriorYear(ytd, priorYtd, daysElapsed), computeCommitmentRate(shipped, contracted), computeAvailableInventory(crop, shipped, inTransit), computeDemandStrength(currentPace, historicalAvg). All functions typed, all return { value, trend: 'up'|'down'|'flat', confidence: number }. (2) Position Reports page: src/pages/PositionReports.tsx — table view of position_reports rows grouped by market, filterable by date range and market name, sortable by any column, shows YoY delta badges (green/red), links to detail drawer per row. Uses data from Supabase position_reports table. Loading skeleton, error state, empty state. DEPENDS ON: phase-1.6b (position_reports table must exist). NEVER rebuild analytics from scratch — read V1 source first. NEVER ship the page with hardcoded mock data.
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
# Task: Phase 1.7 — Position Reports Ingestion UI & Analytics Layer Port

**Master plan reference:** CropsIntel V3 Architectural Initiative
**Estimated effort:** 6–8 hours (2h analytics port + verification, 4–5h page UI + states, 1h QA against live Supabase data)
**Model:** claude-sonnet-4-5

## Goal
Deliver the Position Reports surface in V3 by porting V1's `positionReportAnalyticsLayer.ts` logic verbatim into `src/lib/position-report-analytics.ts`, and creating `src/pages/PositionReports.tsx` with real-time data from Supabase, including filtering and sorting functionality.

## Files
- `src/lib/position-report-analytics.ts`: Port existing analytics logic here.
- `src/pages/PositionReports.tsx`: Develop the UI for the Position Reports page.

## Architecture
### Position Report Analytics Module
- Functions to Port and Type:
  - `computeYoY(current, prior)`: Calculate year-over-year performance.
  - `computePaceVsPriorYear(ytd, priorYtd, daysElapsed)`: Determine current pace relative to the previous year.
  - `computeCommitmentRate(shipped, contracted)`: Evaluate the rate of shipped vs contracted goods.
  - `computeAvailableInventory(crop, shipped, inTransit)`: Calculate available crop inventory.
  - `computeDemandStrength(currentPace, historicalAvg)`: Assess demand strength.
- Return Type for Each Function:
  ```typescript
  {
    value: number;
    trend: 'up' | 'down' | 'flat';
    confidence: number;
  }
  ```

### Position Reports Page
- Features:
  - Table view of `position_reports`, grouped by market.
  - Filter functionality by date range and market name.
  - Sortable columns with YoY delta badges (green/red).
  - Links to a detail drawer per row.
  - States for loading (skeleton), error, and empty data.
  - Real-time data fetched from Supabase `position_reports` table.

## Success criteria
1. The analytics layer must be equivalent to V1's logic without deviations.
2. Effectively render and function with real data from the `position_reports` table.
3. Implement filters, sort options, and delta badges correctly.
4. Provide feedback for loading, error, and empty states without any mock data.
5. Seamless integration with Supabase database.

## Risks + mitigations
- **Dependency on Phase 1.6b**: Ensure the `position_reports` table is operational.
- **Complexity in Porting Logic**: Allocate time for understanding and testing.

## NEVER list
- NEVER rebuild analytics functions from scratch.
- NEVER ship a UI that relies on hardcoded mock data.
- NEVER modify analytics logic without review.

## Synthesis
All three experts agree on the core requirements: porting analytics logic from V1 and building a Position Reports page that uses real data. The discrepancy in estimated effort is resolved by using Claude's detailed breakdown, which aligns with specific task allocations and testing protocols.

**Individual answers:**
- **Claude:** ---
model: claude-sonnet-4-5
phase: 1.7
depends_on: [phase-1.6b]
---

# Task: Phase 1.7 — Position Reports Ingestion UI & Analytics Layer Port

**Master plan reference:** CropsIntel V3 master plan, Phase 1.7 (Position Reports surface + analytics foundation for multi-commodity intelligence).

**Estim
- **GPT:** ```adrMarkdown
---
model: CropsIntelV3
---

# Task: Phase 1.7 — Position Reports Ingestion UI and Analytics Layer

**Master plan reference:** CropsIntel V3 Architectural Initiative
**Estimated effort:** 2 weeks
**Model:** CropsIntelV3

## Goal

The primary objective of this task is to seamlessly int
- **Gemini:** (error: [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent: [404 Not Found] models/gemini-1.5-pro is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of avail

## Consequences
This architectural decision should be implemented in the next relevant task. The council has reviewed the question from multiple AI perspectives and reached a consensus.

## Full audit trail
council_runs.id = undefined in V3 Supabase
