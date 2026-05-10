---
phase: 1.3c
title: V1.0-alpha unblock — verify_jwt fix + migration drift repair + frontend deploy + end-to-end smoke test
status: planned
gate: in-progress count <= 2
order: 1-of-1 unblock-to-preview batch
estimated_builder_minutes: 35
estimated_cost_usd: 6
master_plan_section: 11.2 Phase 1.3 final + 11.7 Atlas autonomous mode
launch: v1.0-alpha
---

# Phase 1.3c — V1.0-alpha unblock to preview

## Why this exists

Phase 1.3a (auth foundation) and 1.3b (AI agent landing) shipped 2026-05-09. All code is on disk. Database migrations are applied. Edge functions are deployed. Twilio is wired. **But there are 4 specific blockers stopping V3 from being usable in preview today:**

1. The 5 deployed edge functions have `verify_jwt = true`, which blocks anonymous customer signup — they can't get a JWT before they have an account
2. 7+ database migrations applied via Supabase Studio aren't tracked in remote, breaking future `supabase db push`
3. Frontend hasn't been built and deployed to GitHub Pages — so muzammil691.github.io/cropsintel-v3 is still showing whatever was there before Phase 1.3
4. No end-to-end test has actually validated that a customer signing up via WhatsApp gets an OTP and lands in the app

This spec resolves all 4. Once shipped, V3 is in preview and Atlas takes over autonomous Phase 1.4-1.15 execution.

## Required reading before Builder starts

1. `V3-CODING-INSTRUCTIONS.md` — the 5 rules
2. `.agent/runtime-state.md` — current deployment state (read this BEFORE you assume anything about what's deployed)
3. `.agent/master-plan.md` § 11.2 Phase 1.3 + § 11.7 Phase 1.10 (Atlas autonomous mode)
4. `docs/phase-1.3a-manual-steps.md` and `docs/phase-1.3b-manual-steps.md` (Builder's own notes from previous specs)
5. `supabase/config.toml` — current state (likely needs adding [functions.X] sections with verify_jwt = false)

## The 5 rules check

1. **Foundation-first.** No new tables. Reads existing schema state from runtime-state.md.
2. **Anti-restart.** Modifies `supabase/config.toml` in place. Modifies CI workflow in place. Modifies edge function logic only if needed for verify_jwt change.
3. **Multi-commodity from Day 1.** N/A — this is infra/CI/test work, not domain.
4. **AI keys server-side only.** Verify no client bundle has Twilio creds, Anthropic keys, or anything that should be edge-function-only.
5. **Information walls.** Verify that the smoke test confirms a guest CANNOT see registered/verified data, registered CANNOT see verified data, etc.

## Foundation-first check

Before Builder writes ANY code:

- ✅ Read `.agent/runtime-state.md` — confirm deployed state matches this spec's assumptions
- ✅ Run `git log --oneline -10` and confirm latest commit is post-1.3b-design-remediation
- ✅ Confirm `supabase/migrations/20260509100000_phase_1_3a_auth_foundation.sql` exists on disk
- ✅ Confirm `supabase/migrations/20260509110000_phase_1_3b_chat_sessions.sql` exists on disk
- ✅ Run `npx supabase migration list` and capture output for the spec log

If any of these fail, STOP and write an investigation note instead of changing code.

## What ships

### 1. Edge function verify_jwt config fix

**Problem:** All 5 edge functions deployed with default `verify_jwt = true`. Returns 401 for anonymous calls.

**Fix:** Update `supabase/config.toml` to set `verify_jwt = false` for the 5 public-facing functions:

```toml
[functions.whatsapp-send-otp]
verify_jwt = false

[functions.whatsapp-verify-otp]
verify_jwt = false

[functions.auth-bridge]
verify_jwt = false

[functions.guest-gate]
verify_jwt = false

[functions.zyra-chat]
verify_jwt = false
```

These functions handle anonymous users at signup — they CANNOT require JWT or signup is impossible.

**Security note:** verify_jwt=false does NOT mean unsecured. Each function still validates inputs, rate-limits via `agent_rate_limits` table, uses CAPTCHA if appropriate, and writes audit log entries. The change just removes the JWT-or-401 gate at the gateway level.

**Redeploy required after config change:**
```bash
supabase functions deploy whatsapp-send-otp
supabase functions deploy whatsapp-verify-otp
supabase functions deploy auth-bridge
supabase functions deploy guest-gate
supabase functions deploy zyra-chat
```

This is documented in `docs/phase-1.3c-manual-steps.md` (Builder writes this).

### 2. Migration drift repair

**Problem:** Per `npx supabase migration list` (run 2026-05-09):
- 5 migrations exist locally but remote doesn't track them: `20260507085227` (×2 dupe), `20260507120000` (×3 dupe), `20260508000000`, `20260508100000`, `20260509085134`
- 1 migration exists remote but not locally: `20260506` (short-form, malformed name)
- 2 migrations applied via Studio, marked applied via repair: `20260509100000`, `20260509110000`

**Fix sequence:**

1. **Delete duplicate `.test.sql` files** in `supabase/migrations/`:
   ```bash
   ls supabase/migrations/*.test.sql
   # Should show:
   #   20260507085227_atlas_schema_complete.sql.test.sql
   #   20260507120000_atlas_schema_complete.sql.test.sql
   ```
   Delete these. They are test artifacts that shouldn't be in migrations folder.

2. **For each migration that's local-only and was applied via Studio**, mark applied via repair:
   ```bash
   for ts in 20260507085227 20260507120000 20260508000000 20260508100000 20260509085134; do
     npx supabase migration repair --status applied $ts
   done
   ```

3. **For the mystery `20260506` short-form remote row**, investigate via `psql` (or Supabase Studio SQL):
   ```sql
   SELECT * FROM supabase_migrations.schema_migrations WHERE version = '20260506';
   ```
   If it's a malformed duplicate of `20260506000000` or `20260506000001` (which both exist properly), DELETE the malformed row:
   ```sql
   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260506';
   ```

4. **Validate clean state:**
   ```bash
   npx supabase migration list
   ```
   Expected: every Local row has matching Remote row. No unmatched rows.

5. **Test future db push works:**
   Create a tiny no-op migration file `supabase/migrations/<NEW_TS>_phase_1_3c_drift_repair_marker.sql`:
   ```sql
   -- Phase 1.3c marker — proves db push pipeline restored
   COMMENT ON SCHEMA public IS 'CropsIntel V3 — Phase 1.3c drift repair complete';
   ```
   Run `npx supabase db push`. Expect success.

If step 5 fails, the drift isn't fully fixed — write notes and ping Muzammil.

### 3. Frontend build + deploy to GitHub Pages

**Problem:** Phase 1.3a/b shipped React + edge function code. The React app needs to be built and the bundle deployed.

**Fix:**

1. Verify `.env` file at repo root has correct values (use `.env.example` as template):
   ```
   VITE_SUPABASE_URL=https://hzrnohsxigrqlmzegwlb.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_6Okgwer13OJzhOf1PtGafA_zMf6oujt
   VITE_ATLAS_URL=https://courteous-simplicity-production.up.railway.app
   VITE_ATLAS_API_TOKEN=cropsintel-atlas-token-2026-04-30
   ```
   These are also in GitHub Actions repo secrets (per SECRETS.md notes). The CI workflow injects them at build time.

2. Run `npm install` (if dependencies changed), then `npm run build`. Expect clean build.

3. Verify the GitHub Pages CI workflow at `.github/workflows/deploy.yml` is configured. If absent, create it (basic Vite + GH Pages workflow per V3-CODING-INSTRUCTIONS conventions). Builder uses standard GH Pages action.

4. Push to main. CI builds and deploys. Verify at `https://muzammil691.github.io/cropsintel-v3/` within ~2 min.

5. **DO NOT** point `cropsintel.com` DNS at this yet. Phase 1.15 handles DNS cutover; for now, V3 lives at the github.io URL only.

### 4. End-to-end smoke test

**Problem:** No human has actually tried signing up as a real customer yet.

**Fix:** Builder writes a smoke test SCRIPT (not Playwright e2e — those exist already). Just a bash + curl validation that proves the deployed system works:

`scripts/smoke-test-v1-alpha.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SUPABASE_URL="https://hzrnohsxigrqlmzegwlb.supabase.co"
ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}"
TEST_PHONE="${TEST_PHONE:-+971562556592}"  # Muzammil's WhatsApp

echo "1. Test guest-gate start (anonymous, no JWT)"
START=$(curl -fsS -X POST "$SUPABASE_URL/functions/v1/guest-gate" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d '{"action":"start"}')
echo "   ✅ start: $START"
GUEST_ID=$(echo "$START" | jq -r '.guest_id')

echo "2. Test record-deep increments count"
COUNT=$(curl -fsS -X POST "$SUPABASE_URL/functions/v1/guest-gate" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d "{\"action\":\"record-deep\",\"guest_id\":\"$GUEST_ID\"}")
echo "   ✅ count: $COUNT"

echo "3. Test whatsapp-send-otp"
OTP=$(curl -fsS -X POST "$SUPABASE_URL/functions/v1/whatsapp-send-otp" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d "{\"phone\":\"$TEST_PHONE\"}")
echo "   ✅ OTP send: $OTP"

echo "4. Manual step: check WhatsApp on $TEST_PHONE for code from +19862022080"
echo "   Then run: ./scripts/smoke-test-v1-alpha.sh verify <code>"
```

Builder runs this script as part of acceptance. Output is saved to spec log.

**Manual step for Muzammil:** receive WhatsApp OTP on his phone, run verify subcommand of script. Spec log captures the full happy path.

### 5. Update runtime-state.md with results

Builder updates `.agent/runtime-state.md`:
- Edge function verify_jwt now `false` for the 5 public funcs
- Migration drift status: clean
- Frontend deployed: yes, at github.io URL
- Smoke test status: passed (or failed with notes)
- Open issues from Phase 1.3c: none (or list)
- Next phase ready: 1.4

### 6. Notify Muzammil

After all 4 above succeed, Atlas sends WhatsApp to `+971562556592`:

> "✅ Phase 1.3c shipped. V3 is live in preview at https://muzammil691.github.io/cropsintel-v3/. End-to-end smoke test passed (OTP delivered to your WhatsApp from +19862022080). Migration drift fixed. Edge functions reconfigured. Ready for Phase 1.4 — should I plan and queue?"

Atlas waits for "yes" / "no" / "later" reply before queuing Phase 1.4.

## Acceptance criteria

- All 5 rules satisfied.
- `supabase/config.toml` has verify_jwt = false for 5 public functions.
- All 5 edge functions redeployed and accept anonymous calls.
- Migration drift cleaned: `npx supabase migration list` shows no unmatched rows.
- Test no-op migration via `db push` succeeds.
- Frontend builds clean: `npm run build` exits 0.
- GitHub Pages deploy succeeds: site loads at `https://muzammil691.github.io/cropsintel-v3/`.
- Smoke test passes end-to-end: Muzammil receives OTP on his WhatsApp.
- `.agent/runtime-state.md` updated with results.
- Atlas WhatsApp notification sent to Muzammil.
- Spec lands in `done/`.

## Out of scope

- DNS cutover (Phase 1.15).
- V2 customer WhatsApp number switchover (Phase 1.15).
- New features (this is unblock + verify only).
- Frontend visual polish (Phase 1.5).
- Phase 1.4 RBAC audit (next phase).
- 13-module Zyra (Phase 1.10).

## Manual steps (Muzammil-side, post-ship)

1. Receive WhatsApp OTP on `+971562556592` from `+19862022080` during smoke test
2. Verify OTP in script if Builder asks
3. Visit `https://muzammil691.github.io/cropsintel-v3/` and click around
4. Reply yes/no/later to Atlas's WhatsApp asking about Phase 1.4

## Files touched

- `supabase/config.toml` — add 5 [functions.X] sections
- `supabase/migrations/<TS>_phase_1_3c_drift_repair_marker.sql` — 1-line marker migration
- Possibly `supabase/migrations/*.test.sql` — DELETE these
- `scripts/smoke-test-v1-alpha.sh` — new smoke-test script
- `docs/phase-1.3c-manual-steps.md` — Muzammil instructions
- `.agent/runtime-state.md` — updated with results
- Possibly `.github/workflows/deploy.yml` — if missing, create

Total: **~6-8 files**

## Realistic Builder time

Smaller than 1.3a/b. Mostly config + ops. **20-30 min Builder**, ~5 min Verifier, ~3 min Designer. Wall clock ~35 min. Cost ~$5.

## Dependencies

- Phase 1.3a shipped ✅
- Phase 1.3b shipped ✅
- Phase 1.10ba cockpit polish shipped ✅
- All Twilio secrets set ✅
- All edge functions deployed ✅
- All migrations applied to remote ✅
- Muzammil's phone ready to receive smoke-test OTP

After 1.3c ships and Atlas notifies Muzammil:

**If Muzammil approves:** Atlas plans Phase 1.4 (RBAC audit) → queues spec → Builder ships → Atlas notifies again.

**Phase boundaries are approval points.** Atlas plans + queues the next phase only after explicit "yes" from Muzammil. This pattern is the autonomous-plan-then-execute mode.
