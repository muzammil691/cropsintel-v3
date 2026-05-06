---
phase: phase-1.00f
model: claude-sonnet-4-5
status: queued
priority: 1
---

# Task: Phase 1.00f — Verifier Crash Pipeline Hardening

**Master plan reference:** CropsIntel V3 Master Plan §4.2 (Verifier Reliability) and §4.3 (Judge Redundancy)
**Estimated effort:** 1.5–2 hours
**Model:** claude-sonnet-4-5

## Goal

Harden the Verifier crash pipeline:
1. Wrap Gemini judge in 3-attempt retry with exponential backoff (2s → 4s → 8s).
2. If all 3 Gemini attempts fail, fall back to GPT-4o as second judge.
3. Change null/undefined verdict aggregation to hard FAIL — never treat null as inconclusive.
4. Change empty-diff input from crash to clean structured FAIL with explicit message.

Exactly 2 files touched: `atlas/src/lib/judges/gemini-judge.ts` and `atlas/src/lib/verifier.ts`. No new files.

## Files

### `atlas/src/lib/judges/gemini-judge.ts`
- Wrap Gemini API call in retry loop (max 3 attempts, bounded for loop)
- Backoff: attempt 1 → 2s, attempt 2 → 4s, attempt 3 → throw
- Retry only on transient errors (network timeouts, 5xx, 429). Fail fast on 4xx (except 429)
- Each attempt emits structured log: `{ attempt, error_code, backoff_ms }`
- On final failure throw typed `GeminiRetriesExhaustedError`

### `atlas/src/lib/verifier.ts`
- Empty-diff guard: detect empty/whitespace diff → return `{ verdict: "FAIL", reason: "Empty diff — nothing to verify." }`
- Null/undefined verdict guard: if judge returns null/undefined → `{ verdict: "FAIL", reason: "Judge returned null verdict." }`
- GPT-4o fallback: catch `GeminiRetriesExhaustedError` → call existing GPT-4o judge, tag result with `{ fallback: true, original_judge: "gemini" }`

## Success criteria

1. Retry timing: 2-fail + 1-success resolves cleanly, logs show exactly 2 retry entries (2000ms, 4000ms backoff)
2. Gemini exhaustion → GPT-4o fallback called exactly once, result carries `fallback: true`
3. Null verdict → hard FAIL with exact message
4. Undefined verdict → hard FAIL with exact message
5. Empty diff → clean FAIL, no exception thrown
6. Fast-fail on 400 Bad Request — NOT retried
7. Exactly 3 attempts (no more) before GeminiRetriesExhaustedError thrown
8. No new files: `git diff --name-only` shows exactly 2 files
9. All existing tests in `atlas/src/lib/` continue passing

## Risks + mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| `gpt4o-judge.ts` does not exist | High | Verify file exists before starting. If absent, create it first as prerequisite |
| Backoff inflates latency up to 14s worst case | Medium | Retry only on transient errors; document worst-case in JSDoc |
| Retry loop runs indefinitely if counter not incremented | Medium | Use bounded `for` counter, unit test asserts exactly 3 attempts |
| Null-guard breaks callers checking for null | Low | Search codebase for `=== null` on Verifier output before merging |

## NEVER list

- NEVER introduce new files — all changes in exactly 2 named files
- NEVER stub or inline a fake GPT-4o judge — import the real module
- NEVER let null/undefined verdict propagate to aggregator
- NEVER let empty/whitespace diff throw unhandled exception
- NEVER retry on non-transient errors (400, 401, 403, schema errors)
- NEVER exceed 3 retry attempts
