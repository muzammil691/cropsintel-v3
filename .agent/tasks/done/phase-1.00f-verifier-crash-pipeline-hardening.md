---
model: claude-sonnet-4-5
phase: phase-1.00f
priority: 1
status: queued
---

# Task: Phase 1.00f — Verifier Crash Pipeline Hardening

**Master plan reference:** CropsIntel V3 Master Plan §4.3 (Atlas Verifier Reliability) and §4.4 (Judge Fallback Strategy)
**Estimated effort:** 1 focused session (~90 min)
**Model:** claude-sonnet-4-5

## Goal

Harden the Atlas Verifier crash pipeline to eliminate silent failures and undefined behaviour in the judge execution path. Specifically:

1. Wrap the Gemini judge in a 3-attempt retry with exponential backoff (2 s / 4 s / 8 s); if all three attempts fail due to network errors, non-2xx responses, or timeouts, fall back to the GPT-4o judge.
2. Treat any null or undefined verdict returned by any judge as a hard `FAIL` — never as `inconclusive`.
3. Return a clean `FAIL` with message `"empty diff — nothing to audit"` when the diff input is empty or whitespace-only; never crash.
4. Catch all unhandled exceptions in the top-level verifier runner and write `passed: false` to the run record instead of allowing the process to crash and leave the record in `verify_crashed` status.

Touch exactly two files. No new files may be created.

## Files

- `atlas/src/lib/verifier.ts` — top-level verifier runner: empty-diff guard, unhandled-exception catch, `passed: false` write-back.
- `atlas/src/lib/judges/gemini-judge.ts` — Gemini judge: retry loop with exponential backoff, GPT-4o fallback, null/undefined verdict normalisation.

## Success Criteria

1. When Gemini judge encounters network error, non-2xx HTTP, or timeout — retries 3 times (2s/4s/8s) then delegates to GPT-4o judge and run completes without crashing.
2. Any null or undefined verdict from any judge resolves to `{ passed: false, reason: "judge returned no verdict" }` — never inconclusive.
3. Empty string or whitespace-only diff returns `{ passed: false, reason: "empty diff — nothing to audit" }` without throwing.
4. All unhandled exceptions caught in top-level runner — `passed: false` persisted to run record — `verify_crashed` status eliminated.
5. Every caught error logged with full stack trace via existing logger before being handled — no error silently discarded.

## Risks + Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| GPT-4o fallback client not yet instantiated in gemini-judge.ts scope | Medium | Import existing shared OpenAI client from atlas/src/lib/openai-client.ts; if absent raise as blocking dependency |
| Gemini model endpoint deprecation (gemini-1.5-pro 404 confirmed) | High | Target gemini-2.0-flash; pin model in named config constant never inline |
| Retry delays blocking event loop | Low | Use await new Promise(r => setTimeout(r, delay)) — non-blocking |
| Exponential backoff exceeding Verifier timeout budget | Low-Medium | Cap total retry wall-time at ~15s (2+4+8+overhead) |
| Silent error swallowing introduced during refactor | Medium | Every catch block must include logger.error call |

## NEVER List

- NEVER create new files — changes confined to the two files listed above.
- NEVER swallow errors silently — every caught exception must be logged with full stack trace.
- NEVER target deprecated Gemini model endpoints (gemini-1.5-pro via v1beta is confirmed 404).
- NEVER resolve null or undefined judge verdict as inconclusive — hard FAIL only.
- NEVER allow top-level verifier runner to propagate unhandled exception.
- NEVER hard-code model identifiers inline — pin in named config constant.
