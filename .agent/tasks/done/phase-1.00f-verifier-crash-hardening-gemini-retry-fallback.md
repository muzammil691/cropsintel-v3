---
primary-domain: analytical
---
```markdown
---
phase: 1.00f
model: claude-sonnet-4-5
status: draft
owner: atlas-core
---

# Task: Phase 1.00f — Verifier Crash Hardening (Gemini Retry + Fallback)

**Master plan reference:** CropsIntel V3 Master Plan §4.2 "Verifier reliability hardening" (post Phase 1.00e Verifier wiring).
**Estimated effort:** 4–6 engineering hours
**Model:** claude-sonnet-4-5

## Goal

Eliminate all crash and hang paths in the Verifier's Gemini judge integration. Specifically:

1. Wrap the Gemini judge call in a **3-attempt retry loop** with exponential backoff: 2 s → 4 s → 8 s between attempts.
2. If all 3 Gemini attempts fail, **fall back to GPT-4o** for the verdict rather than propagating the error upward.
3. A `null` or `undefined` verdict returned by any judge must resolve to a hard **FAIL** — never `inconclusive` or a silent no-op.
4. An **empty diff** passed to the Verifier must return a clean **FAIL** with a human-readable message rather than throwing an unhandled exception.
5. Errors must never be swallowed silently; every caught error must be logged (at minimum `console.error`) before any fallback or FAIL path is taken.

## Files

### `atlas/src/lib/judges/gemini-judge.ts`

- Add internal retry loop (max 3 attempts) around the Gemini API call.
- Backoff schedule: attempt 1 → wait 2 s → attempt 2 → wait 4 s → attempt 3.
- On each caught error, log the attempt number and error message before sleeping.
- After all 3 attempts are exhausted, **throw** a typed `GeminiJudgeExhaustedError` so the caller (Verifier) can detect it and route to the GPT-4o fallback.
- If the Gemini API returns a response but `verdict` is `null` or `undefined`, throw a `GeminiJudgeExhaustedError` with message `"null verdict returned"` — do not return the null upstream.
- No new files may be created; retry logic lives entirely within this file.

### `atlas/src/lib/verifier.ts`

- Import and catch `GeminiJudgeExhaustedError` from `gemini-judge.ts`.
- On catch, log the exhaustion reason, then invoke the GPT-4o judge as fallback.
- Before invoking any judge, validate the diff argument: if the diff is empty string, `null`, or `undefined`, return `{ verdict: "FAIL", reason: "Empty diff supplied to Verifier — nothing to verify." }` without calling any judge.
- After receiving a verdict from any judge (Gemini or GPT-4o fallback), check for `null`/`undefined`; if found, return `{ verdict: "FAIL", reason: "Judge returned no verdict." }`.
- No new files may be created; all changes are confined to this file.

## Success criteria

The Verifier is considered fixed when **all** of the following are true:

1. **Retry fires:** A Gemini API failure on attempt 1 triggers attempt 2 after ≥ 2 s and attempt 3 after ≥ 4 s from attempt 2; confirmed via logged timestamps or test stubs.
2. **Fallback activates:** After 3 consecutive Gemini failures, GPT-4o is called and its verdict is returned. No unhandled exception propagates to the caller.
3. **Null/undefined verdict → FAIL:** When a judge returns `null` or `undefined`, the Verifier returns `{ verdict: "FAIL" }` with a non-empty `reason` string. No `inconclusive` or crash.
4. **Empty diff → clean FAIL:** Passing an empty string (or `null`) diff to the Verifier returns `{ verdict: "FAIL", reason: <non-empty string> }` without throwing.
5. **No silent swallows:** Every `catch` block in both files contains at minimum a `console.error(...)` call before any fallback logic — confirmed by code review or lint rule.
6. **File scope:** `git diff --name-only` for this phase shows exactly `atlas/src/lib/verifier.ts` and `atlas/src/lib/judges/gemini-judge.ts` — no other files added or modified.
7. **Existing tests green:** The full test suite passes with no regressions introduced.

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| GPT-4o fallback itself fails or returns null | Medium | High | Verifier must treat a null GPT-4o verdict as FAIL (same null-guard already required); log and return FAIL rather than throwing. |
| Retry backoff adds unacceptable latency in CI | Low | Medium | Retry only fires on actual Gemini errors; in CI, stub Gemini to succeed on first attempt. Document that worst-case added latency is 14 s (2+4+8). |
| `gemini-1.5-pro` model name is deprecated (404) | High | High — already causing crashes | Update model name to a currently supported identifier (e.g. `gemini-1.5-flash` or `gemini-2.0-flash`) in `gemini-judge.ts`; confirm with `ListModels` before merging. |
| Dependency gap — GPT-4o judge not yet wired | Low | High | Phase 1.00e is assumed to have shipped the GPT-4o judge. If `gpt4o-judge.ts` does not exist, this phase **must not ship**; create a Phase 1.00e-fix dependency task first. |
| Sleep/backoff implementation blocks event loop | Low | Medium | Use a `Promise`-based `sleep` utility (`await new Promise(r => setTimeout(r, ms))`), not a synchronous spin-wait. |
| Retry loop masks persistent config errors | Low | Medium | Log each attempt's error in full (including status code); if all 3 fail with 4xx (not 5xx/503), consider bypassing retries and going straight to fallback. |

## NEVER list

> Builder hard constraints — violating any item is grounds for immediate task rejection.

1. **NEVER create new files.** All changes must be confined to the two files listed above.
2. **NEVER swallow errors silently.** Every `catch` block must log the error before taking any fallback or recovery action.
3. **NEVER return `inconclusive` for a null/undefined verdict.** Null or undefined must map to `FAIL`.
4. **NEVER let an empty diff reach a judge.** Validate the diff at the Verifier entry point and short-circuit to FAIL before any judge is called.
5. **NEVER remove or bypass existing judge logic** for non-error paths. The retry/fallback is additive; happy-path Gemini calls must behave identically to before.
6. **NEVER hard-code API keys or secrets** in source files. All credentials must be read from environment variables already established in the project.
7. **NEVER modify test files, CI config, or any file outside the two listed** as part of this task. If a test must change to accommodate the fix, flag it for a separate review task.
8. **NEVER use synchronous sleep** (e.g. busy-wait loops). Backoff delays must be `await`-based.
9. **NEVER exceed the 3-attempt cap.** The retry loop must have an explicit maximum of 3 attempts with no configurable override that could silently raise it.
10. **NEVER violate master plan §11.6 NEVER list items** (inherited global constraints supersede all local decisions).
```