# CropsIntel V1 — Product Vision

> Canonical product vision. Read by Atlas on every wizard run. Edit directly from cockpit Plan tab.
> Last updated: 2026-05-08

## What it is

CropsIntel is a global almond market intelligence + trading workflow platform. It pairs Bloomberg-style market data (position reports, Strata pricing, news) with a verified-counterparty trading workflow (inquiry → offer → contract → fulfillment → audit).

## Who it's for

- **Tier 1 — Registered users:** anyone curious about almonds. Sees teaser data, public news, basic price index. Free.
- **Tier 2 — Verified users:** vetted commodity traders, processors, growers, brokers. Sees real-time data, positions, exclusive insights, and can transact via Maxons workflow. Paid.
- **Tier 3 — Admin (Maxons):** internal Maxons team. Verifies users, runs reports, manages the platform.

Geographic focus: Gulf, South Asia, Central Asia, Turkey. Operating language: English with Arabic-aware UI elements.

## What it does (in launch order)

- **V1.0 alpha:** auth + RBAC + verified queue + V2 user migration. Single product (almonds). Read-only insights at /insights.
- **V1.0 beta:** Adela data spine live (position reports + Strata + IMAP news). Inquiry/offer/contract flow. Three-tier RBAC enforced.
- **V1.5:** multi-commodity (walnut, pistachio enabled). Multi-portal frontend per role. Reports library.
- **V2.0:** prescriptions (hyper-personalized directives), AI-driven inquiry matching, audit-trail compliance reports.

## Non-goals (do NOT build)

- General agricultural data platform (we are almond-first, not multi-crop generalist).
- Consumer-facing app (B2B only).
- Spot exchange or brokerage license features (we are intelligence + workflow, not a market-maker).
- Real-time chat between counterparties (offers + contracts only — chat is out of scope).

## Voice and feel

- **Premium and dense.** Like Bloomberg Terminal, not consumer apps. Information density is a feature, not a problem.
- **Brown + yellow palette** (Maxons brand) accented with the data viz palette.
- **English first, Arabic-aware.** Right-to-left support where Arabic content is shown.
- **Trust signals are loud.** Verified badges, audit timestamps, source attribution.

## Hard rules (do NOT violate)

1. Foundation-first — extend the 12-table foundation in 20260428_v3_foundation.
2. Anti-restart — fix in place, never `file-2.tsx` alternatives.
3. Multi-commodity from day 1 — every domain row has `commodity_id UUID FK`.
4. AI keys server-side only — zero `VITE_ANTHROPIC_*`, `VITE_OPENAI_*`, `VITE_GOOGLE_*`.
5. Information walls are load-bearing — RLS at DB layer, app layer respects.

## Known constraints

- **Stack:** Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui + Supabase + 7 Railway services.
- **Builder budget:** ~$15/day on Atlas budget cap.
- **Founder:** Muzammil Akhtar, Maxons General Trading, Dubai.
