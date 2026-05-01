---
priority: 1
depends-on: []
---

# Task: Phase 1.10ai — Apply pending Supabase migrations + auto-push on boot

**Context:** 12 migrations are committed in `supabase/migrations/` but were never applied to the production DB. This causes silent runtime failures across services:

- **Atlas trust-mode** can't persist (`atlas_config` table missing → `setMode` falls back to in-memory only → mode reverts to env-default on every redeploy)
- **Designer audit log** writes fail (`designer_runs` table missing → every audit logs `Could not find the table 'public.designer_runs' in the schema cache`)
- **Atlas events / drAtlas SDK** has nowhere to write (`atlas_events` from 1.10z missing)
- **Atlas voice prefs / pending specs / dispatch verification / workflow trace** all missing tables
- **Brain backend (1.10aa)** tables missing if they're added in this batch

**Verified missing tables on Supabase (2026-05-01):**
```
$ curl https://hzrnohsxigrqlmzegwlb.supabase.co/rest/v1/atlas_config
{"code":"PGRST205","message":"Could not find the table 'public.atlas_config' in the schema cache"}
```

The root cause: `agent/agent-loop.sh` line 100-101 runs `supabase link` but NOT `supabase db push`. Migrations get committed by Builder during task ships but never reach the DB.

**Estimated effort:** ~10 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Add migration push to agent-loop boot

Edit `agent/agent-loop.sh` — right after the existing `supabase link` block (currently around line 101), add:

```bash
# Apply any pending migrations that were committed but never pushed to the DB.
# Without this, services depending on new tables (atlas_config, designer_runs,
# atlas_events, etc.) fail at runtime even though the migration .sql files exist.
echo "$LOOP_TAG pushing pending supabase migrations"
if supabase db push --include-all --yes 2>&1 | tee /tmp/supabase-push.log | tail -20; then
  echo "$LOOP_TAG supabase db push ok"
else
  echo "$LOOP_TAG WARN: supabase db push failed — see /tmp/supabase-push.log" >&2
fi
```

### Part B — One-shot apply of all pending migrations

As part of completing this task, before commit, run from the repo root in Builder's container:

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF" 2>/dev/null || true
supabase db push --include-all --yes
```

This applies all 12+ pending migrations immediately so the next service redeploy (Designer, Atlas, etc.) sees the tables.

Expected migrations to apply (in order):
- `20260430000000_atlas.sql`
- `20260430000001_atlas_config.sql`  ← unblocks Atlas trust-mode
- `20260430000002_designer.sql`
- `20260501010000_atlas_dispatch_verification.sql`
- `20260501020000_atlas_pending_specs.sql`
- `20260501030000_atlas_voice_prefs.sql`
- `20260501030001_atlas_voice_storage.sql`
- `20260501040000_atlas_config_rls_check.sql`
- `20260501040000_atlas_loop_health_columns.sql`
- `20260501070000_atlas_events.sql`  ← unblocks drAtlas SDK
- `20260501080000_atlas_workflow_trace_view.sql`
- `20260501120000_designer_runs.sql`  ← unblocks Designer audit log
- (any new ones the brain-tables / pd-tables specs added)

If `supabase db push` reports specific files as already applied (because the user manually ran them in past sessions), that's fine — it's idempotent.

### Part C — Verification

After push, verify by hitting the REST API:
```bash
curl -sS "https://hzrnohsxigrqlmzegwlb.supabase.co/rest/v1/atlas_config?select=key" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY"
# Should return [] not a PGRST205 error.

curl -sS "https://hzrnohsxigrqlmzegwlb.supabase.co/rest/v1/designer_runs?select=count" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Prefer: count=exact" -I
# Should return HTTP/2 200 with content-range header.
```

Both must return success. Log the verification output in the commit body.

## Files

- `agent/agent-loop.sh` (extend — add `supabase db push` after `supabase link`)

## Success criteria

- `npm run build` passes (no code changes, just shell script — but run it anyway to keep the gate honest)
- `agent/agent-loop.sh` has the `supabase db push --include-all --yes` block right after `supabase link`
- After Builder runs the one-shot command, REST API returns 200 (not PGRST205) for `atlas_config` and `designer_runs`
- Commit body includes the verification output showing tables exist
- Next Builder restart logs `[builder-loop] supabase db push ok` (visible in Railway logs for `cropsintel-v3` service)

## Risks + mitigations

- **Risk:** `supabase db push` could try to re-apply already-applied migrations and conflict. **Mitigation:** Supabase tracks applied versions in `supabase_migrations.schema_migrations`; if a version is already there, push skips it. The `--include-all` flag tells it to push all files, but the per-file SQL is idempotent (`CREATE TABLE IF NOT EXISTS`, etc.).
- **Risk:** A migration file has a SQL error. **Mitigation:** push reports the failing file; we fix it in a follow-up spec. The other migrations in the batch still apply (push processes one at a time).
- **Risk:** `SUPABASE_DB_PASSWORD` env var isn't set in Builder. **Mitigation:** Already verified present via `railway variables --service cropsintel-v3`.

## NEVER list

- Never run `supabase db reset` — that wipes all data.
- Never skip the `--yes` flag in CI — but DO use it here, since the loop is non-interactive.
- Never commit without verifying both `atlas_config` and `designer_runs` are reachable via REST.
