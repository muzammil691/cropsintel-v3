# Task: Phase 1.10x — Loop intelligence + Designer always-on

**Master plan reference:** Atlas master spec §6 (multi-brain), §7 (tools), §10 (status snapshot writer). User directive 2026-05-01: fix the autonomous loop's intelligence; Designer agent should always govern UI for best view.
**Context:** The current `agent/agent-loop.sh` is a robust worker but a dumb scheduler. Picks specs alphabetically, no priority, no dependency awareness, no cross-agent loop reasoning. Atlas (1.10p conductor) has the brain but in passive mode it can't act. This spec gives Atlas authority to reorder + gate the queue, declares dependencies in spec frontmatter, makes Designer audit fire on every code-touching commit (not just keyword-matched), and tightens the cross-agent feedback loops so Builder + Verifier + Designer + Memory + Atlas behave as one organism.
**Estimated effort:** ~90 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

1. **Spec frontmatter extension** — every queued spec MAY declare:
   ```yaml
   priority: 1     # 1=urgent, 5=normal, 10=lowest. Default 5.
   depends-on:     # task IDs (filename without .md) that must be in done/ before this picks
     - phase-1.10w-atlas-dashboard-rebuild
   blocks:         # task IDs that should NOT pick before this one
     - phase-1.11-prescription-engine
   ```
2. **Builder respects frontmatter** — `agent/agent-loop.sh:pick_next_task()` no longer picks blindly alphabetically. New algorithm:
   - Read all queued specs' frontmatter
   - Filter out specs whose `depends-on` ids are NOT in `.agent/tasks/done/`
   - Sort remaining by `(priority ASC, filename ASC)` — lower priority number ships first
   - Return head
3. **Atlas reorders the queue** — new tool `builder.set_priority(taskId, priority)` and `builder.set_dependencies(taskId, depends_on)` that edit the spec's frontmatter and auto-commit+push (re-uses `gitCommitAndPush` helper in [atlas/src/lib/tools.ts:12](atlas/src/lib/tools.ts#L12)). Atlas can call these in `auto` mode based on its multi-brain reasoning.
4. **Designer always-on for code changes** — current `is_ui_task()` in [agent/agent-loop.sh:218](agent/agent-loop.sh#L218) keyword-matches filenames; replace with diff-based detection: if `git diff $head_before..$head_after --name-only` contains ANY file under `src/pages/`, `src/components/`, `src/styles/`, or `src/index.css`, Designer audit fires. No more keyword guesswork.
5. **Designer reads design tokens** — Designer's audit prompt is updated to enforce `.agent/design-system.md` (created when 1.10n shipped). Verdict thresholds: `pass ≥ 0.7`, `fail < 0.7`, `unknown` only when service unreachable.
6. **Conductor gets queue-reordering signals** — extend `atlas/src/cron/conductor.ts` heartbeat with one new behavior: when 1.10x signals are present (priority 1 specs queued, dependency violations detected), Atlas re-evaluates queue order; reports proposed re-orders to user in `confirm` mode, applies in `auto`.
7. **Memory ingest after every ship** — currently Memory only ingests on manual trigger. Conductor adds: after every successful ship, call `memory.ingest('github-history')` so Memory sees the new commits within 5 min instead of waiting for next manual call.
8. **Atlas snapshot includes loop health** — extend `atlas/src/cron/snapshot.ts` to write per-snapshot row: `loop_lag_seconds` (time between last queued spec arrival and pickup), `dependency_violations_count`, `priority_inversions_count`. Surfaces "is the loop healthy" answer in dashboard.

## Architecture

```
agent/
└── agent-loop.sh                       (rewrite pick_next_task + is_ui_task)
atlas/
└── src/
    ├── lib/
    │   ├── tools.ts                    (add builder.set_priority, builder.set_dependencies)
    │   ├── frontmatter.ts              (NEW — parse + write YAML frontmatter)
    │   └── ...
    └── cron/
        ├── conductor.ts                (extend with queue-reorder + auto-memory-ingest)
        └── snapshot.ts                 (extend with loop_lag + violation counts)
```

## `agent-loop.sh` changes

Replace `pick_next_task()` with a frontmatter-aware variant. Keep it bash + jq + yq if available, else inline yaml parsing via `awk` (small enough to inline).

```bash
pick_next_task() {
  cd "$REPO_DIR"
  local done_ids
  done_ids=$(ls .agent/tasks/done/*.md 2>/dev/null | sed 's|.*/||;s|\.md$||')

  local candidates=""
  for spec in .agent/tasks/queued/*.md; do
    [ -e "$spec" ] || continue
    local id=$(basename "$spec" .md)
    [ "$id" = "_template" ] && continue

    # Read frontmatter (between leading --- markers)
    local fm=$(awk '/^---$/{f++; next} f==1{print} f==2{exit}' "$spec")
    local priority=$(echo "$fm" | awk -F: '/^priority:/{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2}')
    [ -z "$priority" ] && priority=5

    # Dependency check
    local deps=$(echo "$fm" | awk '/^depends-on:/,/^[a-z]/' | awk '/^[[:space:]]+-/' | sed 's/^[[:space:]]\+-[[:space:]]\+//;s/[[:space:]]*$//')
    local blocked=0
    for dep in $deps; do
      echo "$done_ids" | grep -q "^${dep}$" || blocked=1
    done
    [ "$blocked" = "1" ] && continue

    # Sort key = priority then filename
    candidates="${candidates}${priority} ${spec}\n"
  done

  echo -e "$candidates" | sort -k1,1n -k2,2 | head -1 | awk '{print $2}'
}

is_ui_diff() {
  local head_before="$1"
  local head_after="$2"
  git diff --name-only "$head_before" "$head_after" 2>/dev/null \
    | grep -qE '^src/(pages|components|styles)/|^src/index\.css$'
}
```

Replace the existing `is_ui_task()` callsite in `run_designer_gate()` with `is_ui_diff "$head_before" "$head_after"`.

## Atlas tools additions

```typescript
// atlas/src/lib/tools.ts
export async function builderSetPriority(taskId: string, priority: number): Promise<{ updated: boolean; sha: string }> {
  // Read .agent/tasks/queued/<taskId>.md, parse frontmatter, set priority, write back, commit+push.
  // Validates: priority in [1..10], task exists in queued/ (not in-progress/done/cancelled).
  // ...
}

export async function builderSetDependencies(taskId: string, dependsOn: string[]): Promise<{ updated: boolean; sha: string }> {
  // Same pattern. Validates each dep id exists somewhere (queued / in-progress / done / failed).
}

export async function builderQueueOrder(): Promise<{ order: Array<{ id: string; priority: number; depends_on: string[]; blocked: boolean }> }> {
  // Read all queued specs + their frontmatter + done set, return computed order.
  // Lets Atlas show the user "this is what Builder will pick next."
}
```

Register in `TOOLS` registry. Mark as write tools (subject to trust-mode gating per [atlas/src/lib/dispatch.ts:35](atlas/src/lib/dispatch.ts#L35)).

## Conductor extension

In `atlas/src/cron/conductor.ts` `runHeartbeat()`, after existing 5 behaviors, add:

```typescript
await reorderQueueIfPriorityInversion(state, trustMode)
await memoryIngestAfterShips(state, trustMode)
```

`reorderQueueIfPriorityInversion`:
- Compute current pickup order via `builderQueueOrder`
- If a spec with `priority < current head's priority` exists deeper in queue → priority inversion
- In `confirm` mode: ping user "queue inversion detected; proposing to bump <id> to head"
- In `auto` mode: call `builder.set_priority` to fix

`memoryIngestAfterShips`:
- Look at recent `git log --since="6 min ago"` commits (heartbeat is 5 min)
- If any are `chore(agent): X → done` or `feat: phase-X (autonomous agent...)`, dispatch `memory.ingest` with `source='github-history'`
- Idempotent — Memory dedupes by commit SHA

## Snapshot extension

In `atlas/src/cron/snapshot.ts`, add to `runSnapshot()`:

```typescript
const queueOrder = await builderQueueOrder()
const dependencyViolations = queueOrder.order.filter(s => s.blocked).length
// loopLagSeconds: time between most-recent-queue-add commit and now,
// minus last in-progress pickup — proxy for "how long is Builder behind?"
const loopLag = await computeLoopLag()
await sb.from('atlas_snapshots').insert({
  // existing fields...
  loop_lag_seconds: loopLag,
  dependency_violations_count: dependencyViolations,
})
```

Schema migration:
```sql
ALTER TABLE atlas_snapshots
  ADD COLUMN IF NOT EXISTS loop_lag_seconds int,
  ADD COLUMN IF NOT EXISTS dependency_violations_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS priority_inversions_count int DEFAULT 0;
```

## Files

- `agent/agent-loop.sh` (rewrite `pick_next_task` + `is_ui_task` → `is_ui_diff`)
- `atlas/src/lib/frontmatter.ts` (NEW)
- `atlas/src/lib/tools.ts` (extend)
- `atlas/src/cron/conductor.ts` (extend)
- `atlas/src/cron/snapshot.ts` (extend)
- `supabase/migrations/20260501030000_atlas_loop_health_columns.sql` (NEW)

## Success criteria

- Test: queue two specs `phase-1.99-foo.md` (priority 5) and `phase-1.99-bar.md` (priority 1). Builder picks `bar` first despite alphabetical-after.
- Test: queue `phase-A.md` with `depends-on: [phase-B]` and `phase-B.md`. Builder picks `B` first; `A` stays queued. After `B` ships, Builder picks `A`.
- Test: commit a UI change with filename `tweak-X.md` (no UI keyword). Designer still audits because diff touched `src/components/Button.tsx`.
- Test: in `auto` mode, queue a priority-1 spec while priority-5 specs are ahead → conductor reorders within 5 min heartbeat → Builder picks the priority-1 next.
- `atlas_snapshots` rows show populated `loop_lag_seconds` and `dependency_violations_count`.
- `npm run build` clean for both `agent/` (bash syntax check via `bash -n`) and `atlas/` (tsc).
- Builder still ships 1.10n-w specs unchanged — no regression in alphabetical-default behavior when no frontmatter present.

## Risks + mitigations

- **Risk:** YAML parsing in bash is fragile. **Mitigation:** keep frontmatter format minimal (single-line scalars + simple lists); validate with `bash -n` test fixtures; if `yq` is available in the container, use it; fall back to awk for simple cases.
- **Risk:** Spec author forgets to declare deps → Builder picks too early. **Mitigation:** Atlas's spec-author tool (1.10r) prompts include "declare depends-on for any prerequisite specs"; honesty mode (1.10q) makes Atlas verify before saying "queued".
- **Risk:** Designer always-on slows every commit. **Mitigation:** Designer audit runs in parallel with verifier; 60s timeout already in place; if budget cap hits, gate falls open (existing pattern).
- **Risk:** Reorder loop fights itself. **Mitigation:** `reorderQueueIfPriorityInversion` debounces — same inversion only acted on once per 30 min.

## NEVER list

- Never auto-promote a spec to priority 1 without a stated reason logged to `atlas_decisions`.
- Never let dependency declarations create a deadlock (cycle). Builder detects + escalates.
- Never bypass Designer audit on UI commits — only fall open when Designer service is unreachable (with WhatsApp warning).
- Never override user-set priorities without explicit authorization.
