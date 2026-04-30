# CropsIntel V3 — Handoff to Claude Code (VS Code)

**Created:** 2026-05-01 02:10 GMT+4 (Dubai)
**For:** Claude Code session running in VS Code on Muzammil's Mac
**Continuing from:** Cowork session running on the same Mac

---

## ⚡ TL;DR — start here

You are taking over the autonomous-build of **CropsIntel V3** — an almond market intelligence + CRM platform for Maxons General Trading LLC. The project has a 7-service "production house" architecture on Railway that builds CropsIntel autonomously. **6 services are live and shipping code 24/7. Designer (7th) is being built by Builder right now.** This handoff gives you full context so you can pick up without re-asking.

**Read these files in order before doing anything:**
1. `.agent/master-plan.md` — the canonical project plan (master plan v1.5, locked)
2. `.agent/specs/atlas-master-spec.md` — Atlas (the conductor) blueprint
3. `/Users/muzammilakhtar/Documents/Claude/Projects/Cropsintel/SECRETS.md` — every credential, URL, Railway service, Twilio number, API key
4. `/Users/muzammilakhtar/Library/Application Support/Claude/local-agent-mode-sessions/0a3f3fa7-aa7d-432d-8d56-d0e86d05df7f/f6bc9e80-f928-4327-a8bc-44e489466a48/spaces/3350a42f-ad05-4af8-acde-2c2f4174a60b/memory/MEMORY.md` — Cowork's memory index (loads of useful context)
5. This file (HANDOFF.md) — covers everything else

---

## Section 1 — Origin & vision

**The project:** Muzammil Akhtar (founder) is building CropsIntel — a global almond market intelligence platform with CRM/BRM/SRM relationship graphs and an AI agent layer. Maxons General Trading LLC (UAE) is the first power-user; the platform serves the global almond chain (importers, brokers, growers).

**Three versions exist:**
- **V1** = `almond-oracle` (Lovable, parked) — heavy 26-module Zyra orchestration framework, single-tenant
- **V2** = `CropsIntelV2` — currently live at cropsintel.com, lighter Zyra (1 widget, 3 files), customers actively using it
- **V3** = `cropsintel-v3` — clean rebuild we are building. Will replace V2 at DNS cutover (Phase 1.15).

**The user's strategic ask** that started this whole architecture: a self-driving production house where:
- Multiple AI agents collaborate to build CropsIntel
- Each agent specializes (coding, auditing, knowing, planning, scraping)
- One conductor agent (Atlas) talks to the human, dispatches the others
- Human gives phase-level direction; system handles task-level execution
- Cost cap $400/month total AI spend (master plan §10.3)

---

## Section 2 — Architecture (the 7 agents / production house)

All services run on Railway in project `generous-possibility` (id: `048004b7-ac3c-4126-95b2-dfb7560116ab`). All connect to the same GitHub repo (`muzammil691/cropsintel-v3`) but target different Root Directories.

| # | Service name | Railway service | Root | Purpose | Status |
|---|---|---|---|---|---|
| 1 | **Builder** | `cropsintel-agent` | `/agent` | Autonomous coding loop. Picks specs from `.agent/tasks/queued/`, runs Claude (Sonnet/Opus), commits, pushes. | ✅ Live |
| 2 | **Verifier** | `rare-happiness` | `/verifier` | Audits diffs vs spec using OpenAI o3 + Gemini 2.5 Pro. Wired as a gate (blocks push if confidence ≥ 0.7 fail). | ✅ Live |
| 3 | **Memory** | `cooperative-rejoicing` | `/memory` | Institutional knowledge in Supabase pgvector. ~6,755 chunks ingested (master plan, V1 codebase, V2 codebase, audits, workflow doc). | ✅ Live |
| 4 | **Council** | `just-reflection` | `/council` | Multi-brain task spec writer (Claude+GPT+Gemini debate). Decomposes phases into specs. | ✅ Live (idle) |
| 5 | **Adela** | `believable-warmth` | `/adela` | Almond market data scraper (USDA NASS, ABC, news RSS). Powered by Gemini Pro. | ✅ Live (idle until Phase 1.6) |
| 6 | **Atlas** | `courteous-simplicity` | `/atlas` | THE CONDUCTOR. Multi-brain orchestrator. Talks to Muzammil via WhatsApp + dashboard. Dispatches all other agents. | ✅ Live |
| 7 | **Designer** | (not yet created) | `/designer` | UI/UX quality gate. Pre-reviews UI specs and post-audits UI commits. Multi-brain (Claude + GPT-4 vision). | 🟡 **CODE BEING SHIPPED BY BUILDER NOW** (1.10n in flight) |

### Builder's loop (`/agent/agent-loop.sh`)

```
Every 5 min:
  git fetch + git reset --hard origin/main      # verbose logging now (no --quiet)
  pick first .agent/tasks/queued/*.md
  if found:
    move to in-progress/
    run claude (--max-turns 200, with 30min timeout watchdog + 60s heartbeat)
    if green: verifier_gate -> commit -> push -> move to done/
    if red: move to failed/, queue remediation
  sleep 300
```

The watchdog (added 2026-05-01 02:00 UTC) wraps `claude` in `timeout 1800` and emits a heartbeat to stdout every 60s so we can see Builder isn't wedged during long Opus runs.

### Atlas's tools (`/atlas/src/lib/tools.ts`)

Atlas has 11 tools to dispatch:
- `memory.search`, `memory.ingest`
- `builder.queue_spec` — **auto-commits + pushes to GitHub** (Atlas owns the queue end-to-end)
- `builder.list_queue` — git fetches + lists queue
- `builder.cancel_task`
- `verifier.audit`, `verifier.recent_runs`
- `council.write_spec`
- `adela.trigger_scrape`
- `whatsapp.send`
- `status.snapshot`

### Atlas's trust modes

Set via `ATLAS_TRUST_MODE` env var OR `POST /atlas/mode`:
- `passive` — read-only, snapshot cron only (CURRENT MODE)
- `chat` — can answer + read tools, no writes
- `confirm` — can propose dispatches, asks user
- `auto` — full autonomy under cost cap
- `stopped` — kill switch

### Atlas conductor heartbeat (`/atlas/src/cron/conductor.ts` + `snapshot.ts`)

Runs every 5 min inside Atlas. Currently observes only (because trust_mode=passive). Once flipped to `auto` and 1.10p ships, conductor will:
- Detect stuck Builder → auto-restart via Railway API
- Detect Verifier failure clusters → multi-brain debate
- Pre-flight review new specs before Builder picks them up
- Trigger Designer audit on UI commits
- Ping user on architectural forks

---

## Section 3 — Master plan structure

The master plan (v1.5) is locked. **Don't add or rename phases.** Read `.agent/master-plan.md` for full text.

```
Phase 0  Stop the bleeding on V2 (security, key rotation)         ✅ done
Phase 1  V3 Market Intelligence MVP (1.1 - 1.15)                  🟡 in progress
  1.1   Local dev environment                                     ✅ done
  1.2   New Supabase + initial migration                          ✅ done
  1.3   Auth (4 methods + V1+V2 user migration)                   🟡 specs queued (1.3a-h)
  1.4   3-tier RBAC                                               🟡 specs queued (1.4a-d)
  1.5   Public landing + market-insight pages                     🟡 1.5a queued
  1.6   Adela runtime + 6 scrapers                                ⬜ not specced
  1.7   Position reports + analytics                              ⬜ not specced
  1.8   Market Price Intelligence                                 ⬜ not specced
  1.9   Dashboard with ~10 widgets                                ⬜ not specced
  1.10  Atlas conductor (BROUGHT FORWARD from Phase 2)            🟡 1.10n in flight, 1.10o-1.10p queued
  1.11  Prescription engine v1                                    ⬜ not specced
  1.11b Verified-user review queue UI (admin-side for 1.4d)       ⬜ not specced
  1.12  i18n (EN/HI/ZH/AR/UR)                                     ⬜ not specced
  1.13  PWA setup                                                 ✅ shipped as part of 1.10l
  1.14  Playwright e2e                                            ⬜ not specced
  1.15  DNS cutover                                               ⬜ not specced
Phase 2  CRM Intelligence + Atlas + tracked deals                 ⬜
Phase 3  External portals + variance engine                       ⬜
Phase 4  Verified social network + multi-commodity                ⬜
```

### Named layers (do NOT rename)
- **Adela** — runtime nervous system (cron-driven, monitors everything)
- **Atlas** — self-development / project-management layer (dev-time conductor)
- **Zyra** — customer-facing intelligence + sales coworker (Phase 1.10 of OLD plan; not the same as Atlas. Zyra ships LATER.)

### NEVER list (master plan §11.6 — refuse anything matching)
- Sale Contract issuance
- Purchase Contract issuance
- Microsoft Business Central posting / sync
- Letter of Credit workflow
- Multi-tenant SaaS

---

## Section 4 — Chronological build journey

**Phase 0 (already done before this session):**
- V3 repo created on GitHub
- Initial Vite+React+Supabase scaffold
- Phase 1.1 + 1.2 done (foundation + initial schema)

**This session (last ~24h):**
1. Set up Memory service (cooperative-rejoicing) on Railway
2. Bootstrap-ingested master plan + V1 + V2 + audits → 6,755 chunks
3. Wrote Atlas master spec, decomposed into 13 sub-specs (1.10a through 1.10m)
4. Builder shipped 1.10a-1.10l autonomously (most in 80-300 seconds each!)
5. Atlas service deployed on Railway (`courteous-simplicity`)
6. Atlas multi-brain working: Sonnet 4.6 (chat) + Opus 4.7 (debate) + GPT + Gemini
7. **Conversations DB has Atlas-Muzammil WhatsApp threads** — proof Atlas works
8. Built Designer agent spec (1.10n), strict Verifier gate spec (1.10o), conductor auto-remediate spec (1.10p)
9. Started Phase 1.3 (Auth) — wrote 8 sub-specs
10. Started Phase 1.4 (RBAC) — wrote 4 sub-specs
11. Started Phase 1.5 (Landing) — wrote 1 sub-spec (1.5a)
12. Hit recurring Builder-wedge bug → patched agent-loop.sh with 30min timeout + 60s heartbeat
13. Hit Atlas dashboard blank-after-1s bug (in flight investigation)
14. Patched Atlas tools.ts so `builder.queue_spec` auto-commits+pushes (Atlas owns queue now)

**Recent commits on origin/main (newest first):**
```
55342fb  fix(agent): permanent wedge prevention — 30min Claude timeout + 60s heartbeat
6baecd1  feat(atlas): autonomous queue management — builder.queue_spec auto-commits+pushes
6d9c628  feat(phase-1.4): RBAC — 3-tier access control at DB + app + route levels
cbb00f0  feat(phase-1.3): auth — 4 login methods + V1/V2 migration bridge
57c4734  fix(agent): remove --quiet, add verbose git fetch/reset diagnostics + queue listing
aa51c0d  fix(ci): resolve merge conflict markers in deploy.yml
0e8d80d  feat(loop): close the autonomous build loop (1.10n+o+p specs queued)
4f32357  fix(ci): add VITE_ATLAS_* to build env + SPA 404.html fallback for GitHub Pages
fe849f3  fix(atlas): add CORS headers so dashboard at github.io can reach API
... (history of 22+ autonomous Builder ships)
```

---

## Section 5 — Current state (as of handoff)

### Builder queue (16 specs waiting, alphabetical)

```
phase-1.10n-designer-agent.md           ← BUILDER RUNNING THIS NOW (Opus 4.7, watchdog active)
phase-1.10o-verifier-strict-gate.md     ← lower threshold to 0.3 + auto-remediate
phase-1.10p-conductor-auto-remediate.md ← upgrade conductor to ACT
phase-1.3a-auth-foundation.md
phase-1.3b-auth-email-password.md
phase-1.3c-auth-google-oauth.md
phase-1.3d-auth-whatsapp-otp.md
phase-1.3e-auth-phone-otp.md
phase-1.3f-auth-v1-v2-migration-bridge.md
phase-1.3g-auth-pages.md
phase-1.3h-auth-route-protection.md
phase-1.4a-rbac-database-rls.md
phase-1.4b-rbac-tier-guard-component.md
phase-1.4c-rbac-admin-routes.md
phase-1.4d-rbac-verification-request.md
phase-1.5a-landing-hero.md
```

Each spec is 5-15 KB of detailed instructions. Builder ships them ~5-30 min each.

### Live URLs

| Thing | URL | Auth |
|---|---|---|
| GitHub repo | https://github.com/muzammil691/cropsintel-v3 | Muzammil's account |
| V3 frontend | https://muzammil691.github.io/cropsintel-v3/ | public |
| Atlas API | https://courteous-simplicity-production.up.railway.app | Bearer `cropsintel-atlas-token-2026-04-30` |
| Memory API | https://cooperative-rejoicing-production.up.railway.app | Bearer `cropsintel-memory-token-2026-04-29` |
| Verifier API | https://rare-happiness-production.up.railway.app | (no auth currently) |
| Council API | https://just-reflection-production.up.railway.app | (no auth currently) |
| Adela API | https://believable-warmth-production.up.railway.app | (no auth currently) |
| Supabase V3 | https://hzrnohsxigrqlmzegwlb.supabase.co | service key in SECRETS.md |

### Twilio numbers

- **+12345622692** — Maxons-registered Zyra/customer number (V2 webhook → Zyra). DO NOT REPURPOSE.
- **+19862022080** — NEW dedicated Atlas-to-Muzammil number. Webhook URL set to Atlas `/whatsapp/inbound`. Templates pending Twilio approval.

### Muzammil's WhatsApp: `+971562556592`

---

## Section 6 — Known issues / where we're stuck

### Issue 1: Atlas dashboard blanks within 1 second of loading
**Symptom:** Visit `https://muzammil691.github.io/cropsintel-v3/atlas` (or `/ATLAS`), page renders briefly with title and wizard buttons, then goes blank.
**Root cause hypothesis:** React runtime error during data fetch. Page uses `useAtlasStatus` which calls `/atlas/status` — if that fetch throws, whole tree unmounts (no error boundary configured).
**What's been tried:**
- Added CORS headers to Atlas (worked — backend serves correctly)
- Added VITE_ATLAS_URL + VITE_ATLAS_API_TOKEN to GitHub Actions secrets
- Added SPA fallback (`cp dist/index.html dist/404.html` in workflow)
**What to try next:**
- Open Chrome DevTools (Cmd+Option+I), Console tab, hard-refresh `/atlas`
- Read the red error → fix the specific component throw
- Likely culprit: `src/hooks/useAtlasStatus.ts` or `src/components/atlas/StatusGrid.tsx`
**Files to check:**
- `src/pages/Atlas.tsx`
- `src/hooks/useAtlasStatus.ts`
- `src/lib/atlas-client.ts`

### Issue 2: Builder occasionally wedges
**Symptom:** Builder picks up a task, runs Claude, then container looks idle (no logs for 30+ min)
**Status:** Patched in commit `55342fb` — 30min timeout + 60s heartbeat
**Test:** After 1.10n ships, watch heartbeats fire every 60s in Railway logs

### Issue 3: Designer Railway service not yet created
**Status:** Code being shipped by Builder right now (1.10n). After Builder commits, the `designer/` directory will exist. **User needs to:**
1. Railway → `generous-possibility` → + New Service → GitHub Repo → cropsintel-v3
2. Settings → Source → Root Directory: `designer`
3. Settings → Networking → Generate Domain
4. Variables tab → Raw Editor → paste env block (see Section 9)
5. Add `DESIGNER_URL` and `DESIGNER_API_TOKEN` to Atlas's variables

### Issue 4: Atlas trust mode still `passive`
**Status:** Conductor heartbeat is running (logs show "starting heartbeat, interval=300000ms") but in passive mode it only snapshots, doesn't act.
**To activate:**
- Once 1.10p ships AND user has confidence, flip to `chat` mode first (read-only)
- Then `confirm` (asks before each write)
- Then `auto` (full autonomy under $400/mo cap)
- Flip via `POST /atlas/mode` or env var change

### Issue 5: Verifier false positives
**Status:** 1.10o spec will tighten threshold to 0.3 + auto-remediate up to 3 attempts + escalate. NOT YET SHIPPED.
**Manual workaround in meantime:** Verifier audits are advisory; review verdict reports in `verifier_runs` table but don't trust them blindly.

---

## Section 7 — Files that matter (orientation)

```
cropsintel-v3/                              # repo root
├── .agent/
│   ├── master-plan.md                     # ⭐ THE PLAN (v1.5, locked)
│   ├── v1-audit.md                        # what V1 had
│   ├── v2-audit.md                        # what V2 has
│   ├── v1-v2-comparative.md               # what to take from each
│   ├── design-system.md                   # (created when 1.10n ships)
│   ├── specs/
│   │   └── atlas-master-spec.md           # ⭐ Atlas blueprint
│   ├── tasks/
│   │   ├── queued/                        # 16 specs waiting for Builder
│   │   ├── in-progress/                   # what Builder is shipping NOW
│   │   ├── done/                          # 22+ shipped specs
│   │   ├── failed/                        # if any failed
│   │   ├── cancelled/                     # user-cancelled
│   │   ├── logs/                          # Claude execution logs from Builder
│   │   └── _template.md                   # spec template
│   └── questions/                         # Builder pings here when stuck
├── agent/                                  # Builder (Railway: cropsintel-agent)
│   ├── agent-loop.sh                       # ⭐ the autonomous loop (verbose + watchdog)
│   ├── notify-whatsapp.sh
│   ├── Dockerfile
│   └── CLAUDE.md                          # system prompt for Builder's Claude
├── atlas/                                  # Atlas (Railway: courteous-simplicity)
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── package.json
│   └── src/
│       ├── server.ts                       # HTTP API (chat, status, mode, whatsapp inbound)
│       ├── lib/
│       │   ├── tools.ts                    # ⭐ 11 tools, gitCommitAndPush helper
│       │   ├── multi-brain.ts              # Claude+GPT+Gemini debate
│       │   ├── trust-mode.ts               # runtime mode flag
│       │   ├── invariants.ts               # master plan rule enforcer (1.10h)
│       │   ├── cost-gate.ts                # $400/mo cap (1.10g)
│       │   └── twilio.ts                   # WhatsApp send + phone-to-thread
│       └── cron/
│           ├── snapshot.ts                 # 5-min status writer
│           └── (conductor.ts when 1.10p ships)
├── verifier/, memory/, council/, adela/    # (mirror structure of atlas/)
├── designer/                               # (created when 1.10n ships)
├── src/                                    # Vite React app (the actual CropsIntel)
│   ├── pages/
│   │   ├── Atlas.tsx                       # Atlas dashboard (blanks bug)
│   │   ├── Welcome.tsx, Login.tsx, ...
│   │   └── (Phase 1.3 pages queued)
│   ├── components/
│   │   ├── atlas/                          # ChatPanel, StatusGrid, WizardBar etc.
│   │   ├── auth/                           # AuthGuard, LoadingScreen (queued)
│   │   └── ui/                             # shadcn primitives
│   ├── contexts/AuthContext.tsx            # (queued)
│   ├── lib/
│   │   ├── supabase.ts
│   │   └── atlas-client.ts                 # frontend → Atlas API
│   └── App.tsx                             # routing
├── supabase/migrations/                    # all DB schema (apply via npx supabase db push)
├── docs/MAXONS_Workflow_v1.md              # almond trading workflow knowledge
├── public/                                 # static assets
├── .github/workflows/deploy.yml            # GitHub Pages deploy with VITE_ATLAS_* + SPA 404
├── ship-all.sh                             # local Builder bypass (uses claude CLI)
├── HANDOFF.md                              # ⭐ THIS FILE
└── package.json
```

---

## Section 8 — How the autonomous loop SHOULD work (target state)

```
┌─ Muzammil (WhatsApp / dashboard chat)
│
└─→ Atlas receives "Open Phase 1.6"
        │
        ├─→ Atlas multi-brain pre-flight reviews ambiguity (1.10p)
        │
        └─→ Council writes 6 task specs for Adela scrapers
                │
                ├─→ Designer pre-reviews UI specs (1.10n)
                │
                └─→ Builder picks first spec, ships
                        │
                        └─→ Verifier strict gate (1.10o)
                                │
                                ├─ FAIL (conf ≥ 0.3) → revert, queue remediation (3 attempts max), escalate
                                │
                                └─ PASS → Designer post-audit (UI only)
                                                │
                                                ├─ FAIL → remediation
                                                │
                                                └─ PASS → Memory ingests
                                                                │
                                                                └─→ Atlas conductor heartbeat
                                                                        watches for: stuck Builder, idle queue,
                                                                        cluster failures, cost spikes, open forks
```

**You don't have to build this from scratch — it's mostly built.** What's left:
- 1.10n Designer agent (in flight)
- 1.10o Verifier strict gate (queued)
- 1.10p Conductor auto-remediate (queued)
- Designer Railway service creation (manual, after 1.10n)
- Trust mode flip to `auto` (one env var change)

---

## Section 9 — Credentials map (full details in `/Users/muzammilakhtar/Documents/Claude/Projects/Cropsintel/SECRETS.md`)

DO NOT paste API keys into chat. Read SECRETS.md for full values. Quick reference:

- **Railway project:** `generous-possibility` (id 048004b7-ac3c-4126-95b2-dfb7560116ab)
- **GitHub deploy key:** `~/.ssh/cropsintel_agent_key` (registered as "RAILWAY AGENT" on cropsintel-v3 repo)
- **AGENT_SSH_PRIVATE_KEY:** stored in every Railway service's env vars (Builder, Verifier, Memory, Council, Adela, Atlas, will need on Designer too)
- **Anthropic API key:** `vps-claude-code` (sk-ant-api03-...)
- **OpenAI API key:** sk-proj-...
- **Gemini API key:** AIzaSy...
- **Supabase V3 secret key:** sb_secret_LocufG8QwR-zxwqhRowgoQ_SazYero2 (sb_publishable for client)
- **Supabase V3 URL:** https://hzrnohsxigrqlmzegwlb.supabase.co
- **Supabase V3 project ref:** hzrnohsxigrqlmzegwlb
- **Supabase access token:** sbp_83eb6f2bd4e53a3050da8a7080220cc261fcf646
- **DB password:** zySdo9-tyqvid-rehjuh
- **Twilio account SID:** in V2 Supabase Edge Function secrets (one Maxons account, two numbers)
- **Atlas API token:** cropsintel-atlas-token-2026-04-30
- **Memory API token:** cropsintel-memory-token-2026-04-29
- **GitHub Actions secrets** (already added):
  - VITE_SUPABASE_URL
  - VITE_SUPABASE_ANON_KEY (publishable, NOT secret)
  - VITE_ATLAS_URL
  - VITE_ATLAS_API_TOKEN

---

## Section 10 — Rules / preferences (THESE MATTER)

**User collaboration pace** — explicit preference saved in memory:
- Never suggest "tomorrow", "go to bed", "save this for later", "this is enough for tonight"
- Keep advancing until Muzammil says stop
- After every completed sub-task, line up the next concrete action and propose execution, not deferral
- Default expectation: keep generating specs, code, fixes until told otherwise

**No 8th master agent above Atlas** — Atlas IS the master. Multi-brain inside Atlas serves as its advisor council. Don't add hierarchy theater.

**Master plan v1.5 is locked.** Don't add or rename phases. Don't violate §11.6 NEVER list.

**Cost cap $400/mo** but user has explicitly said "I don't care about cost, if I can build the whole app in a night, I will." So treat cost cap as soft.

**Design quality matters.** User has flagged that earlier UI ships were not aesthetically strong. Designer agent (1.10n) will fix. Until shipped, manually emphasize design tokens in spec content.

**Atlas should drive future spec queueing.** Atlas's `builder.queue_spec` now auto-commits+pushes. Use Atlas to write Phase 1.6+ specs autonomously instead of writing them by hand.

---

## Section 11 — What you (Claude Code in VS Code) should do FIRST

**Step 1 — orient (5 min):**
1. Read `.agent/master-plan.md` for project shape
2. Read `.agent/specs/atlas-master-spec.md` for Atlas blueprint
3. Read `agent/agent-loop.sh` for how Builder works
4. Read `atlas/src/server.ts` and `atlas/src/lib/tools.ts` for how Atlas works
5. Run `git log --oneline -20` to see recent build activity
6. Run `ls .agent/tasks/queued/ .agent/tasks/in-progress/ .agent/tasks/done/` to see queue state

**Step 2 — verify Builder is working:**
1. Open Railway dashboard (or use `railway logs --service cropsintel-agent` if Railway CLI installed)
2. Check the active deployment's logs for cropsintel-agent
3. Look for heartbeat lines: `[agent-loop] heartbeat: claude running on phase-X.Y for Ns`
4. If no heartbeats for 30+ min after task started → Builder needs investigation

**Step 3 — investigate Atlas dashboard blank bug:**
1. Open https://muzammil691.github.io/cropsintel-v3/atlas
2. Open Chrome DevTools Console
3. Hard-refresh (Cmd+Shift+R)
4. Identify the JS error → fix in src/pages/Atlas.tsx or src/hooks/useAtlasStatus.ts or src/lib/atlas-client.ts
5. Commit + push the fix
6. Hard-refresh, verify dashboard renders

**Step 4 — wait for 1.10n to ship**, then create Designer Railway service (~10 min, see Section 6 Issue 3).

**Step 5 — write Phase 1.6 (Adela) specs.** Master plan §11.2 row 1.6 says: "Adela runtime: cron + 6 scrapers (ABC, Strata, news, etc.) ported from V2 to V3 — hosted on Railway. First deploy, not a migration."

Decompose into:
- 1.6a Adela schema + migration tables
- 1.6b ABC objective shipment scraper
- 1.6c USDA NASS / FAS data scraper
- 1.6d Strata Almond price scraper
- 1.6e News RSS aggregator (multiple feeds)
- 1.6f Adela cron orchestrator + Railway service config

OR, even better: **let Atlas write these specs.** Once Atlas's tools.ts patch deploys (it's in commit `6baecd1`), you can chat with Atlas via `POST /atlas/chat` and ask it to queue Phase 1.6 specs. Atlas will write them, commit, and push autonomously.

**Step 6 — keep going.** Phase 1.7, 1.8, 1.9, 1.11, 1.11b, 1.12, 1.14, 1.15. Don't ask "should we continue?" — just continue. Muzammil's preference is keep advancing.

---

## Section 12 — How to chat with Atlas (the way Muzammil prefers)

Once 1.10n ships and Atlas's autonomous queue management is live, **Atlas should be the primary interface, not direct git pushes.** Muzammil has expressed strong fatigue with manual git pushes.

**Web chat:** https://muzammil691.github.io/cropsintel-v3/atlas (when blank bug fixed)
**WhatsApp:** Muzammil messages +19862022080 from his phone (+971562556592)
**API:** `POST https://courteous-simplicity-production.up.railway.app/atlas/chat` with Bearer token `cropsintel-atlas-token-2026-04-30`

Example chat flow:
```
Muzammil: "Atlas, queue specs for Phase 1.6 — Adela scrapers"
Atlas: [calls memory.search for Phase 1.6 context]
Atlas: [drafts 6 specs based on master plan + V2 reference]
Atlas: [calls builder.queue_spec for each — auto-commits+pushes]
Atlas: "Queued 1.6a-f. Builder will pick them up in next 5 min cycle. ETA all six shipped: ~3-4 hours."
```

Once trust mode flips to `auto`, Atlas dispatches autonomously. User just gives phase-level direction.

---

## Section 13 — Memory system (Cowork's persistent state)

The Cowork session that did this work has its own memory directory at:
`/Users/muzammilakhtar/Library/Application Support/Claude/local-agent-mode-sessions/0a3f3fa7-aa7d-432d-8d56-d0e86d05df7f/f6bc9e80-f928-4327-a8bc-44e489466a48/spaces/3350a42f-ad05-4af8-acde-2c2f4174a60b/memory/`

Files there worth reading:
- `MEMORY.md` — index of all memories
- `cropsintel_vision.md` — full strategic vision
- `cropsintel_versions_corrected.md` — V1/V2/V3 framing
- `cropsintel_security_active.md` — open security issues
- `cropsintel_v3_live_status.md` — Phase 1 progress snapshot
- `cropsintel_whatsapp_sender.md` — Twilio number rules
- `cropsintel_v3_corrected_plan.md` — master plan invariants
- `agent_loop_permission_bug.md` — historical bug fix
- `cropsintel_memory_service.md` — Memory service endpoints
- `atlas_service_live.md` — Atlas deployment record
- `user_collaboration_pace.md` — keep going until told to stop

You (Claude Code in VS Code) don't have access to that memory directory directly, but everything important from it is summarized in this HANDOFF.md.

---

## Section 14 — Questions to ask Muzammil if blocked

1. "1.10n still in flight after 30+ min — should I let watchdog timeout (auto kills at 1800s) or interrupt?"
2. "Atlas dashboard error in console says X — should I fix or skip?"
3. "Atlas trust mode is passive — flip to confirm or auto?"
4. "Verifier flagged Y — is the audit correct or false positive?"
5. "Designer agent shipped — ready for Railway service creation?"
6. "Phase X.Y has architectural fork — option A or B?" (multi-brain debates these but only humans approve)

NEVER ask:
- "Should we keep working?" — yes, always
- "Save this for tomorrow?" — never
- "You've done enough?" — never

---

## Section 15 — Summary in 100 words

**You're inheriting a 7-agent autonomous build system for an almond market intelligence app.** 22 specs already shipped, 16 queued. Builder is shipping 1.10n (Designer agent) right now with Opus 4.7 + 30min watchdog. Atlas (the conductor) talks to Muzammil on WhatsApp + dashboard. Your job: investigate Atlas dashboard blank-bug, verify Builder ships through queue, create Designer Railway service when 1.10n lands, then queue Phase 1.6+ specs (or have Atlas do it). Don't suggest pauses. Master plan v1.5 is locked. SECRETS.md has every credential. Atlas should be the primary interface — don't make Muzammil push git manually.

---

**Good luck. The system is mid-flight, mostly working, occasionally fragile. Everything you need is in the repo or in this doc. Keep going until Muzammil says stop.**
