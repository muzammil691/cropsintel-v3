# V2 Audit — `CropsIntelV2` (currently serving cropsintel.com)

**Repo:** github.com/muzammil691/CropsIntelV2 (private)
**Local path:** /Users/muzammilakhtar/Documents/Claude/Projects/CropsIntelV2
**Stack:** Vite 6 + React 18 (JSX, no TypeScript) + Tailwind 3 + Supabase 2.49 + Node-cron + IMAP + PDF parser
**Hosted on:** GitHub Pages (per V2's own progress.json m8/m9)
**DNS cutover to V2:** 2026-04-22 (six days ago)
**Last commit:** Apr 27 (`feat: add ProjectMap page at /map`)
**Author:** Cowork — Muzammil Akhtar
**Date:** 2026-04-28

---

## 0. CRITICAL SECURITY FINDING — read this before anything else

**Your AI provider API keys are shipped to every visitor's browser in the production JS bundle on cropsintel.com.**

Specifically, `src/lib/ai-engine.js` reads:
```js
apiKeys.anthropic = import.meta.env.VITE_ANTHROPIC_API_KEY
apiKeys.openai    = import.meta.env.VITE_OPENAI_API_KEY
apiKeys.gemini    = import.meta.env.VITE_GEMINI_API_KEY
apiKeys.elevenlabs = import.meta.env.VITE_ELEVENLABS_API_KEY
```

Vite inlines any environment variable starting with `VITE_` into the client bundle at build time. That bundle is on cropsintel.com. **Anyone who opens devtools, views the JS source, or downloads the source maps can extract these keys.** I confirmed the dist folder in your repo does include sourcemaps (`/dist/assets/Settings-*.js.map`, `/dist/assets/index-*.js.map`) — so the keys are extractable from production right now without even needing to deobfuscate.

The Anthropic call in `ai-engine.js` even sets `'anthropic-dangerous-direct-browser-access': 'true'` — Anthropic's SDK literally requires you to acknowledge this is dangerous before allowing the call. The flag exists because exposing the key from a browser is the canonical anti-pattern.

**Impact:** anyone (a competitor, a bot scraping your site) can pull the keys and burn your Anthropic / OpenAI / Gemini / ElevenLabs budget under your accounts. Worst case is unbounded — Anthropic and OpenAI keys with no spend cap can rack up four-figure bills in hours.

**Action items today, in priority order:**
1. **Rotate all four AI provider keys** (Anthropic console, OpenAI platform, Google AI Studio, ElevenLabs). New keys NEVER go in `VITE_*` env vars.
2. **Add per-key spend limits** in each provider's dashboard while you rotate (Anthropic: organization budgets; OpenAI: usage limits; Google: AI Studio quotas).
3. **Move all AI calls to a Supabase edge function.** Pattern: client calls `supabase.functions.invoke('ai-call', {...})`, the edge function holds the key in Supabase secrets and forwards to the provider. V1's `brain-ai` and `dr-atlas` already do this — V2 should follow the same pattern for everything.
4. **Until step 3 ships, take cropsintel.com offline OR scrub the bundle.** Even five minutes of exposure with valid keys is enough for a scraper to grab them. If V1 is your fallback (per the V1 audit's section 21 finding, you can DNS-switch back to V1), this is a moment to consider it.

**Rotate the GitHub PAT too** (still embedded in V2's git config, already flagged earlier).

This finding alone reshapes Phase 0 of the V3 master plan: **"Stop the bleeding on V2 before doing anything else."**

---

## 1. Tech stack (`package.json`)

**Production deps (12 total):**
- `react` 18.3, `react-dom` 18.3, `react-router-dom` 6.28
- `@supabase/supabase-js` 2.49
- `recharts` 2.15
- `lucide-react` 0.460
- `dotenv` 17.4
- `imapflow` 1.0 + `mailparser` 3.7 — server-side email ingestion
- `pdf-parse` 1.1 — PDF parsing for ABC reports
- `node-cron` 3.0 — autonomous runner scheduling

**Dev deps (5):** Vite 6, `@vitejs/plugin-react` 4.3, Tailwind 3.4, postcss, autoprefixer

**Notable absences vs V1:**
- **No TypeScript.** Pure JSX. (Briefing said V3 will be TS — V2 is not the migration source.)
- **No shadcn/ui / Radix UI.** All components hand-rolled with Tailwind primitives.
- **No `@tanstack/react-query`.** Direct Supabase calls + manual state management.
- **No Zustand / Redux.** Just React useState.
- **No i18n.** English-only.
- **No PWA, no Three.js, no react-grid-layout, no 3D widgets.**
- **No e2e tests, no unit tests.**
- **No Lovable instrumentation.**

**Read:** V2 was a deliberate "strip everything back" rewrite. The size reduction is intentional — but it dropped a lot of the production-grade tooling V1 had (testing, i18n, PWA, accessible UI primitives).

---

## 2. Routes — 19 pages, role-gated

**Standalone (full-page, no chrome):** `/`, `/welcome`, `/login`, `/register`, `/reset-password`, `/set-password`, `/map`

**Main app (sidebar + nav):**
- `/dashboard` — main dashboard
- `/supply` — Supply & Demand
- `/destinations` — Trade Flow
- `/pricing` — Live Pricing
- `/forecasts` — Crop Forecasts
- `/news` — News & Intelligence
- `/analysis` — Market Analysis
- `/reports` — Position Reports
- `/intelligence` — AI Intelligence
- `/crm` — CRM & Trade Pipeline (team-only)
- `/trading` — Trading Portal (team-only)
- `/autonomous` — Autonomous Systems (admin-only)
- `/settings` — Settings (any auth)
- catchall `*` → Dashboard

**RBAC:**
- 5 roles: `admin`, `analyst`, `broker`, `seller`, `buyer` (default)
- `ADMIN_ROLES = ['admin']`
- `TEAM_ROLES = ['admin', 'analyst', 'broker', 'seller']`
- Route-level guards: `<AdminRoute>`, `<TeamRoute>`, `<AuthRoute>` from `components/ProtectedRoute`
- Visibility: nav items can be filtered by `requireAdmin`, `requireAuth`, `requireTeam`

**Mobile UX:** Bottom-nav (top 4 items + "More" drawer for the rest) + sticky mobile header. V1 doesn't have this — V2 actually did better on mobile.

**Guest mode:** 5-minute timer with countdown badge in the nav. Same concept as V1's guest mode.

**Command palette:** Cmd+K via `<CommandPalette />`. Floating widget. V1 has shadcn's `cmdk` library too — both apps have command palette.

---

## 3. Pages (19 total)

**Auth & onboarding (7):** Welcome, Login, Register, ResetPassword, SetPassword, Settings, ProjectMap (the public progress tracker at `/map`)

**Market data (8):** Dashboard, Supply, Destinations, Pricing, Forecasts, News, Analysis, Reports

**Intelligence / trading (4):** Intelligence (AI chat), CRM (team), Trading (team), Autonomous (admin)

V1 has 39 pages; V2 has 19. The cut is in admin/operations (V1 has ~12 admin pages; V2 has 1: `/autonomous`) and in the Atlas/Brain orchestration UI (V1 has Atlas, AtlasPD, AtlasBrain, MasterExecutionPlan; V2 has none of these).

---

## 4. The autonomous runner — V2's distinctive asset

`src/autonomous/runner.js` is V2's most interesting piece. **It's a Node process (cron-based) that runs continuously and orchestrates the data pipeline.** Header comment:

> The brain that orchestrates all autonomous operations:
> 1. Scrape ABC data on schedule
> 2. Generate shipment data (by destination)
> 3. Generate receipt data (by variety)
> 4. Process data (YoY, trends, anomalies, trade signals)
> 5. Generate AI insights (Claude API + template fallback)
> 6. Self-monitor and log everything

Version 5.0.0. Imports six scrapers (ABC, Strata, Bountiful, news, shipments, receipts), the data processor, the AI analyst, and email ingestion (`imap-reader`, `email-ingestor`).

**What this means for V3:**
- This is **the closest thing to the "autonomous Atlas" the vision memory describes.** Adela / Atlas / Zyra naming aside, V2 has a genuine cron-driven autonomous backend.
- It's a **separate Node process from the Vite frontend.** It needs to be hosted somewhere that runs Node 24/7 — not GitHub Pages. Where is it actually running today? Probably on Muzammil's local Mac or some VPS — needs verification. **If it's on the local Mac, it stops every time the Mac sleeps, which means the "autonomous" claim is conditional on Mac uptime.**

**Scrapers (6 in `src/scrapers/`):**
- `abc-scraper.js` — almonds.org (URL updated 2026-04-21 to `/tools-and-resources/crop-reports/`). Handles position reports, shipment reports, crop receipt reports, subjective forecasts, objective forecasts, USDA-NASS acreage, almond almanac, nursery reports.
- `strata-scraper.js` — StrataMarkets pricing (uses `STRATA_USERNAME`/`PASSWORD` from `.env`)
- `bountiful-scraper.js`, `news-scraper.js`, `receipts-parser.js`, `shipment-parser.js`

**Email ingestion (in `src/autonomous/`):**
- `imap-reader.js` polls an inbox for industry intel emails
- `email-ingestor.js` processes them
- Configured via `INTEL_EMAIL`, `INTEL_EMAIL_PASSWORD`, `INTEL_IMAP_HOST`, `INTEL_IMAP_PORT`, `INTEL_SMTP_HOST`, `INTEL_SMTP_PORT` env vars

**Worth porting to V3:** the runner pattern (cron + supabase-admin) is solid. The scrapers themselves are domain logic that took real effort — they should carry forward. Email ingestion is also a real asset.

---

## 5. AI engine — V2 has a Multi-AI engine too (different from V1's brain-ai)

`src/lib/ai-engine.js` (324 lines). Header:

> Multi-AI Intelligence Engine — 4 AI systems working together for trading intelligence
> 1. Claude (Anthropic) — Primary brain: deep reasoning, document analysis, tool-use
> 2. GPT (OpenAI) — Fast factual checks, alternative perspectives
> 3. Gemini (Google) — Third perspective for consensus, creative analysis
> 4. ElevenLabs — Voice synthesis (TTS) + transcription (STT)
> + AI Council — Multi-model consensus for high-stakes trade decisions

**This contradicts my V1 audit's framing that brain-ai is the only Multi-Brain pattern.** V2 also has it. Differences:

- V1's `brain-ai` is a 826-line Supabase edge function. Server-side. AI keys in Supabase secrets.
- V2's `ai-engine.js` is a 324-line client-side JS module. **AI keys in the browser bundle (the security issue above).**
- Both implement the same pattern (Claude + GPT + Gemini → consensus) — but only V1 does it safely.

**Same idea, two implementations, one of them dangerous.** V3 should keep V1's pattern (server-side edge function) and not V2's (client-side direct call).

V2 also has a `system_config` table for storing AI keys at runtime — `loadAPIKeys()` first tries to fetch from Supabase, then falls back to the VITE env vars. So you tried to do the right thing first. The issue is the fallback path that ships keys to the browser if the system_config row isn't populated.

---

## 6. Zyra in V2 — `ZyraWidget.jsx` (589 lines)

**V2's Zyra is a single floating widget** that mounts on every page. Highlights from the read:

- Imports `askClaude`, `loadAPIKeys`, `textToSpeech` from `ai-engine`
- Has session memory via `lib/zyra-memory.js`: `generateSessionId`, `logConversation`, `logError`, `trackQuestionPattern`, `detectTopics`, `detectConversationSentiment`, `getFullLearningContext`, `categorizeQuery`
- Has tier-aware quick prompts (`QUICK_TOPICS`):
  - `guest` → 3 prompts (Market Overview, Why CropsIntel, Top Varieties)
  - `registered` → 4 prompts (Market Outlook, Buy or Wait, India Demand, EU Market)
  - `verified` → 5 prompts (My Market Brief, Price Forecast, Risk Analysis, Shipping Routes, Competitor Intel)
  - `maxons` → 6 prompts (Trading Strategy, CRM Priorities, Margin Analysis, Supply Position, **Council Opinion**, Weekly Digest)
- "Council Opinion" prompt: "Convene the AI Council for a consensus view on the almond market direction for the next quarter. I need a high-confidence assessment." — so the AI Council pattern IS user-callable in V2.

**Compared to V1's Zyra (the 26-module orchestration framework):**
- V1: 26 lib files implementing audit, RBAC, security, rate limiting, learning registry, etc. Production-grade agent OS.
- V2: 1 widget + 1 ai-engine + 1 zyra-memory file. ~3 files vs V1's 26.

**V2's Zyra is roughly 10% of V1's Zyra.** The naming and concept are preserved; the depth isn't.

---

## 7. Library code (`src/lib/` — 12 files)

- `ai-engine.js` — multi-AI orchestrator (described above)
- `auth.jsx` — V2's auth context with guest timer, V1 user migration support, 4-method login bridge
- `intel-processor.js` — knowledge processing (used by ZyraWidget for `getLatestInsights`, `getKnowledgeStats`)
- `notifications.js` — notification helpers
- `seed-ai-analyses.js`, `seed-crm.js`, `seed-strata.js` — seed scripts (one-time data loads)
- `supabase.js`, `supabase-admin.js` — client + admin clients
- `utils.js` — utility helpers
- `whatsapp.js` — WhatsApp client wrapper
- `zyra-memory.js` — session memory + learning context

**No drAtlas equivalent.** V2 dropped Atlas concept entirely.
**No zyraOrchestration / RBAC / SecurityLayer / RateLimiter modules.** V2 dropped V1's defensive agent infrastructure.

---

## 8. Supabase — V2 has a separate project from V1

**V2 Supabase project ID:** `<from VITE_SUPABASE_URL — different host from V1>`. V1 was `knicjcmgizovpsnmbwex.supabase.co`. **V2 is a separate Supabase project.**

**Tables V2's frontend touches (17, by `.from()` greps):**
- ABC data: `abc_acreage_reports`, `abc_almanac`, `abc_forecasts`, `abc_position_reports`
- AI: `ai_analyses`
- CRM: `crm_activities`, `crm_contacts`, `crm_deals` (note: V1 calls these `zyra_crm_*`)
- Email: `email_inbox`, `email_subscriptions`
- Intel: `industry_news`, `market_data`, `strata_prices`
- System: `pipeline_runs`, `scraping_logs`, `system_config`, `user_profiles`

**No migrations folder.** V2's `supabase/migrations/` is empty. **The schema only exists in supabase.com — not version-controlled, not reproducible.** This is a serious gap. If V2's Supabase project gets corrupted or re-created, the schema is lost. **V3 must track migrations.**

**No `canonical_products` table in V2.** Confirmed: the product foundation V1 has is absent in V2. CRM uses `crm_contacts`/`crm_deals`/`crm_activities` directly without a product master. **This is the foundation gap the briefing called out — and it is real, in V2.**

---

## 9. Edge functions — only 4, all WhatsApp

`supabase/functions/`: `whatsapp-login`, `whatsapp-send`, `whatsapp-verify`, `whatsapp-webhook`.

V1 has 66 edge functions. V2 has 4. Everything else V2 needs (AI, scraping, processing) runs in:
- The browser (the AI engine, with its security issue)
- The Node runner (scrapers, autonomous cycle)

**Per V2's own progress.json m6:** `whatsapp-login` is **not yet deployed to Supabase** — it's tracked as a pending todo with high priority. **So V2's WhatsApp login may not actually work in production right now.** Worth verifying.

---

## 10. V2's self-tracked progress (`public/progress.json`)

V2 publishes a live progress tracker at `/map` (the ProjectMap page) reading from `public/progress.json`. Last updated 2026-04-22. Highlights:

- **Overall: 94% complete, target 97%**
- **18 pages live** (matches what I counted, modulo ProjectMap which was added Apr 27)
- **116 ABC position reports** (more than V1's 115 — V2 backfilled one more)
- **9 crop years** of data (2016/17 → 2025/26)
- **65 V1 users migrated** to V2 Supabase
- **4-method login system implemented** (WhatsApp+Pass, WhatsApp OTP, Email+Pass, Email OTP)
- **iOS TestFlight pointed to V2** (the iOS WebView app I saw in the project folder)
- **DNS cutover to V2 done 2026-04-22**

**Phases (V2's own framing):**
1. Data Foundation (done 2026-03-15) — 116 reports, 9 crop years, PDF scraping, integrity audit
2. Stabilization (done 2026-03-28) — auth rebuilt, 30+ fixes, widgets stable
3. AI Systems (done 2026-04-08) — Claude unified, Zyra widget, ElevenLabs voice, 4 edge functions
4. CRM + Soft Launch Gate (done 2026-04-19) — 6-tab CRM, audit fixes, AI enhancements, perf 30s→2-3s
5. V2 Autonomous Rebuild (active, 95%) — 18 pages, code splitting, 65 users migrated, login, DNS
6. V2 Go-Live + Growth (active, 55%) — cropsintel.com live, edge function deploy pending, V1 user extraction pending

**Pending high-priority items per progress.json:**
- m6: Deploy `whatsapp-login` edge function (todo, high priority)
- m10: Verify admin login on cropsintel.com (todo, high)
- m11: Verify WhatsApp OTP login end-to-end (todo, high)
- m16: Extract V1 user data and ingest into V2 (todo, high)
- m12, m14, m15, m13: medium/low

**Read:** V2 is mid-launch. DNS is live but login is not fully verified. **There is a real possibility that some of your live customers cannot log in to V2 right now.** The progress.json acknowledges this with action items but they're marked as todo, not done.

---

## 11. .env — what's exposed

**Frontend (Vite, ships to browser):**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — fine, anon key is meant to be public
- `VITE_ANTHROPIC_API_KEY` — **CRITICAL leak (section 0)**
- `VITE_OPENAI_API_KEY` — **CRITICAL leak**
- `VITE_GEMINI_API_KEY` — **CRITICAL leak**
- `VITE_ELEVENLABS_API_KEY` — **CRITICAL leak**

**Server-side (in the Node runner only, not in browser):**
- `SUPABASE_SERVICE_ROLE_KEY` — service role for autonomous runner. Local-only, fine.
- `SUPABASE_DB_PASSWORD` — direct DB access. Local-only, fine.
- `STRATA_USERNAME`, `STRATA_PASSWORD`, `STRATA_BASE_URL` — pricing scraper auth
- `MAXONS_MARGIN_PERCENT` — Maxons margin baked into env. Reasonable.
- `INTEL_EMAIL`, `INTEL_EMAIL_PASSWORD`, `INTEL_IMAP_HOST`/`PORT`, `INTEL_SMTP_HOST`/`PORT` — email ingestion creds

**Read:** server-side env vars are fine. Frontend env vars are the catastrophe.

---

## 12. What works in V2

- Auth (4 login methods), user migration from V1 (65 users moved)
- 19-page React app with role-gated routes and mobile bottom-nav
- Autonomous Node runner with 6 scrapers + email ingestion + AI analyst
- 116 ABC position reports backfilled (one more than V1)
- Multi-AI engine (Claude/GPT/Gemini/ElevenLabs) — concept-correct, implementation-dangerous
- Zyra floating widget on every page with tier-aware quick prompts
- Public progress tracker at `/map`
- iOS TestFlight pointing to V2

---

## 13. What's broken or stale in V2

**Severity 1 — fix today:**
- **AI keys exposed in client bundle.** Section 0.
- **GitHub PAT leaked in git remote URL.** Already flagged.

**Severity 2 — fix this week:**
- **No supabase migrations.** Schema lives only in supabase.com. Fragile.
- **`whatsapp-login` edge function not deployed** (per progress.json m6). Some users may not be able to log in.
- **Login flows not end-to-end verified post-DNS-cutover** (m10, m11, m12). 65 migrated users may have access issues.
- **`canonical_products` doesn't exist in V2.** Foundation gap is real here, not in V1.
- **Source maps shipped to production** (`/dist/assets/*.js.map`). Reveals the codebase to any visitor with devtools.
- **Autonomous runner location unverified.** If it's running on Muzammil's Mac, it stops when the Mac sleeps. Need to know where it actually runs.

**Severity 3 — known issues:**
- No tests (no Playwright, no Vitest)
- No TypeScript (everything is JSX with no static type safety)
- No i18n (V1 has 29 languages; V2 is English-only)
- Hand-rolled UI components instead of shadcn/Radix (lots of styling drift, accessibility gaps likely)
- "AUTONOMOUS V2" tagged in the sidebar but the autonomous runner depends on a Mac being on
- V1 app does not redirect to V2 (m14) — users on the Lovable preview URL see V1 still

---

## 14. Worth porting to V3 (concepts, not necessarily code)

**Definitely port:**
1. **The autonomous runner pattern** (cron + supabase-admin + scrapers + processors). This is the closest thing to Adela that exists today. V3 needs this.
2. **The 6 scrapers** (ABC, Strata, Bountiful, news, shipments, receipts). Real domain work.
3. **The email ingestion pipeline** (IMAP polling + parsing + supabase ingestion). Useful.
4. **The 4-method login system** (WhatsApp+Pass, WhatsApp OTP, Email+Pass, Email OTP). Good UX, important for traders on phones.
5. **V1 user migration logic** (the auth.jsx bridge that detects V1 users and gives them a SetPassword flow). 65 users already migrated this way — reuse the pattern in V3.
6. **The `/map` ProjectMap page concept.** Public progress tracker is a nice transparency move. Worth keeping.
7. **The mobile bottom-nav UX** — better than V1's mobile experience.
8. **The 116 ABC reports.** The data itself, not the schema. Migrate to V3's product-foundation-correct schema.
9. **The tier-aware Zyra prompts** (guest / registered / verified / maxons quick prompts). Concept is right; needs to be re-grounded on V3's data and proper agent infrastructure.

**Don't port:**
- The client-side AI engine pattern (security issue). Use V1's edge-function pattern instead.
- The hand-rolled UI components. Use shadcn/Radix in V3 (V1's choice).
- The lack of TypeScript. V3 is TS per the briefing.
- The lack of migrations. V3 must track schema in version control.
- The lack of tests. V3 should ship with at least Playwright e2e from day one.

---

## 15. Open questions for follow-up

1. **Where does V2's autonomous runner actually run?** Is it on Muzammil's Mac (sleeps when Mac sleeps), a VPS, or Supabase scheduled functions? Determines whether "autonomous" is real or aspirational.
2. **Are the 65 migrated users currently able to log in?** Pending m10/m11/m12 verification.
3. **Has anyone actually used the AI keys from the bundle yet?** Check Anthropic / OpenAI / Gemini billing dashboards for unusual spend in the last 6 days (since DNS cutover). If yes, there's already a real cost incident.
4. **What's V2's Supabase project URL?** I redacted from .env in this audit — provide directly so I can audit the schema state vs what the migrations would have created.

---

## 16. Headline summary

V2 is **smaller-scope but real**. It's not the "thin live shell" I called it in the V1 audit's section 21 — that framing was wrong. V2 is a focused rebuild that intentionally shed V1's heavy intelligence UI and orchestration framework in exchange for: a 4-method auth system, an autonomous Node runner, a simpler React surface, mobile-first UX, and a published progress tracker.

What V2 lost vs V1: the 26-module Zyra orchestration framework, 60+ edge functions (especially Atlas / brain-ai server-side), the canonical_products foundation, 39 → 19 pages, TypeScript, i18n, PWA, tests, accessible UI primitives, e2e infrastructure, **and safe AI key handling**.

What V2 gained vs V1: an autonomous Node runner, a 4-method login, V1 user migration, mobile bottom-nav, **and a critical AI key leak**.

**The honest one-line summary for the V3 master plan:** V2 is mid-launch with two blocking issues — keys leaked, login not fully verified — and a strategic question: keep going with V2 while V3 builds (and accept the security/login risk), or DNS-rollback to V1 (and accept the missing-V2-features risk) until V3 is ready.

---

**Audit status:** Step 3 complete. Ready for your review. If approved, Step 4 (V1 vs V2 comparative analysis) is a synthesis of these two audits — much shorter, focuses on what V3 inherits from each version.