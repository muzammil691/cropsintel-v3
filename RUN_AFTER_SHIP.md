# RUN_AFTER_SHIP — phase-1.10af workflow quality gates

After this spec ships and Railway redeploys all services, run these 5 steps
in order to verify the loop is healthy. Stop and report if any fails.

1. **Service health (all 6 must return 200):**
   ```bash
   for s in courteous-simplicity zucchini-friendship believable-warmth just-reflection cooperative-rejoicing rare-happiness; do
     curl -s -o /dev/null -w "$s: %{http_code}\n" https://$s-production.up.railway.app/health
   done
   ```

2. **Designer review-spec returns a real verdict (not 401):**
   ```bash
   curl -sX POST https://zucchini-friendship-production-392d.up.railway.app/designer/review-spec \
     -H "Authorization: Bearer cropsintel-designer-token-2026-05-01" \
     -H "Content-Type: application/json" \
     -d '{"task_id":"test-fix","spec_markdown":"# Test"}' | jq .verdict
   ```
   Expect: `"approved"` / `"rejected"` / `"warn"`. NOT 401.

3. **Atlas trust mode survives redeploy:**
   ```bash
   curl -sX POST https://courteous-simplicity-production.up.railway.app/atlas/mode \
     -H "Authorization: Bearer cropsintel-atlas-token-2026-04-30" \
     -H "Content-Type: application/json" -d '{"mode":"chat","setBy":"wp0-test"}'
   # Force a Railway redeploy of atlas-conductor (or just wait through the next Railway maintenance window).
   sleep 90
   curl -s https://courteous-simplicity-production.up.railway.app/atlas/mode | jq .mode
   ```
   Expect: `"chat"`. NOT `"passive"`.

4. **Verifier returns real verdict (not 'unknown'):**
   - Queue a tiny test spec (`echo "# Test\n\nMinimal change." > .agent/tasks/queued/phase-test-verdict.md && git add . && git commit -m "test: verifier verdict" && git push`).
   - Wait 5 min for Builder to ship.
   - Query: `psql $DATABASE_URL -c "SELECT verdict FROM verifier_runs ORDER BY created_at DESC LIMIT 1;"`
   - Expect: `pass` or `fail`, NOT `unknown`.

5. **No git lock errors in Atlas logs:**
   - On Railway dashboard, open Atlas service → Logs → last 30 min.
   - Search for `Unable to create '.git/index.lock'`.
   - Expect: zero entries.

If all five pass, WP-0 is done. Promote Atlas to `confirm` (then later, `auto`) per `claude-code-build-prompt-2026-05-07.md` §0.
