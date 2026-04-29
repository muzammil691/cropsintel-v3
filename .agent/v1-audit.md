# V1 Audit — `almond-oracle` (Lovable build of cropsintel.com)

**Repo:** gitlab.com/muzammil69/almond-oracle (made temporarily public for this audit)
**Cloned to:** /tmp/almond-oracle (44 MB, 1,374 source files, 6,922 commits, 1 branch `main`)
**Lovable project:** https://lovable.dev/projects/c67fedaa-d01c-41b6-9e52-7959da6ea5f8
**Last commit:** Apr 24 (`Added export btn to Users page`) by `gpt-engineer-app[bot]`
**Status:** Not currently serving cropsintel.com (V2 is). Lovable bot still actively pushing to it — feature work hasn't stopped.
**Author:** Cowork — Muzammil Akhtar
**Date:** 2026-04-28
**Scope of this document:** Step 2 of the V3 handoff sequence. Read-only audit of V1 only. Does not propose V3 changes.

---

## 0. Executive summary in five bullets

- V1 is the **real CropsIntel platform** by every measurable definition: 69 routes, 39 pages, 66 Supabase edge functions, 228 SQL migrations spanning 6 weeks, 80+ database tables, ~30 Zyra-prefixed library modules. V2 is a thin frontend shell that lost almost all of this.
- The "intelligence layer" the briefing attributed to V2 (Atlas, Multi-Brain, Dr. Atlas, brain-ai, MasterExecutionPlan) all lives here — and it's substantial: brain-ai is an 826-line Multi-Brain orchestrator routing Claude + GPT-4o + Gemini through a consensus engine, and dr-atlas is a 2,307-line customer-facing agent with confidence-based escalation and intelligence capture.
- **The data foundation problem the briefing called out (offers built before products) is real and is in V1.** Both `canonical_products` and `admin_sales_offers` exist, but the offer pipeline is heavily built out (multiple offer-line, offer-destination, customer-product tables) while product canonicalization looks shallow. This is the foundation skip pattern Muzammil keeps flagging.
- **AI provider usage is heavily Gemini-skewed (24 file references) vs Claude (4) and OpenAI (2).** This contradicts the briefing's "Multi-Brain runs Claude + GPT-4o + Gemini in parallel" framing. The Multi-Brain pattern exists in `brain-ai` specifically, but the rest of the platform mostly calls Gemini via the Lovable AI gateway. Claude is used in `dr-atlas` and a few others. OpenAI is barely used directly.
- **Lovable bot is still actively pushing to V1 four days ago** with detailed scoped plans (`.lovable/plan.md` shows "Step 43: Fix Widget Workshop UI Layout"). This means V1 is not a frozen artifact — it is still being changed by Lovable AI. Any V3 reference snapshot needs to be a tagged commit, not "whatever V1 is today."

---

## 1. Tech stack (from `package.json`)

**Stack:** Vite 5 + React 18.3 + TypeScript 5.8 + Tailwind 3.4 + shadcn/ui (Radix UI primitives) + Supabase (`@supabase/supabase-js` 2.75) + React Router 6.30. Bun is the package manager (`bun.lock` + `bun.lockb` present).

**Notable production dependencies (80 total):**
- **State / data:** `@tanstack/react-query` 5.83, `zustand` 4.5, `react-hook-form` 7.61 + `zod` 3.25 + `@hookform/resolvers` 3.10
- **UI primitives:** ~30 `@radix-ui/react-*` packages. Standard shadcn/ui foundation.
- **Icons / animation:** `lucide-react` 0.462, `tailwindcss-animate`, `next-themes` 0.3
- **Charts:** `recharts` 2.15. Plus 3D: `@react-three/fiber` 8.18 + `@react-three/drei` 9.99 + `three` 0.170
- **AI / voice:** `@elevenlabs/react` 0.14 (Zyra voice). No direct Claude/OpenAI/Gemini SDK in the React app — those are server-side in edge functions.
- **Exports / files:** `exceljs` 4.4, `jspdf` 4.2, `file-saver`, `jszip` 3.10, `html2canvas`, `html-to-image`, `tus-js-client` (resumable uploads)
- **i18n:** `i18next` 25.8 + `react-i18next` 16.5 + browser language detector. App is internationalized.
- **PWA:** `vite-plugin-pwa` 0.21 — installable as a Progressive Web App.
- **Layout:** `react-grid-layout` 2.2 + `react-resizable-panels` 2.1 (the dashboard widget grid).
- **Forms / inputs:** `input-otp` 1.4, `react-day-picker` 8.10, `cmdk` 1.1 (command palette), `embla-carousel-react`, `vaul` (drawer), `sonner` (toasts)
- **Markdown:** `react-markdown` 10.1
- **Testing:** `@playwright/test` 1.58 (e2e) + `vitest` 3.2 + `@testing-library/react` 16

**Notable dev dependencies (16 total):**
- `lovable-tagger` 1.1 — Lovable build instrumentation. Tells me Lovable injects metadata into the build.
- ESLint 9 + TypeScript-ESLint 8 — modern linting setup.

**Inference:** This is a mature, fully-featured Vite/React/Supabase app with serious production tooling (PWA, i18n, e2e tests, accessible UI primitives, and exhaustive form/data libraries). Not a thin prototype.

---

## 2. Top-level structure

```
almond-oracle/
├── .env                       # only Supabase URL/keys (no AI keys — those are server-side)
├── .lovable/plan.md           # Lovable-tracked plan for the current session/step
├── docs/                      # documentation
├── e2e/                       # Playwright tests
├── public/                    # static assets
├── scripts/                   # verification scripts (verify_dashboard.mjs, etc.)
├── src/                       # main app
└── supabase/                  # functions + migrations
```

`.env` exposes only:
- `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`

All AI provider keys (Claude, OpenAI, Gemini, ElevenLabs, Twilio) live in Supabase edge function secrets — not retrievable from this clone. To audit those, you'd need Supabase project access.

**`src/` subfolders:** `assets/`, `components/`, `contexts/`, `data/`, `hooks/`, `i18n/`, `integrations/`, `lib/`, `pages/`, `services/`, `test/`, `types/`, `utils/`, `widgets/` + `App.tsx`, `main.tsx`, `version.ts`.

---

## 3. Routes — all 69, grouped by permission tier

**Public (no auth required):**
- `/welcome` → Landing
- `/auth` → Auth
- `/install` → Install (PWA install prompt)
- `/news` → News
- `/labs` → Labs
- `/market-insights` → MarketInsights
- `/market-insight` → MarketInsightBrief

**Auth-required (any logged-in user):**
- `/dashboard/:tab?` → Index (the main dashboard with tabbed views)
- `/profile` → Profile
- `/settings` → SettingsPage
- `/inbox` → InboxPage
- `/crm` → CRM
- `/crm/customer/:customerId` → CustomerDetail
- `/offers/:offerId`, `/crm/offers/:offerId` → OfferViewPage
- `/zyra`, `/alma` → ZyraPage (note: `/alma` aliases `/zyra` — both lead to the Zyra page; suggests an "Alma" rename was considered)
- `/zyra-ai` → ZyraAI (separate page from `/zyra` — needs investigation)
- `/labs/alerts` → Alerts
- `/labs/saved-analyses` → SavedAnalyses
- `/trading-metrics` → TradingMetrics
- `/user-directory` → UserDirectory

**Team-only (Maxons internal):**
- `/users` → UserDirectoryPage (team-side view)
- `/operations`, `/ops/parser` → Operations / TeamParser
- `/atlas` → Atlas (the self-development project management page)
- `/atlas-pd` → AtlasPD (project development variant)
- `/atlas-brain` → AtlasBrain (the Multi-Brain orchestrator UI)
- `/team-profile` → TeamProfile
- `/changelog` → Changelog
- `/prompt-archive` → PromptArchive
- `/data-audit` → DataAudit (the 6-section data audit page from the briefing)
- `/crm/inquiry/:id` → CRM (inquiry-scoped)
- `/logo-options` → LogoOptions

**Admin-only:**
- `/admin` → Admin
- `/admin/parser`, `/admin/widget-audit`, `/admin/health`, `/admin/content`, `/admin/data-gaps`, `/admin/backfill`, `/admin/widget-workshop`, `/admin/widget-catalog`, `/admin/insights`, `/admin/users`, `/admin/audit`, `/admin/project-export`
- `/atlas-plan` → MasterExecutionPlan (the master plan page)

**Redirects:** ~15 routes redirect to canonical paths (e.g. `/insights` → `/market-insight`, `/ops` → `/operations`, `/saved-analyses` → `/labs/saved-analyses`). Indicates the route table has been refactored multiple times — old links stay alive via redirects.

**Catch-all:** `*` → NotFound.

**Inference:** Three-tier RBAC (auth / team / admin) is implemented as `<RouteGuard requires="...">`. This is the "internal team layer" the vision memory describes — it exists, it's enforced at the route level, and it's wired everywhere.

---

## 4. Pages (39 + admin subpages)

Numbered comments in page headers (`P260 applied`, `P304`, `P306`) suggest each prompt session in Lovable gets a sequential number — so this codebase has been through 300+ prompt iterations.

**Major user-facing pages:**
- **Index.tsx** — the dashboard with tab routing (`/dashboard/:tab?`). Likely the main authenticated landing.
- **Landing.tsx** — public welcome page
- **MarketInsights / MarketInsightBrief / TradingMetrics** — public-ish market intelligence views
- **CRM** — single CRM page that handles both list view and inquiry-scoped views via path params
- **CustomerDetail / OfferView / Offers / Inbox** — CRM detail flows
- **Zyra / ZyraAI** — TWO Zyra pages exist; likely one is the chat UI and the other is a different surface. Needs investigation.
- **Atlas / AtlasPD / AtlasBrain / MasterExecutionPlan** — four separate Atlas-related pages. AtlasBrain is the Multi-Brain orchestrator UI. MasterExecutionPlan is the plan-tracking view.
- **DataAudit** — the 6-section data audit page

**Admin pages:**
- AdminParser (`P263 — Team Parser Portal — P267 multi-file batch`), AdminWidgetWorkshop (the live widget editor), AdminBackfill, AdminDataGaps, AdminInsights, AdminAuditPage, AdminUsersPage, AdminContent, AdminHealth, WidgetAudit, WidgetCatalog, ProjectExport
- LogoOptions, PromptArchive, Changelog (mixed admin/team)

**Observation:** This level of admin-page coverage is unusual for a B2B SaaS at this stage. It suggests Muzammil is using V1 as his own operations console as much as a customer product — the platform manages itself.

---

## 5. Components inventory

`src/components/` is large. Top-level files (~70) plus 11 subfolders (`admin/`, `atlas/`, `crm/`, `dashboard/`, `insights-portal/`, `ops/`, `team/`, `ui/`, `whatsapp/`, `widgets/`).

**Reusable / cross-cutting:**
- `AppHeader`, `NavigationMenu`, `PublicPageNav`, `RouteGuard`, `ErrorBoundary`, `LanguageSwitcher`, `NotificationBell`, `CropsIntelLogo`, `BlurredOverlay`, `GuestSessionBanner`, `GuestTimer`, `GuestOverlay` (referenced indirectly), `AppGuide` (in-app tour)
- `ui/` — the shadcn/ui primitives folder (standard)

**Domain widgets (1-shot, on the dashboard):**
- Charts: `MarketBalanceChart`, `MonthlyShipmentsChart`, `PricingTrendsChart`, `ForecastAccuracyChart`, `AnimatedChart`, `ThreeChart` (3D)
- Cards: `MarketMetricsCard`, `MonthlyBriefCard`, `MarketIntelligence`, `MarketSentiment`, `MarketContainerTiles`
- Data: `ExportDestinationsTable`, `CropYearTimeline`, `PricingBandsWidget`, `PricingInputPanel`, `ExtractionProgress`, `DataReliabilityWidget`, `NextReportCountdown`
- CRM-adjacent: `CustomerExploreCard`, `CustomerValueSummary`, `MyOffersTracker`, `RequestQuoteForm`, `VerificationRequestCard`, `VerifiedInsightsWidget`
- Alerts: `PriceAlerts`, `ReferralPopup`, `TopActionsWidget`, `PriorityBoard`, `PriorityOpportunities`
- Other: `AIRiskWidget`, `AdminNewsManager`, `AdminWhatsAppBroadcast`, `CreditWalletWidget`, `DailyIntelligenceSnapshot`, `FirstUseTour`, `GrowthJourneyWidget`, `InteractiveScenarioAnalysis`, `MonthlyReportNavigator`, `NewsTicker`, `ProfileCompletionCard`, `QASummaryWidget`, `RecentSavedAnalyses`, `ShareAnalysisDialog`

**WhatsApp cluster (5):** `WhatsAppAdminPanel`, `WhatsAppBusinessNumber`, `WhatsAppRegistrationModal`, `WhatsAppSubscribeCTA`, `AdminWhatsAppBroadcast`

**Zyra cluster (10):** `ZyraAnalyticalWidget`, `ZyraCinematicExperience`, `ZyraGuideOverlay`, `ZyraNewsIntelWidget`, `ZyraObservationsWidget`, `ZyraRatingWidget`, `ZyraShell`, `ZyraShowcaseReel`, `ZyraWidgetAssistant`, plus the Zyra subfolder

**Inference:** The dashboard widget set is rich. Most widgets are domain-specific (almond market data) and won't transfer cleanly to other commodities without abstraction work — even though the briefing's vision says the platform must be commodity-agnostic from day one. **This is a tension to flag for V3.**

---

## 6. Hooks (33 in `src/hooks/`)

**Auth / identity:** `useAuth`, `useCurrentProfile`, `useUserContext`, `useUserRole`, `useTeamUserIds`, `useGuestSession`, `useProfileCompletion`

**Data domains:** `usePositionReports`, `usePositionReportMonths`, `usePositionIntelligence`, `usePricingData`, `usePricingRows`, `useReportData`, `useMonthlyInsight`, `useDashboard`, `useInquiries`, `useInquiriesRealtime`, `useNotifications`, `useOffers`, `useSavedAnalyses`, `useDestinationAliasStore`

**Feature-specific:** `useCreditWallet`, `useCustomerOfferContext`, `useWhatsAppBusinessNumber`

**Zyra:** `useZyraLearning`, `useZyraObservations`, `useVoice`

**Widget system:** `useWidgetConfig`, `useWidgetData`, `useWidgetTracker`, `useShowAllWidgets`

**Utility:** `use-mobile`, `use-toast`

**Inference:** Heavy use of custom hooks for domain logic. The widget system has its own hook trio (config + data + tracker) suggesting widgets are configuration-driven and instrumented for usage tracking.

---

## 7. Library code (`src/lib/`)

40 files. Three clusters:

**Zyra orchestration framework (26 files — this is by far the largest cluster):**
`zyraActionGuard`, `zyraAnalysisEngine`, `zyraAuditLogger`, `zyraCRMOperator`, `zyraCapabilityBuilder`, `zyraConversationTracer`, `zyraDataBoundary`, `zyraDataQueryLayer`, `zyraDepartmentOps`, `zyraInputSanitizer`, `zyraIntelligenceLayer`, `zyraLearningRegistry`, `zyraLiveDataConnector`, `zyraMemoryEngine`, `zyraNavigationIntelligence`, `zyraOperatorCore`, `zyraPersonalityEngine`, `zyraProactiveAlerts`, `zyraPromptDefense`, `zyraQualityTracker`, `zyraRBAC`, `zyraRateLimiter`, `zyraSecurityLayer`, `zyraSessionGuard`, `zyraSupabaseTables`, `zyraTradeParity`

**This is not a thin "voice assistant" — it's a fully-elaborated agent operating system** with: action guarding, analysis, audit logging, CRM operation, capability building, conversation tracing, data boundary enforcement, data query layer, department operations, input sanitization, intelligence layer, learning registry, live data connection, memory engine, navigation intelligence, operator core, personality engine, proactive alerts, prompt defense, quality tracking, RBAC, rate limiting, security, session guarding, table mapping, and trade parity logic.

This is a serious asset. Re-implementing it for V3 from scratch would take months. The names alone tell you Muzammil (or Lovable on his behalf) thought through the operational concerns of an autonomous agent that talks to customers AND operates internal systems.

**Atlas / data audit:**
- `drAtlas` — client-side Atlas SDK
- `dataGaps`, `issueTracker`, `pdAutoValidation`, `positionReportAnalyticsLayer` — data quality + position report logic
- `legacyFieldMap` — mapping for legacy data fields (suggests schema evolution and backward compatibility)
- `offerPerformanceSignals` — offer analytics

**Utilities:**
- `analysisCategorizer`, `destinationMatcher`, `formatAnalysisForShare`, `notifications`, `supabaseRetry`, `utils`

---

## 8. Services / Contexts / Integrations

- **Services:** `aiMatchService.ts`, `messageService.ts`, `priceIntelligenceService.ts` (only 3 — most logic lives in `lib/`)
- **Contexts:** `LazyMountContext`, `ReportDataContext`, `ReportDataMapper`
- **Integrations:** `integrations/supabase/client.ts` (the Supabase client init) + `types.ts` (auto-generated Supabase types — likely 1000+ lines reflecting the schema)

---

## 9. Supabase schema — the data model

228 migrations spanning 2026-03-11 → 2026-04-23 (six weeks of heavy iteration).

**Table count: 80+** (partial list, output was truncated).

**Tables grouped by domain:**

**Core CRM / trading flow:**
- `admin_sales_offers`, `admin_sales_offer_items`, `admin_sales_offer_destinations`, `admin_sales_offer_item_destinations` — full offer hierarchy
- `crm_offer_lines`, `bids`, `inquiries`, `inquiry_requests`, `inquiry_stages`, `offer_interactions`
- `customer_assignments`, `customer_ports`, `customer_products`, `customer_purchase_history`
- `canonical_products` — **the product master table the briefing said was missing!** Present, but I haven't yet checked whether the offer flow actually references it. Will dig in a follow-up pass.

**Atlas (intelligence / nervous system):**
- `atlas_data_quality`, `atlas_events`, `atlas_node_events`, `atlas_patterns`, `atlas_seo_log`, `atlas_user_sessions`
- `brain_discussions`, `brain_node_history`, `brain_nodes`, `brain_prompts` — Multi-Brain debate persistence (the AI council debates from the vision memory)

**Zyra (agent state):**
- `zyra_audit_log`, `zyra_conversations`, `zyra_crm_contacts`, `zyra_crm_deals`, `zyra_dashboard_signals`, `zyra_department_tasks`, `zyra_memory`, `zyra_rate_limits`, `zyra_security_events`, `zyra_user_profiles`

**Position reports / market data:**
- `position_report_audits` (so position reports ARE in V1's schema), plus likely `position_reports` itself in another migration
- `dashboard_market_stats`, `market_intelligence`, `market_intelligence_cache`, `market_context_enrichment`, `monthly_insights`
- `freight_rates`, `freight_rate_history`, `canonical_price_ranges`

**Operations / observability:**
- `audit_log`, `auth_audit_logs`, `verification_audit_log`, `admin_export_audit`, `app_issue_logs`, `account_deletions`
- `pipeline_log`, `dispatch_log`, `monitoring_runs`, `monitoring_findings`, `data_gaps`, `garbage_items`
- `ai_operations_log`, `ai_suggestions`, `dashboard_zyra_queries`

**WhatsApp:**
- `whatsapp_message_log`, `whatsapp_sessions`, `whatsapp_templates`

**Credit / billing:**
- `credit_earning_rules`, `credit_transactions`, `credit_wallets`

**Misc:**
- `account_numbers`, `backfill_jobs`, `chat_conversations`, `competitor_intel`, `news_articles`, `industry_publications`, `data_uploads`, `destination_aliases`, `email_send_log`, `email_send_state`, `email_unsubscribe_tokens`, `suppressed_emails`, `dashboard_widget_library`, `user_dashboard_configs`, `changelog_entries`

**RLS pattern:** The most recent migration uses `public.has_role(auth.uid(), 'admin')` for policy checks — there's a centralized role-checking function. This is the right pattern for RBAC at the database level.

**Inference:** This schema is rich enough to support the full vision (CRM, BRM, SRM, position reports, freight, credits, audits, Zyra agent state, Atlas intelligence). The data foundation IS here. The product canonicalization claim from the briefing ("offers without products") needs deeper verification — `canonical_products` exists but I haven't traced whether the offer system enforces FK relationships to it.

---

## 10. Edge functions — all 66, grouped by purpose

**AI orchestration (11):**
- `brain-ai` — Multi-Brain orchestrator (Claude + GPT-4o + Gemini → consensus → Lovable prompt). 826 lines.
- `dr-atlas` — customer-facing Atlas chat agent. 2,307 lines. Has confidence-based escalation, intelligence capture, conversation tracing.
- `ai-operations` — AI ops (likely log/track AI calls)
- `zyra-claude`, `zyra-intelligence`, `zyra-analyze-usage` — Zyra-specific AI workflows
- `dashboard-zyra` — dashboard-side Zyra queries
- `voice-assistant` — voice agent
- `monitor-engine` — monitoring agent
- `pd-ai-review` — project development AI review
- `sales-ai-coach` — coaching agent for the sales team
- `feedback-chat` — feedback chat

**Data ingestion / scraping (8):**
- `scrape-position-report`, `scrape-news`, `scrape-stratamarkets`
- `abc-historical-backfill`, `batch-scrape-historical`, `backfill-deep-report`, `backfill-destination-grid`, `approve-destination-grid`
- `extract-market-batch`, `extract-market-shipments`
- `populate-market-context`
- `fetch-pdf` — PDF fetcher (likely for ABC position report PDFs)

**WhatsApp / Twilio (12):**
- `whatsapp-login`, `whatsapp-webhook`, `whatsapp-status-callback`, `whatsapp-generate-report`
- `send-whatsapp-otp`, `verify-whatsapp-otp`, `send-whatsapp-broadcast`, `send-whatsapp-reminders`, `send-whatsapp-review`, `subscribe-whatsapp`, `send-zyra-template`
- `check-twilio-message`

**ElevenLabs (4):**
- `elevenlabs-conversation-token`, `elevenlabs-tts`, `elevenlabs-transcribe`, `elevenlabs-music`

**Email (5):**
- `auth-email-hook`, `email-otp-eligibility`, `process-email-queue`
- `send-offer-notification`, `send-ops-instructions`, `send-upload-reminder`

**Account / team management (6):**
- `create-customer`, `delete-account`, `delete-team-member`, `invite-team-member`, `provision-team`, `resend-team-invites`
- `admin-export-users`

**Billing / subscription:**
- `check-subscriber-status`, `verify-account-number`

**Reports / analytics:**
- `generate-monthly-insight`, `report-pipeline`, `bi-chart-builder`, `pricing-bands`, `reconcile-pricing-rows`

**Other:**
- `analyze-segment`, `analyze-user`, `process-pending-uploads`, `process-upload`, `translate-text`

**Inference:** The function set covers a large surface — agent orchestration, ingestion pipeline, multi-channel comms (WhatsApp, voice, email), team/account management, reporting. This is the operational backbone the vision memory describes ("Adela = nervous system / runtime orchestrator"), realized through edge functions rather than a custom server.

---

## 11. AI integration map (which providers, where)

File-count grep across `src/` and `supabase/functions/`:

| Provider | File references |
|---|---|
| Gemini / Google AI | **24** |
| Twilio | 22 |
| ElevenLabs | 13 |
| Anthropic / Claude | 4 |
| OpenAI / GPT | 2 |

**Read of brain-ai/index.ts (826 lines):** It DOES reference Claude + GPT-4o + Gemini explicitly. There's a `CONSENSUS_SYSTEM` prompt defining the consensus engine's job. So the Multi-Brain pattern exists in this one function. Outside brain-ai, the platform mostly calls Gemini through Lovable's gateway (which probably explains the high Gemini count — Lovable AI defaults to Gemini for cost).

**Read of dr-atlas/index.ts (2,307 lines):** Uses Claude (the comment `engine: "dr-atlas-claude"` is explicit). Has its own pipeline for `traceInteraction` → `captureIntelligence` → `shouldEscalate` → `createEscalation`. Detects user challenges (`/that'?s wrong|incorrect|not correct|are you sure/i`) and escalates low-confidence responses. Version `2.2.0-prompt25` — this function alone has been through 25+ prompt iterations.

**Important caveat:** I cannot verify which specific API keys are actually configured in Supabase secrets — that requires Supabase project access. The references in code show what the system *could* do; whether it's all running depends on which secrets are set.

---

## 12. Auth + RBAC

- **Provider:** Supabase Auth, with email OTP (`email-otp-eligibility`, `auth-email-hook`) and WhatsApp OTP (`send-whatsapp-otp`, `verify-whatsapp-otp`).
- **Roles:** Three-tier — `auth` (any logged-in), `team` (Maxons internal), `admin`. Enforced at:
  - Route level via `<RouteGuard requires="...">`
  - Database level via `public.has_role(auth.uid(), 'admin')` SQL function used in RLS policies
  - Application level via `useUserRole`, `useTeamUserIds`
- **Guest sessions:** `useGuestSession`, `GuestTimer`, `GuestSessionBanner`, `GuestOverlay` — there's a deliberate guest mode for public users to browse market intelligence before signing up. Aligns with the vision flywheel ("free analytics attracts the global almond chain").

---

## 13. Lovable workflow (`.lovable/plan.md`)

`.lovable/plan.md` shows the current Lovable session's plan. Today it reads "**Step 43: Fix Widget Workshop UI Layout + Zyra Chat Execution**" with: Audit, Changes (single file: `src/pages/AdminWidgetWorkshop.tsx`), Out of scope (explicit), Files modified, Acceptance criteria.

**Lovable enforces scoping:** the plan explicitly lists out-of-scope items ("No changes to widget components, useWidgetConfig, dr-atlas, Save/Publish/Revert/History, or ElevenLabs voice") and even acknowledges known limitations without trying to fix them in the same step ("widgets ignoring widgetConfig props is a known limitation — the diff display is the workaround").

**This is exactly the pattern V2/V3 should preserve.** Lovable's prompt discipline is doing what Muzammil wants the V3 "Scope Guardian" agent to do. Worth examining further when designing the V3 agent architecture.

---

## 14. What works (based on the audit, not runtime verification)

- **Three-tier RBAC** (auth/team/admin) at route, DB, and app level
- **Lazy-loaded routing** — every page is `React.lazy()` imported. Good initial-load performance.
- **Intelligence capture pipeline in dr-atlas** — every customer chat is traced, scored, and escalated when confidence is low or user pushes back. This is the "AI customer service backup plan + feedback loop" from the vision memory.
- **Multi-Brain consensus pattern in brain-ai** — three AI debaters + a consensus judge that synthesizes and produces Lovable-ready prompts. The "council of 3-4 AI systems" Atlas needs.
- **i18n + PWA + accessibility primitives** — production-ready surface.
- **Heavy data ingestion infrastructure** — scrapers for ABC position reports, news, StrataMarkets pricing, plus historical backfill jobs. Most of the data the platform needs is being collected.
- **Comprehensive audit/observability tables** — almost everything writes to a `*_log` or `*_audit` table.
- **Active development** — Lovable bot still pushing 4 days ago.

---

## 15. What's broken or stale (visible from this audit; needs runtime verification)

- **Foundation gap (offers vs products) — needs deeper investigation.** Both `canonical_products` and `admin_sales_offers` exist, but I haven't yet confirmed whether the offer flow enforces FK to canonical_products. If it doesn't, the briefing's complaint stands. **Marked as TODO for the next pass.**
- **AI provider mix is heavily Gemini-skewed** (24 file refs vs 4 Claude vs 2 OpenAI). The "Multi-Brain Claude + GPT + Gemini" pattern exists in one function (brain-ai); most of the rest of the platform seems to lean on Gemini through Lovable's gateway. This is fine if intentional, but it's not what the briefing implied.
- **Two Zyra pages** (`/zyra` AND `/zyra-ai`) — likely a transitional state where the new Zyra is being built next to the old one. Worth resolving before V3 freezes the reference snapshot.
- **`/alma` aliases `/zyra`** — suggests an "Alma" rename that didn't fully land. Naming inconsistency.
- **CropsIntelV2 (the live site) is a thin shell that lost almost all of this** — V2 is in production today but doesn't have Atlas, Multi-Brain, DataAudit, Zyra orchestration, or the 60+ edge functions. So your live customers are running on a thin V2 while the rich V1 is parked on Lovable. **This is the most important business risk to understand right now.** It means cropsintel.com is currently delivering a fraction of the platform's actual capability.
- **Prompt-numbering convention shows wear** — pages tagged `P260`, `P263`, `P267`, `P304`, `P305`, `P306` are scattered, and the Lovable plan is now at "Step 43" of a separate counter. There are at least two numbering systems running concurrently.
- **`bun.lock` AND `bun.lockb`** — two Bun lockfile formats are committed. One should win.
- **228 migrations in 6 weeks** — that's ~38 migrations/week, ~5/day. Schema is still moving fast. Any V3 reference snapshot needs a frozen commit hash, not "current main."

---

## 16. Worth porting to V3 (concepts, not necessarily code)

**Definitely port (concepts, possibly code):**
1. **Zyra orchestration framework** — the 26-module `lib/zyra*` set is a designed agent OS. Re-architecting it from zero for V3 would take months. Even if V3 rewrites the JS, the *contracts* and *responsibilities* of these 26 modules should be preserved.
2. **Multi-Brain consensus pattern** (brain-ai) — three AI debaters + a synthesizer that always emits a Lovable-ready prompt. Port the *pattern* even if the implementation is rewritten.
3. **Dr. Atlas confidence + escalation pipeline** — `traceInteraction → captureIntelligence → shouldEscalate → createEscalation` with regex-based user-challenge detection. Best-in-class agent feedback loop.
4. **Three-tier RBAC at route/DB/app** — exact pattern, including the `has_role()` SQL function.
5. **Atlas / Brain database tables** — `atlas_*`, `brain_*` schemas are how the AI council's debates persist. Port verbatim.
6. **Zyra database tables** — `zyra_audit_log`, `zyra_conversations`, `zyra_memory`, `zyra_security_events`, etc. are the agent state foundation.
7. **WhatsApp + voice + email channel set** — 21 functions across the three channels. Multi-channel comms are largely solved here.
8. **Position report ingestion + analytics layer** — `positionReportAnalyticsLayer.ts` + the scraper + the audit table. This is core almond-trading domain logic.
9. **The widget system** — `useWidgetConfig` + `useWidgetData` + `useWidgetTracker` + the widget registry + the live editor (`AdminWidgetWorkshop`). Configuration-driven, instrumented, and editable in-app. Strong foundation.
10. **Data audit + admin tools surface** — `/data-audit`, `/admin/data-gaps`, `/admin/health`, `/admin/widget-workshop` are operational consoles that prevent the foundation gap from being invisible. Keep this discipline.

**Useful as reference (don't necessarily port):**
- The 39 page surface — shows what users actually need, but V3 should rebuild the UI fresh.
- The route table — shows the navigation surface but V3 may simplify (do you really need 15 redirects?).

---

## 17. Leave behind

- **The two Zyra pages duplication** (`/zyra` vs `/zyra-ai`) — pick one in V3.
- **The `/alma` redirect** — drop it.
- **Both bun lockfiles** — V3 picks one package manager and sticks with it. (User has accepted to use Node + npm in V3 per the briefing, so neither bun lockfile carries forward.)
- **300+ prompt-numbered comments** in pages — V3 starts clean.
- **228 migrations** — V3 starts with one consolidated initial migration that captures the desired V3 schema, not a replay of 6 weeks of trial-and-error.
- **Lovable-tagger and `.lovable/` directory** — V3 is local, so no Lovable instrumentation.
- **Anything that depends on Lovable's AI gateway** — V3 calls AI providers directly with explicit routing rules (per the briefing's master plan section 3 — "AI routing logic — explicit rules for when Claude is used vs Gemini vs OpenAI vs ElevenLabs, by capability").

---

## 18. Open questions for follow-up (before Step 3)

These are things I couldn't resolve from a static audit and that affect Step 4 (comparative) and Step 5 (master plan):

1. **Does the V1 offer flow enforce FK to `canonical_products`?** Need to grep migration files for `REFERENCES canonical_products` and check the `admin_sales_offer_items` table definition.
2. **Which Supabase secrets are actually populated in V1's project?** Determines which AI providers are live vs aspirational. Requires Supabase project access.
3. **What's the V1 Supabase project URL?** Not in the cloned `.env` (only the *Vite* publishable URL is there, which redacts the project ID — actually the project ID IS in the env: `VITE_SUPABASE_PROJECT_ID`. To audit Supabase directly we'd need that ID + anon key, which are in `.env`).
4. **Difference between `/zyra` and `/zyra-ai`** — read both pages to understand.
5. **How is V1 deployed today**, given it's not serving cropsintel.com? Is it on a Lovable preview URL? Is anyone using it?

---

## 19. Recommendation for Step 3 (V2 audit)

V2 is small enough that the audit will be far shorter. I expect:
- ~10 source files (vs V1's 1,374)
- 4 edge functions (all WhatsApp)
- A handful of pages (Welcome, CRM, Intelligence, Settings)
- Whatever the autonomous folder (`runner.js`, `email-ingestor.js`, `imap-reader.js`) actually does
- A mostly empty Supabase schema OR shared with V1's Supabase

The interesting comparative finding will not be "what V2 has that V1 doesn't" — it will be "**what V2 was supposed to have that it never built**." That's the foundation-skip story Muzammil wants V3 to break.

---

**Audit status:** Step 2 first pass complete. Ready for your review. If approved, I'll do a one-or-two-page follow-up on the open questions in section 18, then proceed to Step 3 (V2 audit).

---

## 20. Follow-up — answers to section 18 open questions

### Q1 — Does the V1 offer flow enforce FK to `canonical_products`?

**Yes, extensively.** Counter to the briefing's "foundation gap" claim. The FK relationships:

- `admin_sales_offer_items.canonical_product_id` → `canonical_products(id)` — **NOT NULL** (every offer item must reference a canonical product)
- `crm_offer_lines.canonical_product_id` → `canonical_products(id)` — **NOT NULL**
- `customer_products.canonical_product_id` → `canonical_products(id)` ON DELETE CASCADE — **NOT NULL**, with UNIQUE constraint on `(customer_id, canonical_product_id)`
- `pricing_data.canonical_product_id` → `canonical_products(id)` ON DELETE SET NULL (nullable — pricing rows can exist without product mapping)
- Plus references in `competitor_intel`, `customer_purchase_history` (via offer_id chain), and at least 4 other tables

**`canonical_products` schema:** `id`, `variety` (NOT NULL), `product_type` (default 'kernel'), `size`, `grade`, `description`, `aliases text[]`, `is_active`, timestamps. Created 2026-03-23.

**Implication:** **The foundation gap is not a V1 problem.** V1 has a real product master with proper FK relationships from offers, customer-product links, and pricing rows. The "offers without products" complaint must be coming from somewhere else:

1. **V2** — the thin live shell that lost almost all of this (most likely).
2. **Early V1 history** — anything created before the 2026-03-23 migration ran wasn't backed by canonical_products. Old offer rows from before Mar 23 may have inconsistent product references. Worth checking with `SELECT COUNT(*) FROM admin_sales_offer_items WHERE created_at < '2026-03-23'`.
3. **A specific surface in V1** that was implemented before the FK constraints were added and may have stale logic.

**This is good news for V3 design:** the data model is already correct. V3 just needs to preserve the canonical_products → offers/customer_products/pricing_data FK structure.

### Q3 — V1 Supabase project

- **Project ID:** `knicjcmgizovpsnmbwex`
- **URL:** `https://knicjcmgizovpsnmbwex.supabase.co`

This is the V1 Supabase project. The `VITE_SUPABASE_PUBLISHABLE_KEY` is also in `.env` (not reproduced here for safety, but you have it locally). With these two values you can reach V1's Supabase from any client.

### Q4 — `/zyra` vs `/zyra-ai` — what's the difference?

Two coexisting Zyra surfaces in V1:

- **`/zyra` (`pages/Zyra.tsx`, 516 lines)** — the full Zyra dashboard. Tabs-based: Intelligence / Memory / etc. Cards, badges, progress bars, tooltips. Uses `zyra-human-ai-avatar.png`. Heavy UI with intelligence types, mock insights for guests, and the polished customer-facing surface.
- **`/zyra-ai` (`pages/ZyraAI.tsx`, 149 lines)** — minimal chat-only interface. Just messages + textarea + send button. Avatar fallback (no image). Welcome message: "Hi! I'm Zyra, your AI-powered almond market analyst..."

**Read:** `/zyra` is the original full Zyra. `/zyra-ai` is a parallel simpler attempt — likely a "let's strip Zyra back to basics" experiment that didn't replace the full version. Same pattern as V2 vs V1 at the macro level: a clean-restart attempt that didn't fully land.

**For V3:** pick one Zyra surface. Probably the full `/zyra` (with the orchestration framework behind it), not the minimal chat. The minimal chat is the easy thing to build and the hard thing to evolve into a real agent.

### Q5 — V1 deployment status

**V1 is configured to BE cropsintel.com.** From `index.html`:

- `<link rel="canonical" href="https://www.cropsintel.com/" />`
- `<title>CropsIntel — AI-Powered Almond Market Intelligence by Maxons</title>`
- `<meta property="og:title" content="CropsIntel — AI-Powered Almond Market Intelligence by Maxons">`
- PWA manifest name: "Maxons Almond Analytics"
- og:image hosted on Lovable's CDN (`storage.googleapis.com/gpt-engineer-file-uploads/...`)
- twitter:site: `@lovable_dev` — Lovable's social handle, not Maxons. (Lovable's default; should probably be changed to a Maxons/CropsIntel handle.)

**Hosting:** No `vercel.json`, `netlify.toml`, `Dockerfile`, or `render.yaml` in the repo. Deployment is handled by Lovable's hosting (which routes to its own preview URL). The `public/_redirects` file is Netlify-style — Lovable may use Netlify under the hood.

**Conclusion:** V1's metadata still claims `cropsintel.com`. If V2 is what's actually serving the domain today, the DNS was repointed to V2's hosting and V1 is now reachable only via the Lovable preview URL. This means:

- **V1 is "warm" — still being built by Lovable, still configured for cropsintel.com, but not the live destination.**
- **Switching the domain back to V1 is a DNS change, not a code change.** This is operationally cheap if you ever decide V2 was a mistake.

### Q2 (deferred) — which Supabase secrets are populated

Cannot answer from a code clone alone. The set of API keys actually configured in V1's Supabase project (Anthropic, OpenAI, Gemini, ElevenLabs, Twilio, etc.) lives in Supabase's secret manager and is only visible from inside the Supabase dashboard. Marked as a follow-up item for the Supabase audit in Step 5 prep, when we plan the V3 secret-management strategy.

---

## 21. Updated takeaways from the follow-up

Three things changed in my read after the follow-up:

1. **The foundation gap claim is wrong about V1.** V1 has a real `canonical_products` table with extensive NOT NULL FK enforcement from offers, customer-product links, and pricing. The complaint must be about V2 (which lost the table entirely) or about pre-2026-03-23 data in V1 that wasn't backfilled.
2. **Two parallel Zyra surfaces in V1 mirror the V1 vs V2 macro pattern.** Inside V1 itself there's a fresh-start attempt (`/zyra-ai`) that didn't replace the full Zyra (`/zyra`). The clean-restart impulse is fractal in this codebase — fresh starts within fresh starts. **V3 strategy needs an explicit "no parallel restart" rule** otherwise V3 will sprout its own internal fresh-start.
3. **Switching cropsintel.com back to V1 is a DNS change, not a rebuild.** This means there's a fast operational fallback if you ever decide V2 was a mistake — point the domain at the Lovable preview URL for V1. You don't have to wait for V3 to give your customers the rich platform.
