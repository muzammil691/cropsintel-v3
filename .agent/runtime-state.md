# V3 Runtime State

**This file is committed. Atlas reads it on every spec to understand current deployment state.**

For actual secret values (API keys, tokens, passwords), see the canonical SECRETS.md at:
**`/Users/muzammilakhtar/Documents/Claude/Projects/Cropsintel/SECRETS.md`**

This is on Muzammil's Mac, outside any git repo, never committed. The Railway agent services have the same secrets in their environment variables (set during initial deployment 2026-04-29 to 2026-05-01). Atlas never reads SECRETS.md from disk; it uses Railway env vars at runtime.

When this file is updated, also update SECRETS.md's change log on Muzammil's Mac.

Last updated: 2026-05-10 (Phase 1.3c shipped — verify_jwt config flipped, drift repair queued for Muzammil, smoke-test script added, frontend deploy workflow already in place)

---

## What's deployed and running

### Database (Supabase, project hzrnohsxigrqlmzegwlb, Singapore region, Free tier)

**Foundation (20260428000001_v3_foundation):** 12 tables, ENUMs (`user_tier`, `app_role`), helpers (`has_role`, `is_team_or_admin`).

**Phase 1.3a (applied 2026-05-09 via Supabase Studio + migration repair --status applied):**
- `profiles` extended with verification + onboarding columns (verification_state, geography_country, business_type, etc.)
- `verification_requests` extended with structured background-check fields + multi-reviewer assignment
- `guest_sessions` (10-deep-output gate)
- `auth_bridge_log` (V1/V2 user migration audit)

**Phase 1.3b (applied 2026-05-10 via Supabase Studio + migration repair --status applied):**
- `chat_sessions` (registered/verified user conversation history)

**Cockpit infrastructure:**
- `concepts` (1.10aj)
- `wizard_sessions` (1.10am)
- All `atlas_*` tables (1.10aj/al/am/an)

### Edge functions (Supabase, deployed 2026-05-10; config.toml flipped 2026-05-10 in Phase 1.3c)

| Function | verify_jwt | Purpose |
|---|---|---|
| `whatsapp-send-otp` | false (config.toml) — pending redeploy | Sends WhatsApp OTP via Twilio template |
| `whatsapp-verify-otp` | false (config.toml) — pending redeploy | Validates OTP, signs user in |
| `auth-bridge` | false (config.toml) — pending redeploy | V1/V2 user detection |
| `guest-gate` | false (config.toml) — pending redeploy | Tracks 10-deep-output limit |
| `zyra-chat` | false (config.toml) — pending redeploy | Phase 1.10 placeholder chat |

Config change committed in Phase 1.3c. Builder cannot redeploy from CI (no Supabase access token in CI env); Muzammil runs the 5 `supabase functions deploy` commands per `docs/phase-1.3c-manual-steps.md` step 1.

### Edge function secrets (set 2026-05-10)

```
TWILIO_ACCOUNT_SID=<set in Supabase secrets — see SECRETS.md>
TWILIO_AUTH_TOKEN=<set>
TWILIO_WHATSAPP_FROM=whatsapp:+19862022080  (V1.0-alpha; switches to +12345622692 at V1.0-beta per Phase 1.15)
TWILIO_OTP_TEMPLATE_SID=HXd915042aa18cf4b368ed2141debeb51b  (verifications_2fa_template)
```

### Twilio (production-ready)

WhatsApp senders, both Meta-verified ONLINE under Maxons general Trading LLC:

| Number | Purpose | Phase |
|---|---|---|
| `+12345622692` | V2 customer (currently serving live customers via Zyra V2) | DO NOT TOUCH until V1.0-beta switchover |
| `+19862022080` | V3 — Atlas admin notifications + V1.0-alpha customer OTP | Active V3 use |

**Migration plan (Phase 1.15):** at V1.0-beta launch, switch V3 `TWILIO_WHATSAPP_FROM` from `+19862022080` to `+12345622692`. Decommissions V2; gives V3 the canonical customer number.

**Other Twilio assets (see SECRETS.md):**
- WABA ID: `827356306285810`
- Meta Business Manager ID: `1358121083003342`
- Messaging Service "CropsIntel WhatsApp OTP" created 2026-05-09 (NOT used — edge functions go direct to Twilio API)
- 11+ approved Content Templates

**Critical template:** `verifications_2fa_template` (`HXd915042aa18cf4b368ed2141debeb51b`) — WhatsApp Authentication category, Meta-pre-approved.

### Atlas + agents (Railway, project generous-possibility, env d727dbd8-225d-4554-a954-8585f7315d30)

7 services running:
- Atlas conductor (courteous-simplicity) — service ID `8b1ea7a2-effb-41d1-8617-1b67ebe35978`
- Builder (cropsintel-agent) — service ID `4829da1e-e705-486e-9885-fa147b0da2aa`
- Verifier (rare-happiness) — service ID `bfa035e9-7e8d-46da-9a61-dc636fd225d9`
- Designer (zucchini-friendship) — service ID `c78b26af-b8a9-42a4-9d82-fde96f8fa1df`
- Adela (believable-warmth) — service ID `30aea385-50c4-400a-8abb-5dbf771aa182`
- Council (just-reflection) — service ID `799ed6d9-0bfb-4c59-b7ec-5fcdca3e5561`
- Memory (cooperative-rejoicing) — service ID `124fc6b5-31d9-44db-a75c-b039a033695e`

Trust mode: Atlas runs in `confirm`. Self-restart enabled via `RAILWAY_API_TOKEN`.

Notification target: WhatsApp `+971562556592` (Muzammil). Atlas → `+19862022080` → Muzammil.

Atlas internals shipped:
- Real-signal detection (1.10ai)
- Builder lifecycle completion guard (1.10ag2)
- Zombie reaper + heartbeat (1.10ag)
- Verifier db_write_failed fix (1.10az)
- Cockpit polish (1.10ba)

---

## Phase status

### Shipped (V1.0-alpha foundations done)

- Phase 1.1 baseline V3 conventions ✅
- Phase 1.2 V3 foundation migration ✅
- Phase 1.3a Auth ✅
- Phase 1.3b AI agent landing scaffold ✅
- Phase 1.3c V1.0-alpha unblock — verify_jwt config + drift repair migration + smoke-test script + manual-steps doc ✅ (2026-05-10; Muzammil runs the redeploy/repair/db-push steps per `docs/phase-1.3c-manual-steps.md`)
- Phase 1.10 cockpit infrastructure (aj/ak/al/am/an/aw/az/ba) ✅

### Next up

**Phase 1.4** RBAC enforcement audit (queue after Muzammil confirms 1.3c manual steps complete)
**Phase 1.5** Public landing polish + market-insight pages stubs
**Phase 1.6** Adela data spine
**Phase 1.7** Multi-portal frontend scaffold
**Phase 1.8** Market price intel widgets
**Phase 1.9** Dashboard widgets per role
**Phase 1.10** Zyra real AI brain (13 modules)
**Phase 1.11** Hyper-personalized prescription engine v1
**Phase 1.11b** Verified-user review queue UX polish
**Phase 1.12** i18n (EN + AR + HI + ZH + UR)
**Phase 1.13** PWA + mobile responsive
**Phase 1.14** End-to-end Playwright tests across roles
**Phase 1.15** DNS cutover + V2 sunset + WhatsApp number migration

### Out of scope until V1.0 stable

- Phase 2 CRM Intelligence
- Phase 3 External portals
- MAXONS App territory (forever)
- V2 customer WhatsApp number migration (Phase 1.15)

---

## Build mode for Atlas

Atlas operates in **autonomous-plan-then-execute mode**:

1. Read this file + master plan + V3-CODING-INSTRUCTIONS on every spec
2. Plan the next phase as a multi-spec batch where appropriate
3. Queue specs autonomously — Muzammil approves at phase boundaries
4. Notify via WhatsApp at phase boundaries + on hard blocks
5. Cost cap: $50/day Builder, $20/day Verifier+Designer (tracked via atlas_cost_log)

Muzammil's role:
- Approve phase scopes
- Apply manual SQL when migration drift requires (Phase 1.3c fixes for future)
- Set new Supabase secrets when Atlas notifies
- Verify in preview at end of each phase
- Cut DNS at Phase 1.15

Atlas's role:
- Plan, queue, build, verify, design-review, remediate, ship
- Self-heal on retryable failures
- Stop and ping Muzammil on hard blocks

---

## Open issues

All four V1.0-alpha blockers were resolved on the code side in Phase 1.3c. The
remaining work is Muzammil-side ops that the agent cannot perform from CI
(needs SUPABASE_ACCESS_TOKEN + direct DB access). See
`docs/phase-1.3c-manual-steps.md` for step-by-step instructions.

1. **Edge function JWT config** — config.toml flipped to verify_jwt=false for 5 public functions. ⏳ Muzammil redeploys the 5 functions.
2. **Migration drift** — `.test.sql` files deleted; marker migration committed. ⏳ Muzammil runs `migration repair --status applied` for the 5 local-only versions, deletes the malformed `20260506` remote row, then `db push`.
3. **Frontend not built/deployed** — `.github/workflows/deploy.yml` already wired (built earlier); deploy fires on push to main.
4. **End-to-end smoke test missing** — `scripts/smoke-test-v1-alpha.sh` added. ⏳ Muzammil runs it and verifies OTP delivery.

Once 1, 2 and 4 complete (3 lands automatically with this PR), V3 is in preview and Atlas plans Phase 1.4 onward autonomously.

---

## Where to find things

| What | Where |
|---|---|
| Master plan | `.agent/master-plan.md` |
| V3 conventions | `V3-CODING-INSTRUCTIONS.md` |
| Idea file | `.agent/idea.md` |
| Research briefs | `.agent/research/` |
| Active specs | `.agent/tasks/queued/`, `.agent/tasks/in-progress/` |
| Shipped specs | `.agent/tasks/done/` |
| Spec logs | `.agent/tasks/logs/` |
| Manual-step docs | `docs/phase-X-manual-steps.md` |
| Secret values | `/Users/muzammilakhtar/Documents/Claude/Projects/Cropsintel/SECRETS.md` (Mac only) |
| Runtime state | this file (`.agent/runtime-state.md`) |
