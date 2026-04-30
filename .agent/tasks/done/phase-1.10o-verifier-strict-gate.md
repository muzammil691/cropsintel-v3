# Task: Phase 1.10o — Verifier strict gate + automatic remediation

**Master plan reference:** Production-house quality loop completion — close the gap where Verifier finds issues but they don't auto-loop back to Builder.
**Context:** Today's Verifier gate threshold is 0.7 — fails below that confidence push through with a warning. Worse, even when blocked, no remediation task is queued automatically. Builder ships, Verifier flags, nothing happens. This task closes the loop.
**Estimated effort:** ~45 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

1. Lower Verifier gate threshold from 0.7 to **0.3** (any moderately-confident fail blocks)
2. ALWAYS auto-queue a remediation task on block (regardless of confidence)
3. Implement remediation attempt counter — after 3 failed attempts, escalate to user via WhatsApp instead of queueing a 4th
4. Tune Verifier to reduce false positives so the strict threshold doesn't cause noise

## Changes to agent-loop.sh

Replace the existing `run_verifier_gate()` function with this stricter version:

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

  local verdict=$(echo "$response" | jq -r '.verdict // "unknown"')
  local confidence=$(echo "$response" | jq -r '.confidence // 0')
  echo "$LOOP_TAG verifier verdict: $verdict (confidence $confidence)"

  if [ "$verdict" = "pass" ]; then
    return 0
  fi

  if [ "$verdict" = "fail" ]; then
    # NEW: lowered threshold to 0.3 (was 0.7)
    local STRICT_THRESHOLD="${VERIFIER_FAIL_CONFIDENCE_THRESHOLD:-0.3}"
    local should_block=$(awk -v c="$confidence" -v t="$STRICT_THRESHOLD" 'BEGIN { print (c >= t) ? "true" : "false" }')

    if [ "$should_block" = "true" ]; then
      echo "$LOOP_TAG verifier BLOCKED push (fail conf=$confidence ≥ $STRICT_THRESHOLD)"

      # Count existing remediation attempts for this task
      local rem_count=$(ls .agent/tasks/{queued,in-progress,failed,done}/ 2>/dev/null | grep -c "^${task_id}-remediation-" || echo 0)
      local MAX_REMEDIATION_ATTEMPTS="${MAX_REMEDIATION_ATTEMPTS:-3}"

      if [ "$rem_count" -ge "$MAX_REMEDIATION_ATTEMPTS" ]; then
        echo "$LOOP_TAG max remediation attempts ($MAX_REMEDIATION_ATTEMPTS) reached for $task_id — escalating to user"
        # Revert and escalate
        git reset --hard "$head_before"
        /usr/local/bin/notify-whatsapp.sh "🚨 $task_id failed $MAX_REMEDIATION_ATTEMPTS remediation attempts. Verifier confidence: $confidence. NEEDS YOUR EYES — see verifier_runs and .agent/tasks/failed/" || true
        return 1
      fi

      # Queue remediation with rich context
      git reset --hard "$head_before"
      local rem_num=$(printf "%03d" $((rem_count + 1)))
      local rem_file=".agent/tasks/queued/${task_id}-remediation-${rem_num}.md"

      cat > "$rem_file" <<EOF
# Task: ${task_id} remediation ${rem_num} of ${MAX_REMEDIATION_ATTEMPTS}

**Reason:** Verifier blocked push at $(date -u +%FT%TZ)
**Original task:** ${task_id}
**Verifier verdict:** fail (confidence: $confidence)
**Attempt:** $((rem_count + 1)) of $MAX_REMEDIATION_ATTEMPTS

## Gaps Verifier identified

$(echo "$response" | jq -r '.gaps[] | "### \(.severity // "medium"): \(.check // "general")\n- **Description:** \(.description)\n- **Fix:** \(.fix)\n"' 2>/dev/null || echo "$response")

## AI Judgment context

$(echo "$response" | jq -r '.ai_judgment // "" | if type == "object" then to_entries[] | "**\(.key):** \(.value | tostring | .[0:500])" else . end' 2>/dev/null)

## Action

Re-attempt the original task spec at \`.agent/tasks/done/${task_id}.md\` (or wherever it landed), addressing EACH gap above. Do not skip any.

After fixes, the new commit will be re-audited by Verifier. If gaps remain, this task will spawn another remediation. If $MAX_REMEDIATION_ATTEMPTS attempts fail in a row, the cycle escalates to the user.

EOF
      git add "$rem_file" && git commit -m "verifier: queue remediation $rem_num/$MAX_REMEDIATION_ATTEMPTS for $task_id (conf=$confidence)" && git push origin main || true

      /usr/local/bin/notify-whatsapp.sh "🔍 Verifier blocked $task_id — remediation $rem_num/$MAX_REMEDIATION_ATTEMPTS queued (conf $confidence)" || true
      return 1
    else
      # Even sub-threshold fails get queued for remediation, just don't block
      echo "$LOOP_TAG verifier soft-fail (conf $confidence < $STRICT_THRESHOLD) — pushing but flagging for review"
      /usr/local/bin/notify-whatsapp.sh "⚠️ $task_id pushed despite verifier soft-fail (conf $confidence). Review verifier_runs." || true
      return 0
    fi
  fi

  echo "$LOOP_TAG verifier returned unknown verdict '$verdict', pushing anyway"
  return 0
}
```

## Required env vars on cropsintel-agent (Builder) Railway service

- `VERIFIER_FAIL_CONFIDENCE_THRESHOLD=0.3` (down from 0.7)
- `MAX_REMEDIATION_ATTEMPTS=3`

Document this in `.agent/questions/phase-1.10o-q.md` so user knows to add them.

## Verifier-side improvements (false positive reduction)

The strict threshold WILL cause noise unless Verifier is tuned. Expand `verifier/src/checks/` with:

### 1. Spec-aware path normalization

Already partially done in 1.00b1. Extend to:
- Recognize that route paths in spec (e.g., `<Route path="/atlas">`) match React Router file imports, not literal directory existence
- Treat `<NotImplemented>` placeholders as valid for FUTURE phase routes (only fail if THIS spec was supposed to replace them)

### 2. Backend vs frontend route confusion

Verifier confused `/atlas/mode` (backend API) with frontend route. Add a check:
- If a path starts with `/atlas/`, `/api/`, etc. AND spec talks about server.ts, treat as backend
- Frontend routes only checked if spec explicitly says `<Route path=...`

### 3. Optional artifacts

Specs marked "(optional)" in items list shouldn't fail audit. Parse spec markdown for "(optional)" markers and skip those.

### 4. Multi-file feature detection

When spec lists 13 files but Builder ships them across 2-3 commits, Verifier should look at the FULL diff range, not just the last commit. Already mostly correct but verify.

## Acceptance criteria

After this task ships:

1. `agent/agent-loop.sh` updated with the new `run_verifier_gate()` (or replace if exists).
2. `.env.example` or `agent/CLAUDE.md` documents the two new env vars.
3. Synthetic test: deliberately push a broken UI commit. Verifier flags it (confidence > 0.3). agent-loop reverts, queues `<task>-remediation-001.md`, push notification sent. ✓
4. Continue test: synthetic remediation 1 fails too → remediation-002 queued. Same for 003. After 003, escalation WhatsApp sent — no remediation-004. ✓
5. Sub-threshold soft-fail (confidence 0.2): push goes through with WhatsApp warning. ✓
6. Verifier false-positive rate measurably reduced: re-audit 1.10j/k/l (which previously had false alarms). With the new tuning, those audits should pass.

## Out of scope

- AI-generated remediation summaries (use the gap descriptions verbatim)
- Per-gap severity-weighted threshold (use single threshold for v0.1)
- Skipping remediation for known-flaky tasks (tighten later if a problem)

## Notes

- 0.3 threshold is INTENTIONALLY low. It will catch more issues but rely on tuned Verifier checks to not over-flag.
- The 3-attempt cap prevents infinite remediation loops.
- Once this ships, Atlas conductor (1.10p) reads the verifier_runs + remediation patterns to understand health.
- Combined with 1.10p's auto-remediate, the loop closes: spec → ship → audit → fix-or-escalate → never silently bad.
