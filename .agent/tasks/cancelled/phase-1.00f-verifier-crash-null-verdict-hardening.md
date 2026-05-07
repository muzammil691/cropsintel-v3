---
model: claude-sonnet-4.5
phase: 1.00f
status: proposed
primary-domain: analytical
---

# Task: Phase 1.00f — Verifier crash + null-verdict hardening

**Master plan reference:** CropsIntel V3 Master Plan §4 (Atlas Verifier reliability track), follow-up to Phase 1.00e (Verifier integration).

**Estimated effort:** 1.5–2 hours.

**Model:** claude-sonnet-4.5

## Goal

Fix the Verifier crash and null verdict bug. Wrap the Gemini judge in a 3-attempt retry with 2s/4s/8s backoff, fall back to GPT-4o if all 3 Gemini attempts fail. Treat null or undefined verdicts as a hard FAIL (not inconclusive, not pass). Empty diff must return clean FAIL with message not crash. Touch only 2 files.

## Architecture

### Files

- `atlas/src/lib/verifier.ts`: Add null/undefined verdict guard, normalize all returns, handle empty diff case.
- `atlas/src/lib/judges/gemini-judge.ts`: Implement 3-attempt retry with 2s/4s/8s exponential backoff, fallback to GPT-4o judge on all 3 failures.

## Success criteria

1. Empty and whitespace-only diffs return a FAIL verdict with a descriptive message — no crash.
2. Null or undefined Gemini verdicts are treated as hard FAIL — never pass, never inconclusive.
3. Gemini judge retries 3 times with exponential backoff (2s/4s/8s), falling back to GPT-4o on all 3 failures.
4. All errors are logged to console.error — never swallowed silently.
5. Only the 2 specified files are modified — no new files created.

## Risks + mitigations

- **Risk:** GPT-4o fallback judge file may not exist at `atlas/src/lib/judges/gpt4o-judge.ts`.
  - **Mitigation:** Check file exists before referencing. If absent, create it as part of this spec.
- **Risk:** Phase 1.00e may not be fully integrated.
  - **Mitigation:** Verify verifier.ts imports are intact before modifying.

## NEVER list

- NEVER swallow errors silently — all exceptions must be logged.
- NEVER treat null or undefined verdicts as pass or inconclusive — always FAIL.
- NEVER allow an empty diff to trigger an unhandled crash.
- NEVER modify files outside atlas/src/lib/verifier.ts and atlas/src/lib/judges/gemini-judge.ts (except creating gpt4o-judge.ts if absent).
- NEVER call deprecated Gemini model endpoints.
