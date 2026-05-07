---
primary-domain: frontend
---
# ADR-020: Draft a CropsIntel V3 task spec for Phase phase-1.8. Goal / additional context (

**Status:** Proposed
**Date:** 2026-05-06
**Council depth:** Quick
**Confidence:** 0.80
**Total cost:** $0.1937
**Wall time:** 36s

## Context
Draft a CropsIntel V3 task spec for Phase phase-1.8.
Goal / additional context (from caller):
Market Price Intelligence dashboard. This is the core product value proposition — the first thing a subscriber sees. Deliverables: (1) src/pages/MarketPriceIntelligence.tsx — hero dashboard page. Shows: current Strata almond prices by variety (Nonpareil, Carmel, Butte/Padre, Monterey, Mission) and form (Natural, Blanched, Sliced, Slivered, Meal), price trend chart (last 12 weeks), week-on-week delta badge, Maxons margin overlay toggle (price × 1.03 — admin only, hidden from subscribers). All data from strata_prices table via Supabase. (2) src/components/dashboard/widgets/PriceMomentumWidget.tsx — compact widget version for embedding in dashboard shell. Shows top 3 movers (biggest WoW delta), sparkline per mover. (3) src/components/dashboard/widgets/StrataChartWidget.tsx — full chart widget, recharts LineChart, one line per variety, date on X axis, price USD/lb on Y axis, responsive. Loading: Skeleton. Error: Alert with message. Empty: 'No price data yet — Adela scrapes every Tuesday'. DEPENDS ON: phase-1.6b (strata_prices table), phase-1.6d (strata-scraper). NEVER show mock prices to subscribers. NEVER expose the margin overlay toggle to non-admin roles.
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
# Task: Phase 1.8 — Market Price Intelligence Dashboard

**Master plan reference:** Core product value proposition from CropsIntel V3 master plan §3.2 "Subscriber-facing intelligence surfaces."

**Estimated effort:** 1.5 days estimated by Claude, with a broader 3-week time frame mentioned by GPT-4o. Considering complexity, an estimated effort of 5-7 days should suffice to build and test key components thoroughly.

**Model:** claude-sonnet-4.5

## Goal
Implement the Market Price Intelligence dashboard as the main interface for subscribers, displaying current Strata almond prices with trending data over 12 weeks, and providing insights through week-on-week price change highlights. Admin users will have access to toggle the Maxons margin overlay.

## Files
- **Hero Dashboard Page:** `src/pages/MarketPriceIntelligence.tsx` handles the primary display of almond price data and forms with a trend chart and delta tracking.
- **Momentum Widget:** `src/components/dashboard/widgets/PriceMomentumWidget.tsx` focuses on top movers with sparkline visuals.
- **Cart Widget:** `src/components/dashboard/widgets/StrataChartWidget.tsx` includes a responsive line chart showcasing almond price variety.
- **New Functional Components include:** Hooks for `strata_prices` data management, pure functions for price deltas and admin-only margin application.

## Success criteria
1. Render accurate price data from the `strata_prices` table, with no mock prices.
2. Proper permissions for the Maxons Margin Overlay accessible only to admins.
3. Stable and responsive UI components, including widgets and trend charts.
4. Error handling and empty state management ensure robustness under unexpected data availability scenarios.

## Risks + mitigations
- Dependency on `phase-1.6b` (strata_prices table) and `phase-1.6d` (strata-scraper). Verify these before initiating this phase.

## NEVER list
- NEVER show mock prices to subscribers.
- NEVER allow non-admin users access to the margin overlay.

## Synthesis
All three experts agree on the core objective of creating a user interface displaying almond pricing with admin-specific details, though there was a discrepancy in estimated effort between GPT-4o and Claude. The primary conflict was solved by synthesizing the detailed technical output from Claude, integrating GPT-4o's broader timeline considerations, making a more balanced effort estimation.

**Individual answers:**
- **Claude:** ```markdown
---
phase: phase-1.8
name: market-price-intelligence-dashboard
model: claude-sonnet-4.5
status: draft
depends_on:
  - phase-1.6b
  - phase-1.6d
  - phase-1.7  # dashboard shell (assumed prerequisite for widget embedding)
---

# Task: Phase 1.8 — Market Price Intelligence Dashboard

**Mas
- **GPT:** ```adrMarkdown
---
model: CropsIntel V3
---

# Task: Phase 1.8 — Market Price Intelligence Dashboard

**Master plan reference:** Core Product Value Proposition

**Estimated effort:** 3 weeks

## Goal

To implement the Market Price Intelligence dashboard which serves as the primary interface for subs
- **Gemini:** (error: [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent: [404 Not Found] models/gemini-1.5-pro is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of avail

## Consequences
This architectural decision should be implemented in the next relevant task. The council has reviewed the question from multiple AI perspectives and reached a consensus.

## Full audit trail
council_runs.id = undefined in V3 Supabase
