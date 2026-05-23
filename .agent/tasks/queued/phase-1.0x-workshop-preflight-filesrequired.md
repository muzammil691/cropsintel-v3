---
priority: 2
source: ADR-2026-05-23-verifier-cluster-7da23cc3f830 §5 priority-2
---
# Task: Workshop pre-flight refuses specs with empty `filesRequired`

## Background

Diagnosed in `docs/atlas-decisions/ADR-2026-05-23-verifier-cluster-7da23cc3f830.md`
§3.1: the original `phase-1.2c-foundation-audit-rerun` spec was queued
with a title-only body. The Workshop did not catch this and the
Verifier deterministically failed three attempts in a row on
`empty-diff-guard`.

## Goal

Before a task spec is moved into `.agent/tasks/queued/`, run
`parseTaskSpec` against the candidate body. Refuse the queue if:

- `spec.filesRequired.length === 0` **and**
- the spec frontmatter does NOT carry `audit-only: true` (e.g. a
  cluster investigation where the deliverable is a markdown ADR
  rather than a code diff)

On refusal, write a stub `.agent/questions/<task-id>-q.md` and STOP
(per the system prompt §6 question contract), so a human reviews the
spec before queue-out.

## Acceptance criteria

1. The Workshop entrypoint (`atlas/src/workshop/` — exact file TBD by
   the Builder) gains a `validateQueueCandidate(specPath)` step that
   gates the `mv` into `.agent/tasks/queued/`.
2. `audit-only: true` is documented in `V3-CODING-INSTRUCTIONS.md` as
   the explicit escape hatch for investigation-style specs.
3. A test under `atlas/src/workshop/` covers:
   - reject empty-filesRequired without `audit-only`
   - accept empty-filesRequired WITH `audit-only`
   - accept non-empty filesRequired regardless of `audit-only`
4. `npm run build` is green at the root.

## Files required

- `atlas/src/workshop/queue-validator.ts` — new pre-flight module (path TBD; verifier expects backticked candidate)
- `atlas/src/workshop/queue-validator.test.ts` — unit tests
- `V3-CODING-INSTRUCTIONS.md` — document `audit-only` frontmatter flag

## Out of scope

- Reworking the conductor's queue scan
- Bulk-tagging existing investigation specs (one-shot manual step)

## Status

Queued under cluster `7da23cc3f830`, rem2 (2026-05-23). This is the P2
follow-up from ADR `docs/atlas-decisions/ADR-2026-05-23-verifier-cluster-7da23cc3f830.md`
§5 priority-2 and re-indexed in ADR §9. Catches the upstream contract
gap at authoring time so future title-only specs cannot reach the
Verifier in the first place.
