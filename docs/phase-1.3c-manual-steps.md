# Phase 1.3c — Manual deployment steps

After the Phase 1.3c PR lands on `main`, run the following on Muzammil's
workstation (or any host with `supabase` CLI + linked project + the V3
service-role key). Project ref: `hzrnohsxigrqlmzegwlb`.

These steps make V3 usable in preview: the 5 public edge functions stop
requiring a JWT (signup is possible), migration drift is reconciled, and
the end-to-end signup path is exercised against the live deployment.

---

## 1. Redeploy the 5 public edge functions

`supabase/config.toml` now declares `verify_jwt = false` for the public
functions. The deployed runtime still has the old gate (verify_jwt=true)
until each function is redeployed.

```bash
npx supabase functions deploy whatsapp-send-otp
npx supabase functions deploy whatsapp-verify-otp
npx supabase functions deploy auth-bridge
npx supabase functions deploy guest-gate
npx supabase functions deploy zyra-chat
```

Each command should report `verify_jwt: false` in its output. If it still
shows `true`, the config.toml change wasn't picked up — re-run from the
repo root.

**Security note:** verify_jwt=false does NOT mean unsecured. Each function
still validates inputs, rate-limits via `agent_rate_limits`, optionally
runs prompt-defense + input-sanitizer (zyra-chat), and writes audit-log
entries. The flag only controls the gateway-level JWT-or-401 gate; this
must be off for anonymous signup endpoints.

---

## 2. Reconcile migration drift

Drift snapshot (per `npx supabase migration list` 2026-05-09):

| Status | Versions |
|---|---|
| Local-only (applied via Studio, need repair) | `20260507085227`, `20260507120000`, `20260508000000`, `20260508100000`, `20260509085134` |
| Remote-only (malformed) | `20260506` |
| Already repaired | `20260509100000`, `20260509110000` |

### 2a. Mark the 5 local-only migrations as applied

```bash
for ts in 20260507085227 20260507120000 20260508000000 20260508100000 20260509085134; do
  npx supabase migration repair --status applied "$ts"
done
```

### 2b. Investigate + delete the malformed `20260506` remote row

The remote `supabase_migrations.schema_migrations` table has a short-form
row `20260506` that doesn't match any local migration filename. Two
properly-named migrations exist on disk (`20260506000000_atlas_plan_node_state.sql`
and `20260506000001_atlas_schema_complete.sql`), so the short-form row
is almost certainly a malformed duplicate from an early push.

Open the Supabase Studio SQL editor (or `psql`) and run:

```sql
SELECT * FROM supabase_migrations.schema_migrations WHERE version = '20260506';
```

If the row shows no statements (or the same statements as one of the
two properly-named rows), delete it:

```sql
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260506';
```

If the row contains unique statements, stop and ping the agent — it
should not be discarded without review.

### 2c. Verify clean state

```bash
npx supabase migration list
```

Every Local row should have a matching Remote row. No unmatched rows on
either side.

### 2d. Push the no-op marker

```bash
npx supabase db push
```

This applies `supabase/migrations/20260510000000_phase_1_3c_drift_repair_marker.sql`,
a 1-line `COMMENT ON SCHEMA public` statement that proves the db-push
pipeline is restored. If `db push` fails here, the drift isn't fully
fixed — re-investigate step 2b before continuing.

---

## 3. Verify the GitHub Pages deploy

The CI workflow at `.github/workflows/deploy.yml` builds and deploys on
every push to `main`. Once the PR lands:

1. Open `https://github.com/muzammil691/cropsintel-v3/actions` and watch
   the "Deploy to GitHub Pages" run.
2. After ~2 min the site updates at
   `https://muzammil691.github.io/cropsintel-v3/`.
3. Visit the URL — landing should render, navigation should work, and
   the AI agent landing (Phase 1.3b) should be reachable.

**DNS:** do NOT point `cropsintel.com` at this yet. Phase 1.15 handles
DNS cutover; V1.0-alpha lives at the github.io URL only.

---

## 4. Run the end-to-end smoke test

```bash
./scripts/smoke-test-v1-alpha.sh
```

This exercises:

1. `guest-gate` start (anonymous, no JWT) — proves verify_jwt=false took effect.
2. `guest-gate` record-deep — proves the 10-deep counter increments.
3. `whatsapp-send-otp` — sends a Twilio template message to
   `+971562556592` (Muzammil's WhatsApp) from `+19862022080`.

When the WhatsApp message arrives, verify with:

```bash
./scripts/smoke-test-v1-alpha.sh verify <6-digit-code>
```

Expected output: `{"verified": true, ...}` (or similar, depending on the
edge function's response schema). A non-200 or a `verified: false`
result means the OTP path is broken — capture the response and ping the
agent.

---

## 5. Notify Atlas

Once steps 1–4 succeed, Atlas will send a WhatsApp message to
`+971562556592` summarising the phase and asking whether to plan Phase
1.4 (RBAC enforcement audit). Reply `yes`, `no`, or `later`.
