# Phase 1.10bb — Manual deployment steps

These run after each Plan Workshop session lands. Order matters — Session 1
tables must exist before Session 2's loaders run, and `GITLAB_PAT` must be
set before Session 2's `gitlab-client` returns anything other than warnings.

---

## After Session 1 — `feat(workshop): foundation tables for Plan Workshop (1.10bb-a)`

The migration `supabase/migrations/20260511000000_phase_1_10bb_a_workshop_foundation.sql`
ships three tables: `plan_workshop_sessions`, `plan_diffs`, `plan_change_history`.
RLS is enabled (admin reads + service-role writes). Migration drift on the
remote tracker is not yet fully repaired, so apply via Supabase Studio:

1. Open <https://supabase.com/dashboard/project/hzrnohsxigrqlmzegwlb/sql/new>
2. Paste the contents of the migration file.
3. Run.
4. Mark applied locally so future `db push` doesn't re-attempt it:

   ```bash
   cd ~/Documents/Claude/Projects/cropsintel-v3
   npx supabase migration repair --status applied 20260511000000
   ```

Verify the tables exist:

```bash
psql "$SUPABASE_DB_URL" -c "\d+ public.plan_workshop_sessions"
psql "$SUPABASE_DB_URL" -c "\d+ public.plan_diffs"
psql "$SUPABASE_DB_URL" -c "\d+ public.plan_change_history"
```

Expected: each table prints with the columns listed in the migration plus
the indexes (`idx_workshop_sessions_status`, `idx_plan_diffs_session`,
`idx_plan_diffs_pending`, `idx_plan_change_history_diff`).

---

## After Session 2 — `feat(workshop): multi-source context loader (concepts + GitLab + master plan)`

Session 2 introduces the V1 GitLab reader. Without a PAT, V1 reading
silently degrades to "unavailable" in `unavailableReasons` — Atlas
continues working, just without V1 grounding context. To enable V1
reading, set the PAT on the Atlas Railway service.

### 1. Confirm the PAT exists in SECRETS.md

The token lives at:

```
/Users/muzammilakhtar/Documents/Claude/Projects/Cropsintel/SECRETS.md
```

Under the **V1 → Personal access tokens** section, look for
`GITLAB_PAT_atlas_v1_reader = glpat-...`. Created 2026-05-11; scope
`read_repository` on `muzammil69/almond-oracle`.

### 2. Set the env var on Atlas Railway

Atlas runs as the `courteous-simplicity` service in the `generous-possibility`
Railway project. Open the Railway dashboard → the service → Variables tab,
or use the CLI:

```bash
# from any local shell where Railway CLI is logged in
railway variables --service courteous-simplicity \
  --set "GITLAB_PAT=$(grep '^- \*\*\`GITLAB_PAT_atlas_v1_reader\`\*\*' \
    ~/Documents/Claude/Projects/Cropsintel/SECRETS.md \
    | head -1 | sed -E 's/.*= `([^`]+)`.*/\1/')"
```

(If the grep one-liner feels fragile, just paste the value from SECRETS.md
into the dashboard manually — that's also fine.)

Optional overrides if the V1 mirror moves:

```
GITLAB_REPO_OWNER=muzammil69      # default — only set to override
GITLAB_REPO_NAME=almond-oracle    # default — only set to override
GITLAB_REPO_REF=main              # default — only set to override
```

After saving, Railway redeploys the service automatically (~30-60s).

### 3. Verify Atlas can reach V1

Once the redeploy lands, hit Atlas's health-and-context probe (any Workshop
context call exercises this — the cleanest is the smoke endpoint added in
Session 6, but for now just watch the logs after a Workshop session
starts):

```
[gitlab-client] (no warning)
```

If you see `[gitlab-client] GITLAB_PAT not set — V1 repo reader degraded`
in the logs, the env var didn't propagate — re-check the Variables tab.

If you see `[gitlab-client] getFileTree page 1 → HTTP 401` or `403`, the
PAT is set but unauthorized. Check that the PAT scope is `read_repository`
on `muzammil69/almond-oracle` (NOT `muzammil691` — GitHub vs GitLab username
differ by one character).

### 4. (Optional) Rotate the PAT later

The token was inadvertently visible in chat during Session 1 setup. Scope
is `read_repository` only on one V1 repo, so the blast radius is small,
but for hygiene rotate within a few weeks:

1. GitLab → User Settings → Access Tokens → Revoke `atlas_v1_reader`
2. Create a new PAT with the same name and scope, copy the value
3. Update SECRETS.md (under V1 → Personal access tokens) with the new value
4. Update the Railway env var
5. Redeploy

---

## Per-session verifications (quick sanity)

| Session | Smoke check |
|---|---|
| 1 | `psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM plan_workshop_sessions;"` returns 0, no error |
| 2 | After redeploy, no `[gitlab-client] GITLAB_PAT not set` warning in Atlas logs |
| 3 | (added when Session 3 ships) |
| 4 | (added when Session 4 ships) |
| 5 | (added when Session 5 ships) |
| 6 | (added when Session 6 ships) |

---

## What this doc does NOT cover

- Source code review / unit tests — those happen in commits, not here.
- The architecture decisions (Q1-Q5 from the build prompt) — those are
  immutable per the prompt and don't need re-checking after deploy.
- Cost monitoring — the `atlas_cost_log` table tracks spend; no manual
  step needed.

If a step here breaks, check `Atlas Railway service logs` first — Atlas
self-reports loader failures in `unavailableReasons` on every Workshop
context call.
