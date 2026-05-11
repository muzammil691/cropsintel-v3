---
primary-domain: mixed
---
# Task: Phase 1.10bc — CLUSTER investigation re-queue loop cap

model: claude-opus-4-7

**Master plan reference:** §6.3 zombie reaper safeguards; §9.1 conductor re-queue logic — prevent infinite CLUSTER investigation spawn loops  
**Context:** When the zombie reaper force-cancels a CLUSTER investigation spec, the conductor blindly re-queues a new one with no history check, creating runaway loops. In one observed session, 6 CLUSTER investigation specs were spawned for a single cluster. This fix was requested by the operator after discovering the loop via WhatsApp alert volume and manual audit of the `done/` and `cancelled/` directories.  
**Estimated effort:** ~45 min Builder time  
**Model:** claude-opus-4-7

---

## Goal

1. Define a named constant `MAX_CLUSTER_INVESTIGATION_REQUEUES = 2` in a shared constants file.
2. Before the conductor enqueues a new CLUSTER investigation spec, count all existing CLUSTER investigation specs across `done/`, `cancelled/`, `queued/`, and `in-progress/` directories for the same cluster.
3. If the count is `>= MAX_CLUSTER_INVESTIGATION_REQUEUES`, do NOT enqueue a new spec — instead send a WhatsApp alert to the operator with the message: `"CLUSTER investigation loop capped at 2 — manual intervention required"` and halt re-queue for that cluster.
4. If the count is `< MAX_CLUSTER_INVESTIGATION_REQUEUES`, proceed with normal re-queue behaviour (no change to existing happy path).
5. Add a unit test that asserts no re-queue occurs and the WhatsApp alert is triggered when the cap is reached.

---

## Architecture

```
src/
├── constants/
│   └── investigationLimits.ts        ← NEW — MAX_CLUSTER_INVESTIGATION_REQUEUES
├── conductor/
│   └── requeueClusterInvestigation.ts ← extend — add cap-check before enqueue
├── utils/
│   └── countSpecsByTypeAndCluster.ts  ← NEW — counts specs across all state dirs
└── alerts/
    └── whatsapp.ts                    ← extend — add sendClusterLoopCapAlert()

tests/
└── conductor/
    └── requeueClusterInvestigation.test.ts ← NEW — unit tests for cap logic
```

---

## Files

- `src/constants/investigationLimits.ts` (NEW) — declares `MAX_CLUSTER_INVESTIGATION_REQUEUES = 2` as a named exported constant; single source of truth for the cap limit
- `src/utils/countSpecsByTypeAndCluster.ts` (NEW) — utility that accepts a spec type (e.g. `"CLUSTER_INVESTIGATION"`) and a cluster ID, then scans `done/`, `cancelled/`, `queued/`, and `in-progress/` directories and returns the total count of matching specs
- `src/conductor/requeueClusterInvestigation.ts` (extend) — wrap the existing enqueue call with a pre-check: call `countSpecsByTypeAndCluster`, compare against `MAX_CLUSTER_INVESTIGATION_REQUEUES`, branch to alert-and-stop or proceed
- `src/alerts/whatsapp.ts` (extend) — add `sendClusterLoopCapAlert(clusterId: string): Promise<void>` that sends the operator the cap-reached WhatsApp message
- `tests/conductor/requeueClusterInvestigation.test.ts` (NEW) — unit tests covering: (a) cap not reached → enqueue called, alert not sent; (b) cap reached → enqueue not called, alert sent exactly once

---

## Schema additions

```sql
-- No schema changes required.
```

---

## Success criteria

- `npm run build` clean with no TypeScript errors.
- When fewer than 2 CLUSTER investigation specs exist across all state directories for a given cluster, the conductor enqueues a new spec exactly as before (no behaviour change on the happy path).
- When 2 or more CLUSTER investigation specs exist across `done/` + `cancelled/` + `queued/` + `in-progress/` for the same cluster, the conductor does NOT enqueue a new spec.
- When the cap is reached, the operator receives exactly one WhatsApp message containing the text `"CLUSTER investigation loop capped at 2 — manual intervention required"`.
- The cap value `2` is referenced exclusively via `MAX_CLUSTER_INVESTIGATION_REQUEUES` — no magic numbers in conductor or utility code.
- Unit test `requeueClusterInvestigation.test.ts` passes: mock returning count=2 → `enqueueSpec` is never called; mock returning count=1 → `enqueueSpec` is called once.

---

## Risks + mitigations

- **Risk:** Directory scan in `countSpecsByTypeAndCluster` is slow if state directories contain many files, adding latency to every re-queue decision. **Mitigation:** Scope the glob/readdir to files whose names contain the cluster ID prefix, keeping the scan O(cluster-specific files) rather than O(all specs).
- **Risk:** Race condition — two conductor workers simultaneously read count=1 and both enqueue, bypassing the cap. **Mitigation:** Document the race as a known limitation in a code comment; a file-lock or atomic DB counter can be added in a follow-up phase if the conductor is ever made concurrent.
- **Risk:** WhatsApp alert call fails (network error), silently swallowing the cap event. **Mitigation:** Wrap `sendClusterLoopCapAlert` in a try/catch that logs the failure to the error log at `ERROR` level so the cap decision is always recorded even if the alert cannot be delivered.
- **Risk:** Future developers change the literal `2` in a test or log message rather than the constant, reintroducing a magic number. **Mitigation:** ESLint `no-magic-numbers` rule scoped to `src/conductor/` and `src/utils/countSpecsByTypeAndCluster.ts` to fail the build on any bare numeric literal in those files.

---

## NEVER list

- Never hardcode the number `2` (or any other cap value) outside of `src/constants/investigationLimits.ts`.
- Never skip the directory count check on the assumption that the zombie reaper will only trigger once per cluster.
- Never suppress or swallow the WhatsApp alert error silently — always log at `ERROR` level if the alert fails to send.
- Never modify the cap-check logic to exclude any one of the four state directories (`done/`, `cancelled/`, `queued/`, `in-progress/`) from the count.
- Never re-queue a CLUSTER investigation spec before the count check completes — the check must be synchronous/awaited before any enqueue call.