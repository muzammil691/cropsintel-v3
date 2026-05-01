---
priority: 1
depends-on:
  - phase-1.10z-atlas-events-and-dratlas-sdk
---

# Task: Phase 1.10ad — Verifier research + reloop hardening (7-agent workflow)

**Master plan reference:** §1.6 (Atlas, Adela, Zyra layers), §13.x rule "fix in place"; user directive 2026-05-01: "verifier research and reloop patch."
**Context:** Today's flow when Verifier blocks a push:
1. agent-loop.sh:172 reverts to head_before
2. Writes a remediation spec at `.agent/tasks/queued/<task>-remediation-NNN.md` with the Verifier gaps inlined
3. Builder picks it up next cycle, retries with the gap list

This is a "retry with same prompt + gaps" loop. It works for surface bugs but fails for systemic issues — e.g. a missing migration, a misunderstood master-plan rule, a dependency that's not yet shipped. The user wants smarter remediation: when Verifier fails, the system should RESEARCH (memory.search for prior similar failures + Multi-Brain debate on root cause) BEFORE re-attempting. This is the "research + reloop" pattern.

Plus: the 7 agents (Builder, Verifier, Memory, Council, Adela, Atlas, Designer) currently have implicit handoffs. This spec makes the choreography explicit + observable.

**Estimated effort:** ~80 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Verifier research-driven remediation

When Verifier blocks (per `agent/agent-loop.sh:166-201`), instead of going straight to remediation-spec generation, run a **research step**:

1. **memory.search** for similar past failures: query string built from the failed task's gaps (e.g. "RLS policy missing on commodities table"). Returns similar past patterns + their resolutions.
2. **Multi-Brain debate** (Claude Opus + GPT-4o + Gemini 2.5 Pro) on root cause: prompt = task spec + gaps + memory results. Output: structured `{ root_cause, recommended_fix, related_specs_to_check, confidence }`.
3. Generate remediation spec with research baked in:
   - Original gaps (existing pattern)
   - **NEW**: Root cause analysis section
   - **NEW**: Related specs to verify (Builder reads + considers context from those)
   - **NEW**: Confidence-from-research footer (Builder doesn't blindly retry; if confidence < 0.4, spec waits for human review)

### Part B — 7-agent workflow choreography

Document + enforce the canonical workflow as code:

```
USER REQUEST
   │
   └→ Atlas (chat / WhatsApp / live)
        │
        ├→ memory.search (context grounding)
        ├→ atlas.draft_spec (Council under hood + Multi-Brain review)
        ├→ Designer.review_spec (UI specs only, optional pre-flight)
        └→ atlas.queue_spec (commit+push)
                │
                └→ Builder picks (priority + depends-on aware)
                     │
                     ├→ runs Claude on spec with system prompt + master plan context
                     ├→ Verifier.audit (multi-brain audit)
                     │     ├ pass → continue
                     │     └ fail → research+remediate (NEW from Part A)
                     │
                     ├→ Designer.audit_commit (UI tasks: diff-based, post-Verifier)
                     │     ├ pass → continue
                     │     └ fail → design-remediation queued
                     │
                     ├→ push origin main
                     ├→ Memory auto-ingest after ship (1.10x)
                     └→ Atlas conductor heartbeat detects ship
                          ├→ updates atlas_snapshots
                          ├→ logs to atlas_events (1.10z)
                          └→ WhatsApp notify user (chat/confirm/auto modes)
```

Implement as a runtime-checked invariant in `atlas/src/lib/invariants.ts` (created in 1.10h):
- New invariant: "Every committed spec must have associated verifier_runs row within 5 min of HEAD update."
- New invariant: "Every UI commit must have associated designer_runs row within 5 min."
- New invariant: "Every shipped spec must trigger memory.ingest within 10 min."

Invariant violations log to `atlas_decisions` and ping user via WhatsApp.

### Part C — Workflow visibility

Add to existing 1.10w Atlas dashboard (or as new artifact card type):

- **"Workflow trace" artifact card** — shows the most recent shipped spec's full trace through all 7 agents: who acted, when, with what result. Click to expand timeline.

This needs a new view materialized:

```sql
CREATE OR REPLACE VIEW atlas_workflow_trace AS
SELECT
  d.task_id,
  d.head_after AS sha,
  d.created_at AS shipped_at,
  v.verdict AS verifier_verdict,
  v.confidence AS verifier_confidence,
  dg.verdict AS designer_verdict,
  m.created_at AS memory_ingested_at,
  s.taken_at AS atlas_observed_at
FROM verifier_runs v
LEFT JOIN designer_runs dg ON dg.task_id = v.task_id AND dg.head_after = v.head_after
LEFT JOIN memory_runs m ON m.metadata->>'commit_sha' = v.head_after
LEFT JOIN atlas_snapshots s ON s.taken_at >= v.ran_at AND s.taken_at <= v.ran_at + interval '5 min'
LEFT JOIN atlas_dispatches d ON d.id = v.task_id::uuid
ORDER BY v.ran_at DESC
LIMIT 50;
```

(Adjust JOINs to match actual table FK shapes.)

## Files

- `agent/agent-loop.sh` (extend `run_verifier_gate` to call new research-remediate function)
- `agent/research-remediate.sh` (NEW — bash wrapper that calls a research helper)
- `verifier/src/research.ts` (NEW — exposes `POST /verifier/research` for the bash script to invoke)
- `atlas/src/lib/invariants.ts` (extend — 3 new invariants)
- `atlas/src/cron/conductor.ts` (extend — workflow-trace check per heartbeat)
- `supabase/migrations/20260501080000_atlas_workflow_trace_view.sql` (NEW)
- `src/components/atlas/WorkflowTraceCard.tsx` (NEW — for 1.10w dashboard)
- `src/hooks/useWorkflowTraces.ts` (NEW)

## Success criteria

- Manually queue a spec known to fail Verifier (e.g. "create a `xyz` table without RLS"). Verifier blocks; research step runs (visible in logs); remediation spec includes `Root cause analysis` section; second attempt either succeeds or escalates with confidence < 0.4.
- New invariants detect a missing verifier audit or designer audit and log to `atlas_decisions` within 5 min of ship.
- Atlas dashboard shows a "Workflow trace" card with the latest ship's full 7-agent journey.
- `npm run build` clean for `agent/`, `atlas/`, `verifier/`, root.
- Memory ingest fires automatically within 10 min of every ship (verify 3 specs in a row).

## Risks + mitigations

- **Risk:** Research step adds 30-90s to every Verifier failure. **Mitigation:** runs only on FAIL (not on PASS); cost capped by existing budget gate.
- **Risk:** Multi-Brain debate burns budget on simple fails. **Mitigation:** debate only invoked when verifier_runs.confidence ≥ 0.6 (high-confidence fails — likely systemic); low-confidence fails skip debate.
- **Risk:** Bash → TS bridge fragility. **Mitigation:** verifier service exposes HTTP endpoint; bash uses curl with timeout + fallback.
- **Risk:** Workflow-trace view JOINs slow. **Mitigation:** materialized view refreshed every 5 min; index hotspots.

## NEVER list

- Never auto-skip Verifier audit on UI ships (only fall open if service unreachable, with explicit warning)
- Never let research-remediation infinite-loop (max 3 attempts already enforced; research applies within those 3)
- Never write to atlas_workflow_trace directly — view-only, materialized from canonical tables
