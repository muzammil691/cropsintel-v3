# Claude Code Build Prompt — CropsIntel V3 Quality-Gate Fix + V1→V3 Port

**For:** Claude Code running in VS Code on Muzammil's Mac
**Repo:** `~/Documents/Claude/Projects/cropsintel-v3` (origin: `github.com/muzammil691/cropsintel-v3`)
**Mode:** autonomous, with stop-on-fork behavior described in §0
**Estimated wall-clock:** ~20 hours of Builder time across 4 work-packages, executed sequentially with verification gates between each

---

## 0. Preamble — read these files first, in this order, before any code

You are picking up an in-flight project that already has a working seven-service production house on Railway. **Do not rebuild what exists.** Your job is to fix four broken quality gates and then port four V1 capabilities into V3, in dependency order.

```
Read order:
1. .agent/master-plan.md                                # canonical project plan v1.5
2. .agent/specs/atlas-master-spec.md                    # Atlas blueprint
3. V3-CODING-INSTRUCTIONS.md                            # the five immutable rules
4. AUTONOMOUS_BUILD_WORKFLOW_FIX_PLAN.md                # the seven gate bugs (you are fixing these in WP-0)
5. HANDOFF.md                                           # full context handoff
6. docs/SCOPE.md                                        # in/out of scope
7. ~/Documents/Claude/Projects/Cropsintel/SECRETS.md    # all credentials
```

If `master-plan.md` is missing in the repo, fetch it from `~/Documents/Claude/Projects/Cropsintel/cropsintel-v3-master-plan.md` and copy into `.agent/master-plan.md`.

### The five immutable rules — never violate without a question file

1. **Foundation-first.** Every domain table extends the 12-table foundation in `supabase/migrations/20260428000001_v3_foundation.sql`. If you need a new entity, write a new migration first; do not store domain data in JSON columns to skip the schema.
2. **Anti-restart.** Fix in place. Never create `<file>-2.tsx` or `<file>-new.tsx`. If a clean restart is genuinely the only path, write a question file under `.agent/questions/` and stop.
3. **Multi-commodity from Day 1.** Every domain row carries `commodity_id` UUID FK to `commodities`. Hard-code zero almond-only logic. Walnut and pistachio are configuration.
4. **AI keys are server-side only.** Zero `VITE_ANTHROPIC_*`, `VITE_OPENAI_*`, `VITE_GOOGLE_*` env vars. Every AI call routes through a Supabase edge function or a Railway service that holds the key in secrets.
5. **Information walls are load-bearing.** Customers see only their own pricing. Brokers see margin targets but not other brokers' deals. Suppliers see demand but not buyer identity. RLS at the DB layer; respect at the app layer.

### Work discipline

- **Commit on every section.** Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Tag the master-plan section: `feat: WP-1.3 — WhatsApp OTP login (master plan §1.3)`.
- **Push to GitHub on every successful section.** This triggers the Railway services to pull and re-verify.
- **Never commit a build that fails `npm run build`.** Run it before every commit.
- **Stop and ask if you hit an architectural fork.** Write `.agent/questions/<YYYY-MM-DD>-<topic>.md` with one multi-choice question (no open-ended). Do not proceed without an answer.
- **Use TodoWrite to track multi-step tasks.** I should be able to see your progress live.

### The four work-packages, in strict order

```
WP-0  Quality-gate fix (~90 min)         → unblocks everything
WP-1  Auth + 3-tier RBAC + V2 bridge     (~4-5 hr)
WP-2  Adela data spine                   (~6-8 hr)
WP-3  CRM + Inquiry/Offer flow           (~8-10 hr)
```

Do not start WP-N before WP-(N-1)'s acceptance criteria are all green. Between work-packages, post a one-line summary to the user (via `/atlas/chat` if Atlas is in `chat` or `auto` mode, or via WhatsApp via the same number).

---

## WP-0 — Quality-gate fix (autonomous)

**Source:** `AUTONOMOUS_BUILD_WORKFLOW_FIX_PLAN.md` §4. Bundle the 7 fixes into ONE spec named `phase-1.10af-workflow-quality-gates-fix.md` placed in `.agent/tasks/queued/`. Builder will pick it up.

### Spec sections (each must be addressed)

**§1 Atlas trust-mode persistence (Bug D)**
- Inspect `atlas/src/lib/trust-mode.ts` — confirm `loadTrustModeFromDb` reads `atlas_config` table.
- If `atlas_config` table is missing in Supabase, write a migration that creates it: `(key text PRIMARY KEY, value jsonb, updated_at timestamptz default now())`.
- `setMode(mode, setBy)` must do an UPSERT into `atlas_config` (`ON CONFLICT (key) DO UPDATE`). Surface insert errors instead of silently no-op.
- On boot, `loadTrustModeFromDb` reads from `atlas_config`; falls back to `ATLAS_TRUST_MODE` env var only if row absent. Logs which path it took.
- Test: flip mode to `chat` via `POST /atlas/mode`, force a Railway redeploy, hit `GET /atlas/mode` — must still be `chat`.

**§2 Designer `designer_runs` migration (Bug B)**
- Write `supabase/migrations/<timestamp>_designer_runs.sql` creating the table per spec 1.10n's schema (look in `.agent/specs/` or in the designer service for the expected columns; if not present, use this skeleton: `id uuid pk default gen_random_uuid(), task_id text, head_after text, verdict text, confidence numeric, claude_review jsonb, gpt_review jsonb, audited_at timestamptz default now()`).
- Update Builder's loop to run `npx supabase db push --project-ref hzrnohsxigrqlmzegwlb` before each verifier+designer audit cycle if any pending migrations exist.

**§3 Designer git fetch-before-audit (Bug C)**
- In `designer/src/server.ts`, the `/designer/audit-commit` handler must `git fetch origin` then `git checkout <head_after>` (or `git reset --hard <head_after>`) inside its workspace clone before computing the diff.
- Wrap the git ops in a per-request mutex so two concurrent audits don't fight over the workspace.

**§4 Verifier disable boot retro-audit (Bug G)**
- In `verifier/src/index.ts` (or wherever the boot sequence runs), gate `audit-all` behind `VERIFIER_RETRO_AUDIT_ON_BOOT=false`. Default off.
- On-demand `/audit` endpoint must work immediately on boot — no blocking on retro-audit.

**§5 Atlas git mutex (Bugs E + F)**
- File `atlas/src/lib/git-mutex.ts` already exists. Audit it: every `git fetch`, `git reset`, `git checkout`, `git log`, `git diff` in `atlas/src/lib/tools.ts` and `atlas/src/cron/*.ts` must be wrapped via this mutex.
- Add a unit test: spawn 5 concurrent `git fetch` calls, assert they serialize and none error with `Unable to create '.git/index.lock': File exists`.

**§6 Verifier stub-detector whitelist (Bug H)**
- In `verifier/src/checks/stub-detector.ts` (or wherever the regex is), `<NotImplemented />` and `<NotImplemented[\s/]` and `placeholder phase=` are NOT stubs. Whitelist them.
- Add a unit test asserting `<NotImplemented phase="1.5" />` is reported as a legitimate placeholder, not a defect.

**§7 Verifier context loader (Bug I)**
- In `verifier/src/lib/context-loader.ts` (or equivalent), when assembling the audit prompt, prioritize loading whole files for any file ≤2,000 lines. Truncate only if total context would exceed model limit, and log which files were truncated.
- Add a unit test asserting a 1,800-line file is loaded whole, a 5,000-line file is loaded truncated with explicit log.

**§8 End-to-end verification protocol (manual, after spec ships)**
The spec must include a `RUN_AFTER_SHIP.md` in repo root that documents the 5-step manual test from `AUTONOMOUS_BUILD_WORKFLOW_FIX_PLAN.md` §5 Step C. Builder writes this file as part of the spec.

### WP-0 acceptance criteria (run after spec ships, before starting WP-1)

```bash
# All 6 services healthy (no auth needed for /health)
for s in courteous-simplicity zucchini-friendship believable-warmth just-reflection cooperative-rejoicing rare-happiness; do
  curl -s -o /dev/null -w "$s: %{http_code}\n" https://$s-production.up.railway.app/health
done
# Expect: all 200

# Designer audit returns real verdict (not 401)
curl -sX POST https://zucchini-friendship-production-392d.up.railway.app/designer/review-spec \
  -H "Authorization: Bearer cropsintel-designer-token-2026-05-01" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"test-fix","spec_markdown":"# Test"}' | jq .verdict
# Expect: "approved" or "rejected" or "warn", NOT 401

# Atlas trust mode survives redeploy
curl -sX POST https://courteous-simplicity-production.up.railway.app/atlas/mode \
  -H "Authorization: Bearer cropsintel-atlas-token-2026-04-30" \
  -H "Content-Type: application/json" -d '{"mode":"chat","setBy":"wp0-test"}'
# Trigger Railway redeploy of atlas service
sleep 90
curl -s https://courteous-simplicity-production.up.railway.app/atlas/mode | jq .mode
# Expect: "chat", NOT "passive"

# Verifier returns real verdict (not "unknown")
# Queue a 10-line spec, wait 5 min, check verifier_runs table
psql $DATABASE_URL -c "SELECT verdict FROM verifier_runs ORDER BY created_at DESC LIMIT 1;"
# Expect: 'pass' or 'fail', NOT 'unknown'

# No git lock errors in Atlas logs in last 30 min
# Inspect atlas logs on Railway dashboard
# Expect: zero "Unable to create '.git/index.lock'" entries
```

When all five criteria pass, WP-0 is done. Atlas can be flipped to `confirm` mode. **Do not auto-flip to `auto` — that's the user's decision.**

---

## WP-1 — Auth + 3-tier RBAC + V1/V2 user bridge (autonomous)

**Source:** `V3-CODING-INSTRUCTIONS.md` §2 Task 5 + master plan §11.2 Phase 1.3 + Phase 1.11b.

Place the spec at `.agent/tasks/queued/phase-1.3-auth-rbac-v2-bridge.md`.

### Component contracts (this is the "perfect separate component with connectors" you asked for)

**Component:** `auth`
**Inputs:** user identity (email or phone), credential (password or OTP)
**Outputs:** Supabase session JWT, `profiles` row, `user_roles` row, navigation to dashboard
**DB tables read/written:** `auth.users` (Supabase managed), `profiles`, `user_roles`, `tier_review_queue` (new)
**Events published:** `auth.user_created`, `auth.tier_promoted` (logged to `agent_audit_log` for Atlas to observe)
**External services:** Supabase Auth, Twilio (WhatsApp OTP via edge function)

### Files to create / change

| File | Action | Purpose |
|---|---|---|
| `src/pages/Auth.tsx` | replace stub | tabbed UI for 4 login methods |
| `src/components/auth/EmailPasswordForm.tsx` | new | email + password sign-in / register |
| `src/components/auth/EmailOTPForm.tsx` | new | email OTP flow (uses Supabase magic link) |
| `src/components/auth/WhatsAppPasswordForm.tsx` | new | WhatsApp number + password |
| `src/components/auth/WhatsAppOTPForm.tsx` | new | WhatsApp OTP flow |
| `src/lib/auth-bridge.ts` | new | detects V1/V2 user by email/phone, triggers SetPassword for users with no password |
| `src/pages/SetPassword.tsx` | new | one-time password setup page for migrated users |
| `supabase/functions/whatsapp-send-otp/index.ts` | new | edge function — send Twilio WhatsApp OTP (key in secret) |
| `supabase/functions/whatsapp-verify-otp/index.ts` | new | edge function — verify code + create session |
| `supabase/migrations/<ts>_otp_codes_and_tier_review.sql` | new | `otp_codes` table + `tier_review_queue` table |
| `src/pages/admin/VerifiedReviewQueue.tsx` | new | Maxons team queue for tier promotions (admin tier only) |
| `src/components/RouteGuard.tsx` | extend | enforce 3 tiers: `registered` / `verified` / `admin` |
| `e2e/auth.spec.ts` | new | Playwright tests for all 4 login flows + V2 bridge + tier promotion |

### V1/V2 user bridge logic

The bridge handles users that exist in V1's or V2's Supabase but not in V3's. On sign-in attempt:

1. Look up email/phone in V3's `auth.users`. If found → standard flow.
2. If not found, query V2's `auth.users` (read-only, via dedicated read-only DB role) for the same email/phone. If found:
   - Create the user in V3 with same email/phone, no password.
   - Insert into `profiles` with `migrated_from = 'v2'`.
   - Redirect to `/set-password` with a one-time token.
3. If not found in V2 either → "Account not found, please register."

**Do not run** the bridge on every sign-in after a successful migration — flag the profile as `migrated_at IS NOT NULL` to skip the V2 lookup.

### Acceptance criteria

- All 4 login methods complete a round trip on `localhost:5173`.
- A new user signing up gets `tier: 'registered'` automatically. `RouteGuard requires="verified"` blocks them from `/dashboard/inquiries`.
- A V2 user can log in via email/password, lands on `/set-password`, sets a password, lands on `/dashboard`.
- A Maxons admin can view `/admin/verified-queue`, see registered users sorted by sign-up date, click "Promote to verified" and the user's tier flips. The user's next page load shows the verified-tier UI.
- Playwright e2e: `auth.spec.ts` runs `npx playwright test` green for all 4 flows + bridge + promotion.
- `npm run build` passes with zero TS errors.

---

## WP-2 — Adela data spine (autonomous, but Adela may be already partially shipped)

**Source:** master plan §11.2 Phase 1.6 + 1.7 + V1's `scrape-position-report`, `scrape-stratamarkets`, `extract-market-batch` edge functions, V1's `priceIntelligenceService.ts`.

**Before queueing the WP-2 spec, do this:**

```bash
# Check what's already in .agent/tasks/in-progress/ — phase-1.6b through 1.6f are listed there
ls .agent/tasks/in-progress/phase-1.6*
ls .agent/tasks/done/phase-1.6*
```

If 1.6b-1.6f are already in-progress, **do not duplicate them**. Instead write a coordination spec named `phase-1.6-adela-coordination.md` that:
- Lists each of 1.6b-1.6f's acceptance criteria
- Tracks completion via TodoWrite
- Triggers a single end-to-end test once all five sub-phases are green
- Adds the missing pieces (1.7 position-report analytics + V1's `priceIntelligenceService.ts` port)

If 1.6 has not started, write a single bundled spec `phase-1.6-1.7-adela-data-spine.md` covering everything below.

### Component contracts

**Component:** `adela`
**Inputs:** cron triggers (every N hours), explicit `/scrape <source>` API calls
**Outputs:** rows in `market_intelligence`, `position_reports`, `pricing_history`, `news_items`
**DB tables written:** see above
**Events published:** `data.position_report_ingested`, `data.price_updated`, `data.news_arrived` (to `agent_audit_log`)
**External services:** USDA NASS, Almond Board of California (ABC) PDFs, Strata Markets, news RSS, Gemini Pro for extraction

**Component:** `price-intelligence`
**Inputs:** raw `pricing_history` rows, `position_reports` rows
**Outputs:** trade signals — `signals` rows with `direction` (`buy`/`hold`/`sell`), `confidence` (0-1), `rationale`
**DB tables written:** `signals`
**Events published:** `signals.generated`

### Files to create / change

| File | Action | Purpose |
|---|---|---|
| `adela/src/scrapers/abc-position.ts` | port from V1 `scrape-position-report` | monthly ABC report ingestion |
| `adela/src/scrapers/strata-prices.ts` | port from V1 `scrape-stratamarkets` | live almond prices |
| `adela/src/scrapers/news-rss.ts` | port from V1 `scrape-news` | news ticker |
| `adela/src/extractors/market-batch.ts` | port from V1 `extract-market-batch` | extract metrics from PDF/HTML |
| `adela/src/scheduler.ts` | new | cron orchestrator (one cron, dispatches to each scraper based on `release_schedule` table) |
| `supabase/migrations/<ts>_market_intelligence_extension.sql` | new | extends `market_intelligence` with proper columns; adds `pricing_history`, `news_items`, `signals` tables, all with `commodity_id` FK |
| `src/lib/services/priceIntelligence.ts` | port from V1 `priceIntelligenceService.ts` | trade signal generator (server-side, called via edge function) |
| `supabase/functions/generate-signals/index.ts` | new | edge function that runs `priceIntelligence` on a schedule |
| `src/pages/Insights.tsx` | new | public-tier insights page (the marketing surface) |
| `src/pages/InsightDetail.tsx` | new | drill-down for a single insight |
| `e2e/insights.spec.ts` | new | Playwright tests |

### Acceptance criteria

- A fresh DB has zero rows in `position_reports`. After Adela's first scheduled run, at least 1 row exists with valid `crop_year`, `metrics`, `analysis`.
- `pricing_history` accumulates ≥1 row per scheduled scrape window for almond.
- `signals` table has ≥1 row per crop year after `generate-signals` runs.
- `/insights` (public, no auth) renders the latest 3 signals + a chart of the last 12 months of pricing.
- All four scrapers + the analytics layer + insights page compile under TS strict mode.
- Playwright: `insights.spec.ts` green.

---

## WP-3 — CRM + Inquiry/Offer flow (autonomous, value-delivering)

**Source:** master plan §11.2 Phase 1.10 (Zyra inquiry-handler module only; not the full 13-module v1.4 spec) + V1's `aiMatchService.ts` + V1's `Inbox.tsx` + `Offers.tsx` + `OfferView.tsx`.

Spec at `.agent/tasks/queued/phase-1.10-crm-inquiry-offer-flow.md`.

### Component contracts

**Component:** `crm`
**Inputs:** `companies` rows (kind: customer/broker/supplier), `contacts` rows
**Outputs:** scoped views per role
**DB tables read/written:** `companies`, `contacts`, `relationships`, `inquiries` (new), `offers` (new), `offer_messages` (new)
**Events published:** `crm.inquiry_received`, `crm.offer_drafted`, `crm.offer_sent`, `crm.offer_accepted`, `crm.offer_rejected`
**Information walls:** customer sees only own inquiries + offers; broker sees inquiries marked broker-routable; supplier sees demand patterns but not buyer identity

**Component:** `inquiry-handler` (the only Zyra module shipped in WP-3)
**Inputs:** new row in `inquiries`
**Outputs:** draft `offers` row, with `aiMatchService` matched supplier(s), `priceIntelligence` recommended price band, `status='draft_pending_maxons_review'`
**Maxons review gate:** every draft offer requires Maxons-team approval before sending. No autopilot in WP-3.

### Files to create / change

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/<ts>_inquiries_offers.sql` | new | `inquiries`, `offers`, `offer_messages` tables. All with `commodity_id` + `customer_id` + RLS policies |
| `src/lib/services/aiMatch.ts` | port from V1 `aiMatchService.ts` | buyer-supplier matching |
| `supabase/functions/inquiry-handler/index.ts` | new | edge function — receives inquiry, calls aiMatch + priceIntelligence, drafts offer |
| `src/pages/Inbox.tsx` | port + scope to almond + verified tier | Maxons-team view of all inquiries |
| `src/pages/InquiryDetail.tsx` | port from V1 | inquiry detail view |
| `src/pages/Offers.tsx` | port + scope | Maxons-team view of offers (with status filter) |
| `src/pages/OfferView.tsx` | port from V1 | single-offer view (Maxons + customer perspectives, info-walled) |
| `src/pages/customer/MyInquiries.tsx` | new | customer-tier view of own inquiries only |
| `src/pages/customer/MyOffers.tsx` | new | customer-tier view of own offers only |
| `e2e/inquiry-flow.spec.ts` | new | full happy path: customer submits inquiry → handler drafts → Maxons approves → customer receives → customer accepts |

### Acceptance criteria

- A verified-tier customer can submit an inquiry via `/customer/new-inquiry`. It lands in `inquiries` with `status='received'`.
- Within 60s, `inquiry-handler` runs and `offers` has a row with `status='draft_pending_maxons_review'`, `matched_supplier_id`, `recommended_price_band`.
- A Maxons-admin viewing `/inbox` sees the inquiry. Clicking through, they see the AI-drafted offer with the rationale.
- Maxons admin clicks "Approve & Send" → offer status flips to `sent`, customer's `MyOffers` shows it.
- Customer clicks "Accept" → offer status flips to `accepted`, an `agent_audit_log` row records the chain of decisions.
- RLS: customer A querying `offers` table directly sees only their own offers. Customer B is invisible. Tested with two test accounts in Playwright.
- `npm run build` clean. `npx playwright test e2e/inquiry-flow.spec.ts` green.

---

## Final notes for Claude Code

### When you finish each WP

1. Run all acceptance criteria. If any fail, fix in place (Rule 2 — anti-restart).
2. Push to GitHub. Wait for the deploy workflow to go green.
3. Update `~/Documents/Claude/Projects/Cropsintel/cropsintel-v3-master-plan.md` with a change-log entry: `2026-MM-DD — WP-N shipped — <summary>`.
4. Send a one-line summary to the user: via `/atlas/chat` API if Atlas is in `chat`/`auto`, or via WhatsApp by writing to `atlas/src/lib/twilio.ts`'s `sendMaxonsMessage` helper, or fall back to console.log if neither is reachable.
5. Stop. Wait for the user to confirm "go WP-N+1" before starting the next package.

### When you hit a fork

Write `.agent/questions/<YYYY-MM-DD>-<short-name>.md` with this exact format:

```markdown
# Question: <one-line summary>

**Blocking:** WP-<n> §<section>
**Asked:** <ISO timestamp>

## Context
<3-5 sentences about why this is a fork>

## Options
A. <option A> — <pros/cons>
B. <option B> — <pros/cons>
C. <option C> — <pros/cons>

## Recommended: <A|B|C>

## What I'll do without an answer
<the safe default if the user is asleep>
```

Then stop. Do not "make a reasonable assumption and proceed" on architectural questions.

### What success looks like

After all four work-packages ship and pass acceptance:

- A new visitor lands on `cropsintel.com`, signs up, gets `registered` tier, can read public insights.
- Maxons promotes them to `verified` after vetting in `/admin/verified-queue`.
- Verified user submits an inquiry. AI drafts an offer in under 60s. Maxons approves. Customer accepts. Audit trail is end-to-end clean.
- The seven-service production house ships every spec with verified gate signals — no more `unknown` verdicts, no more silent designer no-ops, no more passive-mode reverts.
- No `VITE_*KEY` env vars exist for any AI provider. RLS isolates customers from each other. `commodity_id` FK is on every domain row.
- Walnut and pistachio are one config row away in `commodities` — UI hidden until enabled.

That is the clean, verified, multi-brain-powered, trade-focused CropsIntel V3.

---

**End of prompt. Drop this whole file at `.agent/specs/claude-code-build-prompt-2026-05-07.md` and reference it with `claude-code "execute the build plan in .agent/specs/claude-code-build-prompt-2026-05-07.md"`.**
