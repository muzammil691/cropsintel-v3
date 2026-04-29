# Task: Phase 1.00b1 — Verifier tuning (eliminate false positives)

**Master plan reference:** Verifier remediation per first audit cycle 2026-04-29
**Context:** First audit found 31 gaps across 6 tasks. Investigation confirmed ALL 31 are false positives caused by an over-strict spec parser and a Gemini judgment that hallucinated missing code. Verifier infrastructure works perfectly — its checks need tuning.
**Estimated effort:** ~3-4 hours
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Tune the Verifier's checks and AI judgment to reduce false positives without weakening real-failure detection. The verifier already correctly identified the 2 PASS cases (phase-0.99 and phase-1.07b). What it failed at was distinguishing literal-spec-text from required deliverables.

## Specific false-positive patterns to fix

### 1. Placeholder filenames in spec text (most common false positive)

The spec parser treats these as required files:
- `supabase/migrations/20260429xxxxxx_verifier.sql` (the `xxxxxx` is a placeholder for the timestamp suffix)
- `.agent/tasks/queued/<task-id>-remediation-NNN.md` (literal pattern showing the format)
- `.agent/tasks/queued/phase-X.YY-name.md` (example pattern)

**Fix in `verifier/src/lib/spec-parser.ts`:**
- When parsing the "Schema additions" section, match the actual migration files in `supabase/migrations/` against the pattern (e.g., any file matching `*_verifier.sql` counts as fulfilling `xxxxxx_verifier.sql`)
- Skip files containing `<...>`, `xxxxxx`, `X.YY`, or `NNN` patterns (these are placeholders)
- Add a `placeholder_patterns` config array: `["xxxxxx", "<task-id>", "<...>", "phase-X.YY", "remediation-NNN"]`

### 2. External read-only path references

The spec mentions paths the agent should READ but not CREATE:
- `~/Documents/Claude/Projects/Cropsintel/cropsintel-v3-master-plan.md`
- `cropsintel-v3/docs/MAXONS_Workflow_v1.md`
- `~/Documents/Claude/Projects/Cropsintel/v3-step2-v1-audit.md`
- `src/lib/runner.js` (V2's source, not V3's)

**Fix in `verifier/src/checks/files-exist.ts`:**
- Skip paths starting with `~/` (user home, not in repo)
- Skip paths that don't start with `/`, `./`, or a known repo-root subdirectory (`src/`, `supabase/`, `.agent/`, `agent/`, `verifier/`, `memory/`, `council/`, `adela/`, `docs/`, `public/`, `.github/`)
- When checking `cropsintel-v3/...` prefix, strip the prefix and check the actual repo root

### 3. Question files (optional artifacts)

`.agent/questions/<task-id>-q.md` is created ONLY if the agent has a blocking question. Absence means everything went smoothly.

**Fix in `verifier/src/lib/spec-parser.ts`:**
- Treat any file in `.agent/questions/` as optional (don't add to required-files list)
- These are explicit fallback artifacts, not deliverables

### 4. Stub-detector flags its own pattern definitions

The check `stub-detector` searches for stub-pattern strings in source files. It correctly finds these patterns... in the file that DEFINES the patterns (`verifier/src/checks/stub-detector.ts`). Self-reflexive false positive.

**Fix in `verifier/src/checks/stub-detector.ts`:**
- Skip the stub-detector source file itself when scanning for patterns
- Add an exclusion list: `[/^verifier\/src\/checks\/stub-detector\.ts$/, /^verifier\/src\/__tests__\//, /^memory\/src\/embed\.ts$/]` (any file that defines stub patterns or imports them as test fixtures should be excluded)

### 5. Gemini judgment hallucination

In phase-1.00a's audit, Gemini claimed `/insights`, `/news`, `/about`, `/pricing` routes were missing from `src/App.tsx`. They were actually present (lines 35-38). Gemini judged based on the spec text without reading the actual file.

**Fix in `verifier/src/verifiers/gemini-2-5-pro.ts`:**
- Strengthen the prompt: "BEFORE making any claim about file contents, you MUST quote the relevant lines from the file you've been given. If you cannot quote the lines, do not make the claim."
- Add a self-check step: after producing the gap list, the prompt asks Gemini to re-read each "missing X" claim and verify by quoting from the supplied file content. If quote unavailable, drop the gap.
- Lower judgment temperature to 0.0 (currently might be default 1.0 — too creative)
- For each suspected gap, include the literal file content (up to 200 lines around the claim) in the prompt, not just the spec

### 6. Path detection — handle absolute vs relative

The spec might say `src/components/NotImplemented.tsx` (relative) or `/src/...` (absolute) or `cropsintel-v3/src/...` (project-prefixed). All should resolve to the same file.

**Fix in `verifier/src/lib/spec-parser.ts`:**
- Normalize all parsed paths to repo-root-relative
- Strip leading `/`, `cropsintel-v3/`, `./` prefixes
- Then check existence against `REPO_ROOT/<normalized-path>`

## Testing this remediation

After implementation, the agent should run:
```
cd verifier && npm test
```

Add test cases that exercise each fix:
- A spec that uses `xxxxxx` should not flag missing files
- A spec referencing `~/Documents/...` should not flag missing files
- A spec mentioning `.agent/questions/...` should not flag missing files
- The stub-detector check on its own file should not flag itself
- A Gemini judgment that claims missing code should be cross-checked against the actual file

## Then re-audit

After remediation ships:
1. Manually trigger `verifier audit-all` against the same 8 tasks
2. Expected: 8/8 pass (or close to it)
3. Any remaining failures should be GENUINE gaps (real missing code, not placeholders)
4. Compare new `verifier_runs` rows against the old ones to confirm false-positive count dropped

## Out of scope

- Don't change the structural Verifier flow (audit-all → write to Supabase)
- Don't change the Verifier's deployment (Dockerfile, entrypoint.sh)
- Don't add new check types (current 7 are enough; just tune them)
- Don't change Council escalation logic

## Acceptance criteria

1. Re-running `verifier audit-all` against the current state of done/ tasks produces ≤3 total gaps across all 8 tasks (down from 31)
2. The 2 tasks that previously passed (phase-0.99-permission-test, phase-1.07b-v1-data-migration) STILL pass
3. Vitest unit tests added for each false-positive pattern fix (5+ new test cases)
4. `npm run build` (V3 root) and `cd verifier && npx tsc` both pass
5. New ADR written to `architecture_decisions` table documenting the tuning decisions
6. Single commit with conventional message: `fix(verifier): eliminate false positives in spec parser + AI judgment`

## Foundation check (BEFORE starting)

- Read the audit results from `verifier_runs` table to see ALL the false positives (10 rows from 2026-04-29)
- Read `verifier/src/lib/spec-parser.ts` to understand current parsing logic
- Read `verifier/src/checks/files-exist.ts`, `routes-wired.ts`, `stub-detector.ts`
- Read `verifier/src/verifiers/gemini-2-5-pro.ts` for the AI judgment prompt

## Notes

- This task IS appropriate for the Verifier to audit itself after shipping (recursive validation)
- After this ships, the Verifier should re-audit ALL of done/ as a sanity check — that auto-runs on next deploy
- A future task (Phase 2 or beyond) might add a Council escalation when both o3 AND Gemini disagree, to break ties more reliably
- Don't be too aggressive in lowering false positives — better to have a few false positives than miss real failures

---

**Done condition:** Verifier produces dramatically fewer false positives without weakening real-failure detection. Re-audit of existing 8 tasks shows ~6-8 PASS instead of 2 PASS.
