---
priority: 1
source: ADR-2026-05-23-verifier-cluster-7da23cc3f830 §5 priority-1
---
# Task: `requeueWithGaps` inherits the most recent remediation body

## Background

Diagnosed in `docs/atlas-decisions/ADR-2026-05-23-verifier-cluster-7da23cc3f830.md`
§3.2: `atlas/src/lib/plan-server.ts` `requeueWithGaps` reseeds every retry
from the title-only original task body, dropping the Builder's enumeration
work from the prior attempt. This violates the anti-restart rule
(V3-CODING-INSTRUCTIONS §0) and is the proximate cause of the
`7da23cc3f830` cluster.

## Goal

When `requeueWithGaps({ taskId, attempt })` runs for attempt N, prefer
the body of the most recent existing remediation file over the
title-only original:

- For `attempt === 2`: read `${rootTaskId}-rem.md` (the rem1 result) if
  it exists in `.agent/tasks/done/` or `.agent/tasks/failed/`. Fall
  back to `${rootTaskId}.md` only if no rem1 exists.
- For `attempt >= 3`: read `${rootTaskId}-rem<N-1>.md` if it exists.
  Fall back to the next-lower rem, then the original.

The body inheritance must preserve the back-ticked file paths added by
the Builder in the prior attempt so that `spec.filesRequired` survives
the requeue.

## Acceptance criteria

1. `atlas/src/lib/plan-server.ts` `requeueWithGaps` is updated per the
   above lookup chain. The frontmatter still increments `attempt`; only
   the body source changes.
2. A unit or integration test under `atlas/src/lib/` covers:
   - attempt=2 reads `-rem.md` not the original
   - attempt=3 reads `-rem2.md` not `-rem.md` or the original
   - fall-through when prior rem is missing
3. `npm run build` is green at the root.

## Files required

- `atlas/src/lib/plan-server.ts` — modify `requeueWithGaps` body lookup
- `atlas/src/lib/plan-server.test.ts` — add new test cases (create if absent)

## Out of scope

- Refactoring the rest of `plan-server.ts`
- Changing the conductor's escalation path
- Touching the Workshop pre-flight (separate spec)

## Status

Queued under cluster `7da23cc3f830`, rem2 (2026-05-23). This is the P1
follow-up from ADR `docs/atlas-decisions/ADR-2026-05-23-verifier-cluster-7da23cc3f830.md`
§5 priority-1 and re-indexed in ADR §9. Largest blast radius of the
three queued fixes; recommended pickup order: this spec first, then the
P2 Workshop pre-flight, then the P3 Verifier sync hardening.
