---
priority: 1
depends-on: []
---

# Task: Phase 1.10ah — Verifier quality fixes (no-boot-retro + stub-detector + context loader)

**Master plan reference:** AUTONOMOUS_BUILD_WORKFLOW_FIX_PLAN.md §3 items 4, 7, 8 (priority CRITICAL + MEDIUM).
**Context:** Verifier has three quality bugs from 2026-05-01 log audit:

**Bug G — Verifier runs `audit-all` against all 47 done specs on every container start.** Takes ~30 min, costs ~$5-10 per restart, and BLOCKS live `/audit` calls during that window. Logs prove this: every spec from 1.6a through 1.10ad shipped with `[agent-loop] verifier verdict: unknown (confidence 0)` because Builder's gate calls were all racing with the boot retro-audit. Net: every recent spec pushed without a real audit. The verifier gate fell open silently.

**Bug H — Stub detector flags `<NotImplemented />` as a defect.** The master plan §11.2 defines NotImplemented as the canonical placeholder for un-built routes. Verifier's `verifier/src/checks/stub-detector.ts` uses regex `<NotImplemented[\s/]` as a "stub indicator" and FAILS specs that intentionally use it (e.g., 1.10k, 1.5a). False positive.

**Bug I — Verifier judges on truncated file content.** Many of the retro-audit failures cite "file not present" or "file truncated mid-function" when the file IS in the repo. Verifier's context loader is hitting a buffer limit and showing the LLM judges only the first N bytes of files. Judges return "missing function" because they didn't see the rest.

**Estimated effort:** ~50 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Disable boot retro-audit by default (Bug G)

1. **Read `verifier/src/index.ts` and `verifier/entrypoint.sh`** to find the `audit-all` startup path.
2. **Gate `audit-all` behind `VERIFIER_RETRO_AUDIT_ON_BOOT` env var** (default `false`):
   ```bash
   # in entrypoint.sh
   if [ "${VERIFIER_RETRO_AUDIT_ON_BOOT:-false}" = "true" ]; then
     echo "[verifier-entrypoint] retro-audit enabled (VERIFIER_RETRO_AUDIT_ON_BOOT=true)"
     exec node dist/index.js audit-all
   else
     echo "[verifier-entrypoint] retro-audit disabled (default); starting server"
     exec node dist/index.js server
   fi
   ```
3. **Default mode = `server`** (HTTP listener for `POST /audit` calls from Builder). Retro-audit only when explicitly opted in.
4. **The env var I added to the Verifier Raw Editor block** (`VERIFIER_RETRO_AUDIT_ON_BOOT=false`) will then take effect on next Verifier redeploy.

### Part B — Stub-detector NotImplemented whitelist (Bug H)

1. **Read `verifier/src/checks/stub-detector.ts`** to find the regex `<NotImplemented[\s/]` (or similar).
2. **Distinguish intentional placeholder from accidental stub:** A `<NotImplemented phase="X" />` usage in a route definition (App.tsx, page-level) is INTENTIONAL — the master plan calls for it. A bare `<NotImplemented />` with no phase prop in arbitrary component code is more suspect.
3. **New rule:** stub-detector must NOT flag `<NotImplemented` if:
   - The file is `src/App.tsx` AND the usage is inside a `<Route element={...} />` prop, OR
   - The file is `src/pages/*.tsx` AND the file has fewer than 30 lines (clearly a placeholder page), OR
   - The component has a `phase=` prop (signals intentional placeholder)
4. **Add a unit test** in `verifier/src/checks/stub-detector.test.ts` (Vitest if available, else inline assertions in test-stub-detector.ts) covering:
   - Bare `<NotImplemented />` in arbitrary code → still flagged (true positive)
   - `<Route path="..." element={<NotImplemented phase="1.6" />} />` in App.tsx → NOT flagged (correct)
   - Placeholder page `src/pages/Insights.tsx` rendering `<NotImplemented phase="1.7" />` → NOT flagged

### Part C — Context loader full-file mode (Bug I)

1. **Read `verifier/src/lib/context-loader.ts`** (or equivalent — file that prepares the codebase context for AI judges).
2. **Find the truncation logic.** Likely a `slice(0, MAX_BYTES)` or similar.
3. **Replace with prioritized loading:**
   - Files mentioned by name in the spec's "Files" section get loaded WHOLE (no truncation).
   - Other files in the diff get truncated to first 5KB if needed.
   - If total context still exceeds budget, drop secondary files entirely (with a `[FILE OMITTED — too long]` marker the judge can interpret as "verifier had no view") rather than truncate critical files mid-function.
4. **Budget allocation:** assume ~150KB total context for o3 / Gemini 2.5 Pro. Spec markdown ~10-30KB. Critical files = 80% of remaining = ~96KB. Secondary = 20%.
5. **Log the loader's decisions:** `[ctx-loader] full: src/App.tsx (4.2KB), full: atlas/src/lib/tools.ts (18.1KB); truncated: agent/agent-loop.sh (5KB of 12KB); omitted: src/lib/database.types.ts (96KB)`. Visibility for debugging false-negatives.

### Part D — One-shot smoke test (acceptance criterion)

After deploy:
1. Queue a tiny test spec `phase-test-verifier-fix.md` with one trivial change (e.g., add a comment to README.md).
2. Builder ships it, calls `/audit`.
3. Verifier returns `pass` (not `unknown`) within 60s.
4. `verifier_runs` table shows the audit row.
5. Test spec marker: `chore: cleanup phase-test-verifier-fix → done` after success.

If Verifier still returns `unknown`, the fix is incomplete; remediate.

## Files

- `verifier/entrypoint.sh` (extend — gate audit-all behind env var)
- `verifier/src/index.ts` (verify CLI subcommand routing for `server` vs `audit-all`)
- `verifier/src/checks/stub-detector.ts` (extend — NotImplemented whitelist logic)
- `verifier/src/checks/stub-detector.test.ts` (NEW — unit tests for the whitelist)
- `verifier/src/lib/context-loader.ts` or equivalent (extend — prioritized loading)
- `.agent/tasks/queued/phase-test-verifier-fix.md` (NEW for smoke test, drop after pass)

## Success criteria

- After fix ships + Verifier redeploys, container logs show `[verifier-entrypoint] retro-audit disabled (default); starting server`. NOT the 30-min audit-all blast.
- Builder's next `/audit` call returns within 60s with verdict `pass` or `fail`, NOT `unknown`.
- Stub-detector unit tests pass — bare `<NotImplemented />` flagged, route-prop usage not flagged.
- Re-run a SAMPLE retro-audit on `phase-1.10k-atlas-dashboard` (which previously failed with stub-detector false positive) → result is now PASS or a different real failure mode.
- Context loader log shows `full: <critical files>` for each audit — no `[FILE TRUNCATED]` on files explicitly named in the spec.

## Risks + mitigations

- **Risk:** Disabling retro-audit means we never re-validate old specs. **Mitigation:** Retro-audit is opt-in via env var. Set `VERIFIER_RETRO_AUDIT_ON_BOOT=true` once a week manually if you want a sweep, or run via `POST /audit-all` HTTP endpoint (add this in same spec for explicit on-demand retro).
- **Risk:** Context loader prioritization is heuristic — might still miss critical files. **Mitigation:** Logs make it visible; iterate on heuristics if failures recur.
- **Risk:** Stub-detector whitelist might be over-broad and let real stubs through. **Mitigation:** Unit tests cover both directions; add test cases when we find new edge cases.

## NEVER list

- Never default to retro-audit on boot — that's what burned us. Opt-in only.
- Never silently truncate a file the spec explicitly names in its "Files" section.
- Never expand the NotImplemented whitelist beyond the three specific cases listed in Part B step 3 — we want defects detected, not papered over.
