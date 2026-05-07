---
primary-domain: analytical
---
```markdown
---
model: claude-sonnet-4-5
phase: phase-1.00f-verifier-crash-fix
status: draft
owner: atlas-core
---

# Task: Phase 1.00f — Verifier Crash Fix

**Master plan reference:** Atlas Reliability Track → Verifier Hardening (follows phase-1.00e judge integration).
**Estimated effort:** 2–3 hours
**Model:** claude-sonnet-4-5

## Goal

Fix the Verifier pipeline crash that produces `verify_crashed` status on 5+ consecutive runs. Three distinct root causes have been identified and must all be addressed in this phase:

1. **Unhandled Gemini 503 errors** — the Gemini judge throws on transient upstream failures with no retry or fallback, causing the entire Verifier run to crash.
2. **Null verdict short-circuit** — when either judge returns `null` or `undefined`, the pipeline enters an indeterminate state instead of failing safely.
3. **Empty-diff crash** — when a HEAD range produces zero diff lines, the pipeline crashes instead of returning a clean negative result.

All three fixes are confined to existing files. No new files. No UI changes.

## Files

| File | Change |
|---|---|
| `atlas/src/lib/verifier.ts` | Add null/undefined verdict guard (treat as hard `FAIL`); add empty-diff guard returning `{ passed: false, message: "empty diff — nothing to verify" }` |
| `atlas/src/lib/judges/gemini-judge.ts` | Wrap Gemini API call in retry loop: 3 attempts with exponential backoff (2 s / 4 s / 8 s); on final failure, delegate to GPT-4o fallback judge |

No other files may be modified. No new files may be created.

## Success criteria

The following conditions must all be true for this phase to be considered complete. These become Verifier check inputs.

1. **Retry + fallback**
   - Given a Gemini judge that throws 503 on attempts 1 and 2, the system retries at 2 s and 4 s and succeeds on attempt 3 without escalating to fallback.
   - Given a Gemini judge that throws 503 on all 3 attempts, the system delegates to GPT-4o and returns a valid verdict (not a crash).
   - Backoff delays are 2 s, 4 s, 8 s (±100 ms tolerance for test mocking).

2. **Null verdict guard**
   - Given a judge that returns `null`, the Verifier records `{ passed: false, reason: "judge returned null verdict" }` and exits cleanly — no uncaught exception.
   - Given a judge that returns `undefined`, same behaviour as `null`.

3. **Empty-diff guard**
   - Given a HEAD range that produces zero diff lines, the Verifier returns `{ passed: false, message: "empty diff — nothing to verify" }` and exits cleanly — no uncaught exception.

4. **Regression — happy path unchanged**
   - Given a healthy Gemini judge returning a valid verdict on first attempt, existing Verifier logic is unaffected and all pre-existing unit tests pass.

5. **No new files**
   - `git diff --name-only` for this phase lists exactly two files: `atlas/src/lib/verifier.ts` and `atlas/src/lib/judges/gemini-judge.ts`.

6. **No `verify_crashed` status** in any integration smoke test run after the patch is applied.

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GPT-4o fallback itself unavailable during Gemini outage | Low | High | Fallback call is also wrapped in a single-retry (1 attempt, 4 s wait); if fallback also fails, return `{ passed: false, reason: "all judges unavailable" }` — never crash. |
| Backoff delays slow CI significantly | Medium | Medium | In test environments, inject a mock clock / stub `sleep` so delays are zero-cost; backoff constant is read from an env var `VERIFIER_BACKOFF_BASE_MS` defaulting to `2000`. |
| Null-guard masks a real judge bug | Low | Medium | Log a `WARN`-level structured entry (`judge_null_verdict`, including judge name and run ID) before treating as FAIL so the issue remains observable. |
| Empty-diff guard fires on legitimate single-line changes | Low | Low | Guard triggers only when the raw diff byte-length is exactly 0, not when the diff is small. Document this threshold in a code comment. |
| Phase-1.00e judge integration not fully shipped | Low | High | **Dependency check:** confirm `phase-1.00e` is merged and green before starting this phase. If not, block this phase and raise a blocker ticket — do not implement workarounds inline. |
| `gemini-1.5-pro` model deprecation (404) | Confirmed | High | Gemini judge must target a current model string (e.g. `gemini-2.5-pro`). Validate the model endpoint in CI with a lightweight `listModels` probe. The 404 seen in the ADR council run confirms this is an active risk. |

## NEVER list

Builder hard constraints — violating any of these is grounds for immediate rollback:

- **NEVER** create new files. All changes must be within the two files listed in `## Files`.
- **NEVER** modify any UI component, route, or front-end file.
- **NEVER** change the public TypeScript interface/signature of `verifier.ts` exports — only internal behaviour changes.
- **NEVER** swallow errors silently. Every caught exception must be logged at `WARN` or `ERROR` level with structured metadata before the safe fallback value is returned.
- **NEVER** set `VERIFIER_BACKOFF_BASE_MS` to zero in production configuration (only permitted in test stubs).
- **NEVER** treat a fallback GPT-4o verdict as authoritative without logging that the primary judge (Gemini) was unavailable — observability must be preserved.
- **NEVER** merge this phase unless `phase-1.00e` is confirmed shipped and all pre-existing Verifier unit tests remain green.
- **NEVER** target deprecated model endpoints (e.g. `gemini-1.5-pro`). Always use a model string validated against the live `listModels` response.
```