# V1 vs V2 — Comparative Analysis

**Author:** Cowork — Muzammil Akhtar
**Date:** 2026-04-28
**Inputs:** `v3-step2-v1-audit.md`, `v3-step3-v2-audit.md`
**Purpose:** Tell V3 what to inherit from each version, what to skip, where V2 lost ground that must be recovered, and where V2 actually moved forward.
**Read time:** ~10 min.

---

## 0. The headline reframe

The briefing's V1/V2 framing was three-quarters wrong, and getting it right changes the V3 plan.

| Briefing said | Reality |
|---|---|
| V1 = old Lovable build, possibly stale | V1 = the rich platform with all the AI features. Still actively built by Lovable. **Not currently live.** |
| V2 = the rebuild with Atlas, Multi-Brain, /data-audit, 115 position reports | V2 = a focused rebuild that **shed** the heavy Atlas/Brain UI and orchestration framework. Got mobile UX, autonomous Node runner, 4-method login, V1 user migration, multi-AI engine. **Currently live on cropsintel.com.** Has 116 position reports (one more than V1 actually). |
| V2 has the foundation gap (offers without products) | V2 has the foundation gap. **V1 does not** — V1 has `canonical_products` with NOT NULL FKs from offers. The gap is in V2 because V2 dropped the table. |
| V2 stays alive untouched, V3 fresh from scratch | V2 is **mid-launch with two blocking issues** (AI keys leaked, login not fully verified). The "V2 stays alive untouched" assumption needs revisiting given those issues. |

**One-sentence reframe:** V3 needs to bring V1's depth (the agent OS, the canonical data foundation, the 60+ edge functions) into V2's scaffolding (the autonomous runner, the 4-method login, the migration story, the mobile UX) — without inheriting V2's security posture or V1's Lovable lock-in.

---

## 1. Side-by-side: every dimension that matters for V3

Legend: ✅ has it well, ⚠️ has it but with caveats, ❌ doesn't have it. **V3 column** = what V3 must do, derived from the two prior columns.

### 1.1 Stack & frontend foundation

| Dimension | V1 (almond-oracle) | V2 (CropsIntelV2) | V3 must |
|---|---|---|---|
| Build tool | ✅ Vite 5 | ✅ Vite 6 | Take Vite 6 + plan to upgrade in place |
| Framework | ✅ React 18.3 | ✅ React 18.3 | React 18.3+ |
| Language | ✅ TypeScript 5.8 | ❌ JSX only, no TS | Use **TypeScript** (V1's choice, V2 was a regression) |
| Styling | ✅ Tailwind 3.4 | ✅ Tailwind 3.4 | Tailwind 3.4 |
| UI primitives | ✅ shadcn/ui + Radix (~30 packages) | ❌ Hand-rolled, no Radix | Use **shadcn/ui + Radix** (V1's choice; V2's hand-rolled was a regression in accessibility/consistency) |
| Routing | ✅ React Router 6.30 + lazy loading + 3-tier RouteGuard | ⚠️ React Router 6.28 + ProtectedRoute family | React Router 6 + V1's RouteGuard pattern |
| Data fetching | ✅ `@tanstack/react-query` 5.83 | ❌ Direct Supabase calls, manual state | Use **react-query** |
| State | ✅ Zustand 4.5 | ❌ Just useState | Zustand or signals — pick one explicitly |
| Forms | ✅ react-hook-form + zod | ❌ Hand-rolled | react-hook-form + zod |
| Charts | ✅ Recharts 2.15 + Three.js (3D) | ✅ Recharts 2.15 | Recharts. Three.js only if 3D widgets are kept (questionable for trading product) |
| Package manager | ⚠️ Bun (with two lockfiles checked in) | ⚠️ npm (no lockfile in audit) | **npm** (per the briefing — Muzammil is learning Node + npm). V3 ships one lockfile. |

### 1.2 Pages & navigation surface

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| Total pages | 39 + admin subpages | 19 | Start with V2's 19, plan for V1's admin/Atlas pages to land in Phase 2/3 |
| Total routes | 69 (15 redirects from old paths) | ~20 | Keep route count low. No legacy redirects in V3 — it's day-zero. |
| Public routes | 7 (welcome, auth, install, news, market-insight, market-insights, labs) | 7 (/, welcome, login, register, reset, set-password, map) | V2's structure is cleaner; preserve it |
| Auth-required | ~16 | ~9 | V1's surface is bigger; V3 picks Phase-1 subset and grows |
| Team-only | ~10 | 2 (CRM, Trading) | Phase 2 ports V1's team surface (Operations, Atlas, AtlasBrain, MasterExecutionPlan, etc.) |
| Admin-only | ~12 | 1 (Autonomous) | Phase 2 ports V1's admin surface (Parser, Backfill, DataGaps, Health, WidgetWorkshop, etc.) |
| Mobile bottom nav | ❌ | ✅ Top 4 + "More" drawer | **Take V2's mobile pattern.** V1 doesn't have it. |
| Command palette | ✅ via shadcn `cmdk` | ✅ Custom CommandPalette | Use shadcn's cmdk (V1's pattern) |
| Guest mode | ✅ 5-min timer + overlay | ✅ 5-min timer + overlay | Keep. Same in both. |

### 1.3 Authentication

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| Provider | ✅ Supabase Auth | ✅ Supabase Auth | Supabase Auth |
| Email + password | ✅ | ✅ | Yes |
| Email OTP | ✅ (auth-email-hook, email-otp-eligibility) | ✅ | Yes |
| WhatsApp OTP | ✅ (send-whatsapp-otp, verify-whatsapp-otp) | ✅ | Yes |
| WhatsApp + password | ❌ | ✅ | **Take V2's pattern.** WhatsApp + password is V2's addition; preserve. |
| Method count | ~3 | **4** | Match V2's 4 methods. |
| V1 user migration | n/a | ✅ Bridge logic in `auth.jsx` + SetPassword page; 65 users moved | Reuse V2's bridge for porting users to V3. |
| Reset password flow | ⚠️ Standard Supabase | ✅ Custom-branded, tested | V2's flow is more polished; port. |

### 1.4 RBAC

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| Tiers | 3 (auth / team / admin) | 5 roles flattened to 3 effective tiers | Start with 3 tiers (V1's pattern). Add commodity-scoped tiers later if multi-commodity expansion needs it. |
| Route-level | ✅ `<RouteGuard requires="...">` | ✅ `<AdminRoute>`, `<TeamRoute>`, `<AuthRoute>` | V1's pattern (single component, parameterized) is cleaner. |
| DB-level | ✅ `public.has_role(auth.uid(), 'admin')` SQL function used in RLS policies | ⚠️ Less visible — needs verification by querying live Supabase | **Take V1's pattern.** Centralized role-checking SQL function is the right move. |
| App-level | ✅ `useUserRole`, `useTeamUserIds` hooks | ✅ `useAuth().profile.role` | V1's separation into multiple hooks is more flexible. |

### 1.5 Data model & Supabase schema

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| Migrations tracked? | ✅ 228 SQL files in `supabase/migrations/` | ❌ **NO migrations in repo.** Schema only in supabase.com | **Track migrations from day one.** V2's gap is the most operationally dangerous lapse in either codebase. |
| Tables | 80+ | ~17 (frontend touches; actual count in Supabase unknown) | Re-create V1's domain tables with V3-clean naming. Don't replay 228 migrations. |
| `canonical_products` foundation | ✅ Real, NOT NULL FKs from `admin_sales_offer_items`, `crm_offer_lines`, `customer_products`, pricing | ❌ **Table doesn't exist in V2.** | **Take V1's data foundation verbatim.** Products → offers/lines/customer-products dependency graph. |
| Offer hierarchy | ✅ 4 tables (`admin_sales_offers`, `_items`, `_destinations`, `_item_destinations`) | ⚠️ `crm_deals`, `crm_activities`, `crm_contacts` (different model) | V1's model is the right one for trading. V2's CRM model is generic. |
| Position reports schema | ✅ Has `position_report_audits` + likely the main `position_reports` table | ✅ Has `abc_position_reports` (different table name) + 116 records loaded | Pick V1's naming (more domain-specific). Migrate V2's 116 records into V1's schema. |
| ABC report types | ✅ Position, shipment, receipts, forecasts, acreage, almanac, nursery | ✅ Same 7 types per `abc-scraper.js` | Both cover the same surface. V3 keeps it. |
| Atlas tables | ✅ `atlas_data_quality`, `atlas_events`, `atlas_node_events`, `atlas_patterns`, `atlas_seo_log`, `atlas_user_sessions` | ❌ | Take V1's verbatim. |
| Brain orchestration tables | ✅ `brain_discussions`, `brain_node_history`, `brain_nodes`, `brain_prompts` | ❌ | Take V1's verbatim. |
| Zyra agent state tables | ✅ `zyra_audit_log`, `zyra_conversations`, `zyra_memory`, `zyra_security_events`, `zyra_user_profiles`, `zyra_rate_limits`, `zyra_dashboard_signals`, `zyra_department_tasks` (~10 tables) | ⚠️ Has `system_config` + `ai_analyses` only | Take V1's verbatim. |
| WhatsApp log tables | ✅ `whatsapp_message_log`, `whatsapp_sessions`, `whatsapp_templates` | ❌ (likely uses Supabase logs) | Take V1's. |
| RLS policies | ✅ Comprehensive, role-checked | ⚠️ Unknown without DB access | V3 ships RLS-on-everything, with policies in migration files. |

### 1.6 AI orchestration

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| Multi-AI engine | ✅ `brain-ai` edge function (server-side) — 826 lines, Claude+GPT+Gemini+consensus | ⚠️ `ai-engine.js` (client-side) — 324 lines, same pattern but **API keys in browser** | **Take V1's pattern (server-side edge function).** V2's client-side approach is the security issue. |
| AI key location | ✅ Supabase edge function secrets | ❌ **`VITE_*` env vars → shipped in JS bundle to every visitor** | All keys in Supabase secrets. Zero AI keys in client code. |
| Provider mix actually used | Heavily Gemini (24 files), some Claude (4), minimal OpenAI (2). ElevenLabs (13). | Designed for all 4 (Claude/GPT/Gemini/ElevenLabs) | V3 should have **explicit routing rules** per the briefing's master plan section 3 (Claude for nuanced architecture, Gemini for speed/coverage, OpenAI for embeddings/judging, ElevenLabs for voice). Not "all 4 available" but "use X for Y." |
| Multi-Brain consensus pattern | ✅ In `brain-ai` only — 3 debaters + judge that emits Lovable prompt | ✅ In ZyraWidget "Council Opinion" prompt + `ai-engine.js` ranAICouncil function | Pattern is right. V3 keeps it. Use only for high-stakes decisions, not every call. |
| Customer-facing chat agent | ✅ `dr-atlas` edge function — 2307 lines, intelligence capture + escalation | ⚠️ `ZyraWidget.jsx` 589 lines — direct Claude calls, less defensive | Take V1's `dr-atlas` pattern (server-side, escalating, traced). |
| Agent feedback loop | ✅ `traceInteraction → captureIntelligence → shouldEscalate → createEscalation` regex challenge detection | ⚠️ `zyra-memory.js` has session memory + topic detection but no escalation | Take V1's escalation logic verbatim. |

### 1.7 Zyra (the customer-facing agent)

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| Number of Zyra surfaces in app | ⚠️ TWO (`/zyra` 516 lines AND `/zyra-ai` 149 lines — parallel restart inside V1) | ✅ ONE (floating widget on every page) | **V3 has exactly one Zyra surface.** Codify "no parallel restarts" as an explicit rule. |
| Mounting pattern | Lazy-loaded shell component + dedicated pages | Floating widget on every page | V2's floating-on-every-page pattern is better UX. Take it. |
| Tier-aware prompts | ⚠️ Built into widget logic | ✅ Explicit `QUICK_TOPICS` per tier (guest/registered/verified/maxons) | Take V2's explicit tier-prompts pattern. |
| Voice (ElevenLabs) | ✅ 4 elevenlabs-* edge functions, `useVoice` hook | ✅ `textToSpeech` in `ai-engine.js` | Server-side voice (V1's pattern). |
| Orchestration framework backing it | ✅ 26 lib modules: action guard, audit logger, CRM operator, capability builder, conversation tracer, data boundary, intelligence layer, learning registry, memory engine, navigation intelligence, operator core, personality engine, proactive alerts, prompt defense, quality tracker, RBAC, rate limiter, security layer, session guard, supabase tables, trade parity | ❌ Just `zyra-memory.js` | **Take V1's 26-module set.** Single largest ported asset. Consider what subset V3 needs in Phase 1 vs Phase 2. |
| Personality engine | ✅ `zyraPersonalityEngine.ts` | ❌ | Take V1's. |
| Prompt defense (against jailbreak) | ✅ `zyraPromptDefense.ts` + `zyraInputSanitizer.ts` | ❌ | Take V1's. |
| Rate limiting | ✅ `zyraRateLimiter.ts` + `zyra_rate_limits` table | ❌ | Take V1's. |
| Audit logging | ✅ `zyraAuditLogger.ts` + `zyra_audit_log` table | ❌ | Take V1's. |
| Trade parity (margin/info wall enforcement) | ✅ `zyraTradeParity.ts` | ❌ | **Take V1's.** This is the information-walls business model from the vision memory. |

### 1.8 Atlas (self-development / agent orchestration UI)

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| Atlas page (general) | ✅ `/atlas` | ❌ | Phase 2 |
| AtlasPD page | ✅ `/atlas-pd` (project development) | ❌ | Phase 2 |
| AtlasBrain page (Multi-Brain UI) | ✅ `/atlas-brain` | ❌ | Phase 2 |
| MasterExecutionPlan | ✅ `/atlas-plan` (admin only) | ❌ | Phase 2 |
| DataAudit | ✅ `/data-audit` (team) — 6 sections | ❌ | Phase 1 (data integrity is foundational) |
| Drug-Atlas client SDK | ✅ `lib/drAtlas.ts` | ❌ | Phase 1 (client SDK for the dr-atlas edge function) |
| Project Map / progress tracker | ❌ | ✅ `/map` reads `progress.json` | **Take V2's pattern.** Public progress tracker is a smart transparency move. |

### 1.9 Edge functions (Supabase)

| Domain | V1 count | V2 count | V3 plan |
|---|---|---|---|
| AI orchestration | 11 (brain-ai, dr-atlas, ai-operations, zyra-claude, zyra-intelligence, zyra-analyze-usage, dashboard-zyra, voice-assistant, monitor-engine, pd-ai-review, sales-ai-coach, feedback-chat) | 0 (in `ai-engine.js` client-side) | Port V1's set verbatim. |
| WhatsApp | 12 | 4 | Port V1's set; verify whether V2's 4 functions are different/incompatible. |
| ElevenLabs | 4 | 0 | Port V1's set. |
| Email | 6 | 0 (in Node runner) | Mix: hot path (transactional) → edge functions like V1. Ingestion (IMAP polling) → V2's Node runner pattern. |
| Account/team | 7 | 0 | Port V1's set. |
| Scrapers / data ingestion | 12 (server-side edge functions) | 6 (in Node runner) | Mix: scheduled scrapers → either (decide based on hosting). Real-time → edge functions. |
| Reports/analytics | 5 | 0 | Port V1's. |
| **Total** | **66** | **4** | V3 plans for ~50 functions, prioritized by phase. |

### 1.10 Autonomous backend

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| Autonomous runner | ❌ Edge functions only (require external trigger) | ✅ `runner.js v5.0.0` Node process with `node-cron` | **Take V2's pattern.** This is V2's most distinctive contribution — closest to the "Adela" runtime orchestrator the vision describes. |
| Hosting of runner | n/a | ⚠️ **Unknown — possibly Muzammil's Mac (sleeps when Mac sleeps)** | V3 hosts the runner on a real Linux VPS or Supabase Scheduled Functions or Railway/Render. Open question to resolve before Phase 1 ships. |
| Scrapers in repo | ❌ Edge functions only | ✅ 6 scrapers (ABC, Strata, Bountiful, news, shipments, receipts) | Port V2's scrapers verbatim; refactor inputs to TypeScript. |
| Email ingestion (IMAP) | ❌ | ✅ `imap-reader.js`, `email-ingestor.js` | Port V2's. |
| AI analyst processor | ❌ | ✅ `processors/ai-analyst.js` (template fallback when no API key) | Port V2's. |

### 1.11 Internationalization

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| i18n framework | ✅ i18next + react-i18next + browser language detector | ❌ English only | Take V1's. The vision's index.html boast says "29 languages." V3 must keep i18n in scope. |

### 1.12 PWA / mobile

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| PWA | ✅ `vite-plugin-pwa` 0.21 + manifest + workbox | ❌ | **Take V1's PWA setup.** Traders on phones is core to the product. |
| iOS WebView app | ✅ exists in project folder (`CropsIntel-iOS`) and on TestFlight pointed to V2 | n/a | Keep iOS WebView pointing at V3 once live. |
| Mobile bottom nav | ❌ | ✅ | Take V2's. |

### 1.13 Testing

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| E2E | ✅ Playwright 1.58 + e2e folder | ❌ | Ship V3 with Playwright e2e for the critical flows from day one. |
| Unit | ✅ Vitest 3.2 + Testing Library + jsdom | ❌ | Vitest. |
| Verification scripts | ✅ `scripts/verify_dashboard.mjs`, `check:extract-usage`, `check:no-divide-millions` | ❌ | Pattern is good (custom check scripts as npm scripts). Take it. |

### 1.14 Security posture

| Dimension | V1 | V2 | V3 must |
|---|---|---|---|
| AI keys location | ✅ Supabase edge function secrets (server-side) | ❌ **`VITE_*` env vars → leaked in production bundle** | Server-side only. Zero secrets in client code. Zero `VITE_*KEY` env vars. |
| Source maps | ⚠️ Don't know — check Lovable build | ❌ Source maps in production (`/dist/assets/*.js.map`) | Don't ship source maps to production. |
| GitHub PAT in git config | n/a (clone fresh) | ❌ Embedded in remote URL | Use SSH or `gh` CLI for auth. Never embed PAT in remote URL. |
| RLS policies | ✅ Visible in migration files | ⚠️ Unknown without DB access | Every table ships with RLS-on + role-based policies in migration files. |
| Service role key exposure | ✅ Edge functions only | ⚠️ In Node runner's `.env` (server-side, fine if runner is properly hosted) | Service role key only in edge functions and server-side runner. Never in browser. |

### 1.15 Live status

| Dimension | V1 | V2 | V3 |
|---|---|---|---|
| Live on cropsintel.com? | ❌ Not currently — DNS points to V2 | ✅ Live as of 2026-04-22 (DNS cutover done) | Phase 1 launch — TBD timeline |
| Lovable bot still pushing? | ✅ Yes, last commit Apr 24 | n/a | n/a |
| Active blocking issues | None known | ⚠️ AI key leak (S1), `whatsapp-login` not deployed (S2), login flows not E2E verified (S2) | n/a |
| iOS TestFlight target | n/a | V2 | Switch to V3 in Phase 1 |
| Migration story to V3 | DNS-switchable from Lovable preview URL | 65 users + bridge logic in `auth.jsx` | Reuse V2's bridge for porting V2 users to V3. Plan a separate migration for any V1-only users. |

---

## 2. Where V2 is genuinely better than V1

There are real things V2 got right that V1 didn't, and V3 should preserve them rather than reverting:

1. **Mobile bottom-nav UX** — top 4 items + "More" drawer. V1's nav is desktop-first.
2. **4-method authentication** (WhatsApp+Pass, WhatsApp OTP, Email+Pass, Email OTP). V1 has 3.
3. **Polished password reset flow** — branded Supabase emails, tested end-to-end.
4. **V1 → V2 user migration logic in `auth.jsx`** — bridge that detects V1 users and gives them a SetPassword flow. 65 users already moved. V3 should reuse this exact pattern for V2 → V3.
5. **Public progress tracker at `/map`** reading `progress.json` — transparency move that V1 lacks.
6. **Autonomous Node runner** — `runner.js` with cron + scrapers + email ingestion + AI analyst. V1 only has edge functions, which require external triggers. V2's runner is closer to "Adela" than anything in V1.
7. **Tier-aware Zyra quick prompts** explicitly per role (`QUICK_TOPICS.guest/registered/verified/maxons`). V1's Zyra has tier awareness but doesn't surface it as quick-action chips.
8. **Conventional commits** (`feat:`, `fix:`, `chore:`) — V2's git history is readable. V1's commits are mostly Lovable bot autogenerated.
9. **Cleaner repo structure** — fewer side folders, no lockfile duplication.

---

## 3. Where V1 lost when V2 was built (regressions to recover)

These are things V2 dropped that V3 must bring back:

1. **TypeScript** — entire codebase regressed to JSX-only.
2. **shadcn/ui + Radix UI** — replaced with hand-rolled components. Accessibility regression.
3. **`canonical_products` table and FK enforcement** — the foundation gap.
4. **228 → 0 supabase migrations** — schema is no longer version-controlled.
5. **66 → 4 edge functions** — moved AI to client (security regression) and most functionality to Node runner.
6. **26-module Zyra orchestration framework** → reduced to `zyra-memory.js` + `ai-engine.js` (~3 files). 90% of Zyra's defensive infrastructure (rate limiting, prompt defense, RBAC, audit, security) is gone.
7. **Atlas pages** (Atlas, AtlasPD, AtlasBrain, MasterExecutionPlan, DataAudit) — all dropped.
8. **Multi-Brain edge function** (`brain-ai` server-side) → replaced with `ai-engine.js` client-side.
9. **dr-atlas customer agent** (with intelligence capture + escalation) → replaced with simpler ZyraWidget that calls Claude directly.
10. **i18n** — 29 languages → English only.
11. **PWA support** — dropped.
12. **Three.js / 3D widgets** — dropped (debatable whether to recover).
13. **Playwright + Vitest test infrastructure** — dropped.
14. **React Query** — dropped (manual state management instead).
15. **react-hook-form + zod validation** — dropped.
16. **react-grid-layout dashboard widget grid** — dropped.
17. **All admin pages except `/autonomous`** — Parser, Backfill, DataGaps, Health, WidgetWorkshop, Insights, AuditPage, etc. all dropped.
18. **Credit wallet system** — V1 has `credit_earning_rules`, `credit_transactions`, `credit_wallets`. V2 doesn't.
19. **Inquiry/bidding flow** — V1 has `inquiries`, `inquiry_requests`, `inquiry_stages`, `bids`. V2 has `crm_deals` only.
20. **Customer-port mapping, customer-purchase-history** — V1 has these for relationship intelligence. V2 doesn't.
21. **`brain_*` tables** — Multi-Brain debate persistence. V2 doesn't have it.
22. **`atlas_*` tables** (events, patterns, data quality, sessions). V2 doesn't have them.

---

## 4. Where both V1 and V2 share the same problem

These are shared anti-patterns that V3 must explicitly break:

1. **Parallel-restart pattern.** V1 has `/zyra` AND `/zyra-ai` (the same kind of fresh-start-within-fresh-start V2 was at the macro level). V3 must adopt an explicit anti-restart rule: when something is broken, fix it in place; do not start a parallel implementation next to it.
2. **Two coexisting AI engine implementations.** V1's brain-ai is server-side; V2's ai-engine is client-side. Both implement the same Multi-AI consensus pattern but neither references the other. V3 must have **one** canonical AI orchestration layer.
3. **Lovable lock-in residue.** V1 has `.lovable/`, `lovable-tagger`, og:image hosted on Lovable's CDN, `twitter:site: @lovable_dev`. V2 has cleaner separation but its progress.json lives in `public/` (loadable by anyone). V3 should be Lovable-free *and* not bake operational state into public assets.
4. **Schema drift from migrations.** V1 has 228 migrations spanning 6 weeks (5/day) — schema is moving fast and not stable. V2 has zero migrations — schema isn't tracked at all. V3 should consolidate to a smaller stable initial migration set with clearer change discipline.
5. **AI provider mix is implicit.** Both apps use Claude + GPT + Gemini + ElevenLabs but neither has explicit routing rules. V1 leans Gemini-heavy by default; V2 leans Claude-heavy. V3's master plan section 3 must specify "Claude for X, Gemini for Y, OpenAI for Z" rules.
6. **No tests with intent.** V1 has Playwright + Vitest infrastructure but I haven't verified test coverage. V2 has nothing. V3 should ship Phase 1 with at least: 1 e2e flow per route guard tier (auth/team/admin) + unit tests for the canonical product matcher, RLS policies, and the AI engine.
7. **Embedded credentials in git.** V2 has the GitHub PAT in remote URL. V1 has a Lovable og:image URL with a presigned signature that includes a bot service account name. Neither is "credential exposure" at V2's level, but neither has tight credential hygiene.

---

## 5. Master decision: what V3 inherits from each, by domain

| Domain | Inherit from V1 | Inherit from V2 | Skip both | New in V3 |
|---|---|---|---|---|
| Stack (TS, Vite, React, Tailwind, shadcn, react-query, react-hook-form, zod, zustand) | TS, shadcn, react-query, react-hook-form+zod, zustand, Playwright, Vitest, react-helmet, recharts | Vite 6 version | Bun, Lovable tagger, react-grid-layout, Three.js (unless 3D widgets are kept) | Explicit AI routing rules in `lib/ai-router.ts` |
| Auth | RouteGuard 3-tier pattern, RLS via `has_role()` SQL fn | 4 login methods, V1→V3 migration bridge, polished reset flow | n/a | Single Sign-On for Maxons team if needed |
| RBAC | 3-tier (auth/team/admin) | 5-role flattening | n/a | Commodity-scoped tiers (Phase 4) |
| Data foundation | `canonical_products` + NOT NULL FKs from offer-items, customer-products, pricing | 116 ABC reports as data | V2's `crm_*` table naming | V3 consolidates to one initial migration set with deliberate seed data |
| AI orchestration | brain-ai pattern (server-side edge function), dr-atlas escalation pipeline, _shared/zyra-intelligence module | Tier-aware quick prompts, Zyra-as-floating-widget UX | V2's client-side `ai-engine.js`, V1's two Zyra surfaces | Explicit ai-router.ts with rules per provider |
| Zyra orchestration | All 26 lib/zyra* modules | Floating-widget UX | n/a | One Zyra surface, no parallel restart |
| Atlas | 4 pages + drAtlas client SDK + atlas_*, brain_* tables | n/a | n/a | Phase 2 work |
| Edge functions | All 66 conceptually; ~25 in Phase 1 | The 4 WhatsApp ones if newer | client-side AI | Explicit dependency-graph runner |
| Autonomous backend | n/a | runner.js + 6 scrapers + IMAP ingestion + AI analyst | n/a | Hosted on a real VPS, not Mac |
| i18n | i18next setup + 29-language target | n/a | English-only regression | Phase 1 ships with EN+HI+ZH; rest follows |
| PWA / mobile | Vite-plugin-pwa setup | Mobile bottom-nav | n/a | iOS TestFlight target swap |
| Tests | Playwright + Vitest infra | n/a | "no tests" | Day-1 e2e for auth + RLS + AI engine |
| Observability | All `*_log`, `*_audit` tables | progress.json public tracker pattern | n/a | OpenTelemetry traces (or similar) for the runner |
| Security | Server-side keys, edge functions | n/a | client-side AI keys (V2), source maps in prod (V2), PAT in git remote (V2) | Per-key spend caps, rotation cadence, credential audit cron |
| Domain logic | Position report parser, dataGaps, issueTracker, freight rates, destination matcher | 6 scrapers, email ingestion | n/a | Multi-commodity abstraction at the table level |

---

## 6. The five things that change in the V3 master plan because of this comparative

1. **Phase 0 is now "stop the bleeding on V2."** The AI key leak alone is more urgent than any V3 feature work. The master plan needs an explicit Phase 0 covering: rotate keys, set spend caps, move AI calls server-side, rotate the PAT, optionally DNS-rollback to V1 while V2 is patched.
2. **The "V2 stays alive untouched" rule from the briefing must be revised.** V2 cannot stay untouched — it has live-fire issues. V2 stays alive *with* the security and login fixes, OR cropsintel.com routes back to V1 until V3 is ready.
3. **The data foundation gap is a V2 problem, not a V1 problem.** V3 takes V1's canonical_products schema as the foundation. The Scope Guardian agent's first job is preventing V3 from sprouting offer/inquiry tables before products are wired.
4. **Anti-restart rule must be explicit and enforced.** V1 has `/zyra` and `/zyra-ai` (a fractal restart inside V1). V2 is a restart of V1. Without an explicit rule, V3 will sprout its own parallel restart within months. The rule: "When something is broken, fix it in place. Do not start a fresh-restart implementation next to the broken one. If a fresh restart is the only path, the master plan is updated and the old version is deleted, not parked."
5. **The autonomous runner is V2's gift to V3.** V1 has none of this. The pattern (Node + cron + supabase-admin + scrapers + AI analyst) is the closest realization of the "Adela" runtime orchestrator the vision memory describes. Take V2's runner code, port to TypeScript, host on a real VPS.

---

**Comparative status:** Step 4 complete. Ready for review. If approved, Step 5 (master plan) is the synthesis of everything from Steps 2-4 plus the briefing's vision and the existing memory. It's the single document V3 reads from.