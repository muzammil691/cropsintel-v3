# Task: Phase 1.00f — Wire Verifier as a gate in agent-loop.sh

**Master plan reference:** Production-house closed loop — Verifier blocks bad merges
**Context:** Verifier currently audits commits AFTER they're pushed (passive observer). We want it to gate the push itself — Builder commits, calls Verifier, only pushes if audit passes (or warns once and retries).
**Estimated effort:** ~30 min
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Modify `agent/agent-loop.sh` so that after Claude Code commits a task's changes, the loop calls Verifier's audit endpoint with the task ID + diff range, waits for verdict, and decides:

- **PASS** → push to origin, move task to `done/`
- **FAIL with confidence ≥ 0.7** → revert commit, queue a remediation task (`<task-id>-remediation-001.md`), do NOT push, move original task to `failed/`
- **FAIL with confidence < 0.7** → push anyway (Verifier might be wrong), but flag in `verifier_runs` table with `pushed_despite_warning=true` for human review
- **Verifier unreachable / timeout > 60s** → push anyway (don't block on infra failures), log warning to stderr

## Specific changes to `agent/agent-loop.sh`

### 1. Add env vars

```bash
VERIFIER_URL="${VERIFIER_URL:-https://rare-happiness-production.up.railway.app}"
VERIFIER_API_TOKEN="${VERIFIER_API_TOKEN}"
VERIFIER_GATE_ENABLED="${VERIFIER_GATE_ENABLED:-true}"
VERIFIER_FAIL_CONFIDENCE_THRESHOLD="${VERIFIER_FAIL_CONFIDENCE_THRESHOLD:-0.7}"
VERIFIER_TIMEOUT_SECONDS="${VERIFIER_TIMEOUT_SECONDS:-60}"
```

### 2. Add a `run_verifier_gate()` function

Inserted between the existing commit detection and the `git push origin main` line (around line 234):

```bash
run_verifier_gate() {
  local task_id="$1"
  local head_before="$2"
  local head_after="$3"

  if [ "$VERIFIER_GATE_ENABLED" != "true" ]; then
    echo "$LOOP_TAG verifier gate disabled, pushing without audit"
    return 0
  fi

  echo "$LOOP_TAG calling verifier for task $task_id ($head_before..$head_after)"

  local response
  response=$(curl -sS -m "$VERIFIER_TIMEOUT_SECONDS" \
    -X POST "$VERIFIER_URL/audit" \
    -H "Authorization: Bearer $VERIFIER_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"task_id\":\"$task_id\",\"head_before\":\"$head_before\",\"head_after\":\"$head_after\"}" \
    2>&1) || {
    echo "$LOOP_TAG WARN: verifier unreachable, pushing anyway: $response" >&2
    return 0
  }

  local verdict
  verdict=$(echo "$response" | jq -r '.verdict // "unknown"')
  local confidence
  confidence=$(echo "$response" | jq -r '.confidence // 0')

  echo "$LOOP_TAG verifier verdict: $verdict (confidence $confidence)"

  if [ "$verdict" = "pass" ]; then
    return 0
  fi

  if [ "$verdict" = "fail" ]; then
    # Use awk for float comparison (bash arithmetic is integer-only)
    local should_block
    should_block=$(awk -v c="$confidence" -v t="$VERIFIER_FAIL_CONFIDENCE_THRESHOLD" 'BEGIN { print (c >= t) ? "true" : "false" }')

    if [ "$should_block" = "true" ]; then
      echo "$LOOP_TAG verifier BLOCKED push (fail conf=$confidence ≥ $VERIFIER_FAIL_CONFIDENCE_THRESHOLD)"
      git reset --hard "$head_before"

      # Queue remediation task
      local rem_count
      rem_count=$(ls .agent/tasks/queued/ 2>/dev/null | grep -c "^${task_id}-remediation-" || echo 0)
      local rem_num
      rem_num=$(printf "%03d" $((rem_count + 1)))
      local rem_file=".agent/tasks/queued/${task_id}-remediation-${rem_num}.md"

      cat > "$rem_file" <<EOF
# Task: ${task_id} remediation ${rem_num}

**Reason:** Verifier blocked push at $(date -u +%FT%TZ). Confidence: $confidence
**Original task:** .agent/tasks/failed/${task_id}.md
**Verifier feedback:** see verifier_runs row at $head_after

$(echo "$response" | jq -r '.gaps[] | "- " + .description' 2>/dev/null || echo "$response")

## Action

Re-attempt the original task addressing the gaps above.
EOF
      git add "$rem_file" && git commit -m "verifier: queue remediation for $task_id (conf=$confidence)" && git push origin main || true
      return 1
    else
      echo "$LOOP_TAG verifier FAIL but confidence $confidence < $VERIFIER_FAIL_CONFIDENCE_THRESHOLD, pushing with warning"
      return 0
    fi
  fi

  echo "$LOOP_TAG verifier returned unknown verdict '$verdict', pushing anyway"
  return 0
}
```

### 3. Call the gate before push

Replace the existing block around line 234 (the success branch where Claude Code pushed something):

```bash
if [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
  local CHANGED_FILES=$(git diff --name-only "$HEAD_BEFORE" "$HEAD_AFTER" | grep -v '^\.agent/tasks/' | wc -l | tr -d ' ')
  echo "$LOOP_TAG claude pushed $((CHANGED_FILES)) meaningful files between $HEAD_BEFORE and $HEAD_AFTER"

  # NEW: gate on verifier verdict
  if run_verifier_gate "$TASK_ID" "$HEAD_BEFORE" "$HEAD_AFTER"; then
    git push origin main || {
      echo "$LOOP_TAG WARN: push failed" >&2
    }
    move_task_to_done "$TASK_FILE"
  else
    echo "$LOOP_TAG verifier blocked, not pushing — moving task to failed/"
    move_task_to_failed "$TASK_FILE"
  fi
fi
```

## Verifier service requirements (already exists, just confirm endpoint)

The Verifier service must expose `POST /audit` accepting:
```json
{ "task_id": "phase-X.Y-name", "head_before": "sha", "head_after": "sha" }
```

Returning:
```json
{
  "verdict": "pass" | "fail" | "unknown",
  "confidence": 0.0-1.0,
  "gaps": [{"description": "...", "severity": "high|medium|low"}],
  "audit_run_id": "uuid"
}
```

If this endpoint doesn't exist on the Verifier service today, the agent must add it (in `verifier/src/server.ts`) as part of this same task.

## Required Railway env var additions

Add to **cropsintel-agent** (Builder) service:
- `VERIFIER_URL` = `https://rare-happiness-production.up.railway.app`
- `VERIFIER_API_TOKEN` = (same token used for verifier auth, see SECRETS.md)
- `VERIFIER_GATE_ENABLED` = `true`

These are documented but not auto-set by the agent — the user must add them manually in Railway. Include this requirement in `.agent/questions/<task-id>-q.md` if env vars are missing.

## Files expected to change

- `agent/agent-loop.sh` (main change, ~80 lines added)
- `verifier/src/server.ts` (if `/audit` endpoint not present — add it, wrapping existing `auditTask()` function)
- `agent/Dockerfile` (add `jq` to apt packages for JSON parsing)

## Testing this remediation

After implementation:

1. Builder picks up a known-bad spec (or queue a deliberate test spec that emits an obvious gap).
2. Builder commits the bad code, calls Verifier.
3. Verifier returns `verdict=fail, confidence=0.85`.
4. agent-loop reverts the commit, queues a remediation task, moves original to `failed/`.
5. Original task does NOT appear on `git log origin/main`.
6. Remediation task appears in `.agent/tasks/queued/`.
7. Next loop iteration picks up the remediation task.

## Notes

- `jq` is required. Add `jq` to the agent's apt-get install list in `agent/Dockerfile` if not present.
- The `git reset --hard $head_before` in the agent's loop is safe because the loop owns the working tree fully — no human edits happen here.
- Don't conflate the remediation queue with the failed/ archive. Failed = original task as-attempted; remediation = next attempt.
