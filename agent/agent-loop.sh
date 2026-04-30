#!/bin/bash
# =============================================================================
# CropsIntel V3 — Autonomous Agent Loop
# =============================================================================
# Runs forever in a Railway container.
#
# Every 5 minutes:
#   1. Pull latest from cropsintel-v3 main
#   2. Look in .agent/tasks/queued/ for the next task file (alphabetical first)
#   3. Move it to .agent/tasks/in-progress/
#   4. Invoke Claude Code with the task prompt + V3-CODING-INSTRUCTIONS.md
#   5. Claude Code writes code, runs build, commits when green
#   6. If success: push, move task to .agent/tasks/done/
#   7. If failure: write question to .agent/questions/, ping WhatsApp, move to failed/
#   8. Sleep 5 min, repeat
# =============================================================================

set -e

REPO_URL="${REPO_URL:-git@github.com:muzammil691/cropsintel-v3.git}"
REPO_DIR="/workspace/cropsintel-v3"
# Two sleeps: short when we just finished a task (fast pickup of next), long when idle.
# The active sleep is also a soft floor for git rate-limit hygiene.
ACTIVE_SLEEP_SECONDS="${ACTIVE_SLEEP_SECONDS:-30}"
IDLE_SLEEP_SECONDS="${IDLE_SLEEP_SECONDS:-300}"
# Back-compat: SLEEP_SECONDS still respected if someone sets it (overrides idle).
if [ -n "$SLEEP_SECONDS" ]; then
  IDLE_SLEEP_SECONDS="$SLEEP_SECONDS"
fi
LOOP_TAG="[agent-loop]"

# Verifier gate configuration
VERIFIER_URL="${VERIFIER_URL:-https://rare-happiness-production.up.railway.app}"
VERIFIER_API_TOKEN="${VERIFIER_API_TOKEN:-}"
VERIFIER_GATE_ENABLED="${VERIFIER_GATE_ENABLED:-true}"
VERIFIER_FAIL_CONFIDENCE_THRESHOLD="${VERIFIER_FAIL_CONFIDENCE_THRESHOLD:-0.3}"
VERIFIER_TIMEOUT_SECONDS="${VERIFIER_TIMEOUT_SECONDS:-60}"

# Designer gate configuration (UI tasks only — runs after Verifier passes)
DESIGNER_URL="${DESIGNER_URL:-https://designer-production.up.railway.app}"
DESIGNER_API_TOKEN="${DESIGNER_API_TOKEN:-}"
DESIGNER_GATE_ENABLED="${DESIGNER_GATE_ENABLED:-true}"
DESIGNER_FAIL_CONFIDENCE_THRESHOLD="${DESIGNER_FAIL_CONFIDENCE_THRESHOLD:-0.7}"
DESIGNER_TIMEOUT_SECONDS="${DESIGNER_TIMEOUT_SECONDS:-60}"

# -----------------------------------------------------------------------------
# 0. Bootstrap: SSH key, clone repo
# -----------------------------------------------------------------------------
bootstrap() {
  echo "$LOOP_TAG bootstrap starting at $(date -u +%FT%TZ)"

  # SSH private key from env var → ~/.ssh/id_ed25519
  # Railway env vars sometimes store the key with literal \n strings instead
  # of real newlines, or with CRLF endings. We normalize both before writing.
  if [ -n "$AGENT_SSH_PRIVATE_KEY" ]; then
    # printf '%b' expands \n escape sequences to real newlines if present.
    # tr -d '\r' strips any Windows-style carriage returns.
    printf '%b' "$AGENT_SSH_PRIVATE_KEY" | tr -d '\r' > /home/claudeagent/.ssh/id_ed25519
    # Ensure file ends with newline (OpenSSH requires it)
    [ -z "$(tail -c1 /home/claudeagent/.ssh/id_ed25519)" ] || echo "" >> /home/claudeagent/.ssh/id_ed25519
    chmod 600 /home/claudeagent/.ssh/id_ed25519

    # Validate the key parses correctly. If not, dump diagnostics.
    if ssh-keygen -y -f /home/claudeagent/.ssh/id_ed25519 > /home/claudeagent/.ssh/id_ed25519.pub 2>/dev/null; then
      echo "$LOOP_TAG SSH key written and validated"
      echo "$LOOP_TAG public key fingerprint:"
      ssh-keygen -lf /home/claudeagent/.ssh/id_ed25519
    else
      echo "$LOOP_TAG ERROR: SSH key failed to parse" >&2
      echo "$LOOP_TAG First line: $(head -1 /home/claudeagent/.ssh/id_ed25519)" >&2
      echo "$LOOP_TAG Last line:  $(tail -1 /home/claudeagent/.ssh/id_ed25519)" >&2
      echo "$LOOP_TAG Line count: $(wc -l < /home/claudeagent/.ssh/id_ed25519)" >&2
      exit 1
    fi

    # Add github.com to known_hosts so ssh doesn't prompt
    ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> /home/claudeagent/.ssh/known_hosts 2>/dev/null
    chmod 644 /home/claudeagent/.ssh/known_hosts
  else
    echo "$LOOP_TAG ERROR: AGENT_SSH_PRIVATE_KEY not set" >&2
    exit 1
  fi

  # Required env vars
  for var in ANTHROPIC_API_KEY SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF; do
    if [ -z "${!var}" ]; then
      echo "$LOOP_TAG ERROR: $var not set" >&2
      exit 1
    fi
  done

  # Clone if needed
  if [ ! -d "$REPO_DIR/.git" ]; then
    echo "$LOOP_TAG cloning $REPO_URL"
    git clone "$REPO_URL" "$REPO_DIR"
  fi

  # Login to Supabase
  cd "$REPO_DIR"
  echo "$LOOP_TAG linking supabase project"
  supabase link --project-ref "$SUPABASE_PROJECT_REF" 2>/dev/null || true

  # Install deps once
  if [ ! -d "$REPO_DIR/node_modules" ]; then
    echo "$LOOP_TAG running npm ci (first time)"
    cd "$REPO_DIR" && npm ci
  fi

  # Bootstrap notification REMOVED. Railway containers can restart frequently
  # (deploy churn, idle timeout, OOM), and ephemeral /tmp + /root mean no persistent
  # rate-limit works. WhatsApp spam during restart loops is worse than missing
  # a startup ping. We only notify on task ship/fail/question now.
  echo "$LOOP_TAG bootstrap complete (no startup whatsapp — see logs only)"
}

# -----------------------------------------------------------------------------
# 1. Pick next task
# -----------------------------------------------------------------------------
pick_next_task() {
  cd "$REPO_DIR"
  ls .agent/tasks/queued/*.md 2>/dev/null | grep -v ".gitkeep" | sort | head -1
}

# -----------------------------------------------------------------------------
# 2a. Verifier gate — call before pushing a committed task
# -----------------------------------------------------------------------------
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
    # Lowered threshold to 0.3 (was 0.7) — any moderately-confident fail blocks
    local STRICT_THRESHOLD="${VERIFIER_FAIL_CONFIDENCE_THRESHOLD:-0.3}"
    local should_block=$(awk -v c="$confidence" -v t="$STRICT_THRESHOLD" 'BEGIN { print (c >= t) ? "true" : "false" }')

    if [ "$should_block" = "true" ]; then
      echo "$LOOP_TAG verifier BLOCKED push (fail conf=$confidence >= $STRICT_THRESHOLD)"

      # Count existing remediation attempts for this task across ALL directories
      local rem_count=$(ls .agent/tasks/{queued,in-progress,failed,done}/ 2>/dev/null | grep -c "^${task_id}-remediation-" || echo 0)
      local MAX_REMEDIATION_ATTEMPTS="${MAX_REMEDIATION_ATTEMPTS:-3}"

      if [ "$rem_count" -ge "$MAX_REMEDIATION_ATTEMPTS" ]; then
        echo "$LOOP_TAG max remediation attempts ($MAX_REMEDIATION_ATTEMPTS) reached for $task_id — escalating to user"
        # Revert and escalate — no more remediation queued
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

$(echo "$response" | jq -r '.gaps[] | "### \(.severity // "medium"): \(.check // "general")\n- **Description:** \(.description)\n- **Fix:** \(.fix // "")\n"' 2>/dev/null || echo "$response")

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
      # Sub-threshold fail: push through but flag for review
      echo "$LOOP_TAG verifier soft-fail (conf $confidence < $STRICT_THRESHOLD) — pushing but flagging for review"
      /usr/local/bin/notify-whatsapp.sh "⚠️ $task_id pushed despite verifier soft-fail (conf $confidence). Review verifier_runs." || true
      return 0
    fi
  fi

  echo "$LOOP_TAG verifier returned unknown verdict '$verdict', pushing anyway"
  return 0
}

# -----------------------------------------------------------------------------
# 2a-bis. Designer gate — UI tasks only, runs after Verifier passes
# -----------------------------------------------------------------------------
is_ui_task() {
  local task_name="$1"
  # Filename keywords
  if echo "$task_name" | grep -qiE '(dashboard|page|component|ui|layout|form|modal|widget)'; then
    return 0
  fi
  # Spec content (if file still around in done/ or in-progress/)
  local spec_path=""
  for d in .agent/tasks/done .agent/tasks/in-progress .agent/tasks/queued; do
    if [ -f "$d/$task_name.md" ]; then
      spec_path="$d/$task_name.md"
      break
    fi
  done
  if [ -n "$spec_path" ]; then
    if grep -qiE '(\.tsx|tailwind|shadcn|<Button|<Card|<Input|<Dialog)' "$spec_path"; then
      return 0
    fi
  fi
  return 1
}

run_designer_gate() {
  local task_id="$1"
  local head_before="$2"
  local head_after="$3"

  if [ "$DESIGNER_GATE_ENABLED" != "true" ]; then
    echo "$LOOP_TAG designer gate disabled, skipping"
    return 0
  fi

  if ! is_ui_task "$task_id"; then
    echo "$LOOP_TAG designer gate skipped — non-UI task"
    return 0
  fi

  echo "$LOOP_TAG calling designer for task $task_id ($head_before..$head_after)"

  local response
  response=$(curl -sS -m "$DESIGNER_TIMEOUT_SECONDS" \
    -X POST "$DESIGNER_URL/designer/audit-commit" \
    -H "Authorization: Bearer $DESIGNER_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"task_id\":\"$task_id\",\"head_before\":\"$head_before\",\"head_after\":\"$head_after\"}" \
    2>&1) || {
    echo "$LOOP_TAG WARN: designer unreachable, pushing anyway: $response" >&2
    return 0
  }

  local verdict
  verdict=$(echo "$response" | jq -r '.verdict // "unknown"')
  local confidence
  confidence=$(echo "$response" | jq -r '.confidence // 0')

  echo "$LOOP_TAG designer verdict: $verdict (confidence $confidence)"

  if [ "$verdict" = "pass" ]; then
    return 0
  fi

  if [ "$verdict" = "fail" ]; then
    local should_block
    should_block=$(awk -v c="$confidence" -v t="$DESIGNER_FAIL_CONFIDENCE_THRESHOLD" 'BEGIN { print (c >= t) ? "true" : "false" }')

    if [ "$should_block" = "true" ]; then
      echo "$LOOP_TAG designer BLOCKED push (fail conf=$confidence >= $DESIGNER_FAIL_CONFIDENCE_THRESHOLD)"
      git reset --hard "$head_before"

      # Queue remediation task with design feedback
      local rem_count
      rem_count=$(ls .agent/tasks/queued/ 2>/dev/null | grep -c "^${task_id}-design-remediation-" || echo 0)
      local rem_num
      rem_num=$(printf "%03d" $((rem_count + 1)))
      local rem_file=".agent/tasks/queued/${task_id}-design-remediation-${rem_num}.md"

      cat > "$rem_file" <<EOF
# Task: ${task_id} design remediation ${rem_num}

**Reason:** Designer blocked push at $(date -u +%FT%TZ). Confidence: $confidence
**Original task:** .agent/tasks/failed/${task_id}.md
**Designer feedback:** see designer_runs row at $head_after

## Design gaps to fix

$(echo "$response" | jq -r '.gaps[] | "- [" + .severity + "] " + .check + ": " + .description + "\n  Fix: " + .fix' 2>/dev/null || echo "$response")

## Action

Re-attempt the original task addressing the design gaps above.
Reference: .agent/design-system.md
EOF
      git add "$rem_file" && git commit -m "designer: queue remediation for $task_id (conf=$confidence)" && git push origin main || true
      return 1
    else
      echo "$LOOP_TAG designer FAIL but confidence $confidence < $DESIGNER_FAIL_CONFIDENCE_THRESHOLD, pushing with warning"
      return 0
    fi
  fi

  echo "$LOOP_TAG designer returned unknown verdict '$verdict', pushing anyway"
  return 0
}

# -----------------------------------------------------------------------------
# 2b. Run Claude Code on a task
# -----------------------------------------------------------------------------
run_task() {
  local TASK_FILE="$1"
  local TASK_NAME=$(basename "$TASK_FILE" .md)
  local START_TIME=$(date +%s)

  echo "$LOOP_TAG starting task: $TASK_NAME"

  cd "$REPO_DIR"

  # Capture HEAD before claude runs so we can detect commits made during the task
  local HEAD_BEFORE=$(git rev-parse HEAD)

  # Move task to in-progress
  mkdir -p .agent/tasks/in-progress
  mv "$TASK_FILE" ".agent/tasks/in-progress/$TASK_NAME.md"
  local IN_PROGRESS_FILE=".agent/tasks/in-progress/$TASK_NAME.md"

  # Build the system prompt: agent rules + master plan + V3-CODING-INSTRUCTIONS + task
  local SYSTEM_PROMPT_FILE="/tmp/system-prompt-$TASK_NAME.md"
  cat agent/CLAUDE.md > "$SYSTEM_PROMPT_FILE"
  echo "" >> "$SYSTEM_PROMPT_FILE"
  echo "## Current task" >> "$SYSTEM_PROMPT_FILE"
  echo "" >> "$SYSTEM_PROMPT_FILE"
  cat "$IN_PROGRESS_FILE" >> "$SYSTEM_PROMPT_FILE"

  # Determine model: read `model:` frontmatter from task file, default to opus
  # For master-plan Phase 1+2 work we want Opus 4.7 (latest), fallback Opus 4.6
  local MODEL="${AGENT_DEFAULT_MODEL:-claude-opus-4-7}"
  local TASK_MODEL=$(grep -m1 "^model:" "$IN_PROGRESS_FILE" | sed 's/^model:[[:space:]]*//' | tr -d '"' | tr -d "'" )
  if [ -n "$TASK_MODEL" ]; then
    MODEL="$TASK_MODEL"
  fi
  echo "$LOOP_TAG using model: $MODEL"

  # DIAGNOSTIC PASS: dump claude version + help BEFORE the actual run.
  # Tasks completing in 2-7s post-fix #1 means flags were rejected. We need to
  # SEE what flags this version of claude-code accepts. Output goes to log file.
  local LOG=".agent/tasks/in-progress/$TASK_NAME.log"
  {
    echo "=== AGENT-LOOP DIAGNOSTIC for $TASK_NAME at $(date -u +%FT%TZ) ==="
    echo "--- claude --version ---"
    claude --version 2>&1
    echo ""
    echo "--- claude --help ---"
    claude --help 2>&1
    echo ""
    echo "--- node --version ---"
    node --version 2>&1
    echo ""
    echo "--- which claude ---"
    which claude 2>&1
    echo ""
    echo "--- npm root -g ---"
    npm root -g 2>&1
    echo ""
    echo "=== END DIAGNOSTIC ==="
    echo ""
  } > "$LOG"

  # Now running as non-root (UID 1001 'claudeagent') — safe to use --dangerously-skip-permissions.
  # Triple-redundant tool grants:
  #   --dangerously-skip-permissions = bypass all permission checks (now allowed since non-root)
  #   --permission-mode bypassPermissions = backup permission mode
  #   --tools default = explicit "use all built-in tools"

  # Background heartbeat — emits "still running" every 60s to STDOUT so Railway logs
  # show the loop is alive even though Claude's output goes to a separate log file.
  # Without this, Builder LOOKS idle from Railway's perspective for 15-30+ min.
  (
    while true; do
      sleep 60
      echo "$LOOP_TAG heartbeat: claude running on $TASK_NAME for $(($(date +%s) - START_TIME))s (model=$MODEL)"
    done
  ) &
  local HEARTBEAT_PID=$!

  # Watchdog timeout: 30 min. If Claude doesn't finish in 30 min, kill it.
  # This is the PERMANENT fix for "Builder appears wedged" — agent-loop now
  # self-recovers by timing out hung Claude executions, then handles the
  # exit code as a normal task failure (moves to failed/, queues remediation).
  local CLAUDE_TIMEOUT_SECONDS="${CLAUDE_TIMEOUT_SECONDS:-1800}"

  set +e
  timeout "$CLAUDE_TIMEOUT_SECONDS" claude \
    --print \
    --model "$MODEL" \
    --max-turns 200 \
    --dangerously-skip-permissions \
    --permission-mode bypassPermissions \
    --tools default \
    --append-system-prompt "$(cat "$SYSTEM_PROMPT_FILE")" \
    "Read .agent/tasks/in-progress/$TASK_NAME.md and execute the task spec FULLY. Use the Write tool to create new files. Use the Edit tool to modify existing files. Use the Bash tool to run commands. When the task spec says 'create file X', actually call Write with that filename. When done, run 'npm run build' via Bash to verify. If green, exit. If errors, fix up to 5 times." \
    >> "$LOG" 2>&1
  local CLAUDE_EXIT=$?
  echo "$LOOP_TAG claude exit code: $CLAUDE_EXIT" >> "$LOG"
  set -e

  # Kill the heartbeat now that Claude finished (or timed out)
  kill "$HEARTBEAT_PID" 2>/dev/null || true

  # Detect timeout (exit code 124 = standard `timeout` SIGTERM)
  if [ "$CLAUDE_EXIT" = "124" ]; then
    echo "$LOOP_TAG TIMEOUT: claude on $TASK_NAME exceeded ${CLAUDE_TIMEOUT_SECONDS}s — killing and treating as failed"
    /usr/local/bin/notify-whatsapp.sh "⏰ Builder timed out on $TASK_NAME after ${CLAUDE_TIMEOUT_SECONDS}s — moving to failed/, will retry next cycle" || true
  fi

  # CRITICAL DEBUG: persist the log file to git so we can see what Claude actually said
  mkdir -p .agent/tasks/logs
  cp ".agent/tasks/in-progress/$TASK_NAME.log" ".agent/tasks/logs/$TASK_NAME-$(date +%s).log" 2>/dev/null
  # Truncate huge logs (keep first + last 50KB)
  if [ -f ".agent/tasks/logs/$TASK_NAME-$(date +%s).log" ]; then
    local LOGFILE=".agent/tasks/logs/$TASK_NAME-$(date +%s).log"
    if [ $(stat -c%s "$LOGFILE" 2>/dev/null || stat -f%z "$LOGFILE") -gt 100000 ]; then
      head -c 50000 "$LOGFILE" > "$LOGFILE.tmp"
      echo "...[TRUNCATED]..." >> "$LOGFILE.tmp"
      tail -c 50000 "$LOGFILE" >> "$LOGFILE.tmp"
      mv "$LOGFILE.tmp" "$LOGFILE"
    fi
  fi

  # Run final build to verify
  echo "$LOOP_TAG verifying build for $TASK_NAME"
  set +e
  npm run build > ".agent/tasks/in-progress/$TASK_NAME.build.log" 2>&1
  local BUILD_EXIT=$?
  set -e

  local END_TIME=$(date +%s)
  local DURATION=$((END_TIME - START_TIME))

  # Decide: success or failure
  local QUESTION_EXISTS=0
  if ls .agent/questions/$TASK_NAME-q.md 2>/dev/null; then
    QUESTION_EXISTS=1
  fi

  if [ $BUILD_EXIT -eq 0 ] && [ $QUESTION_EXISTS -eq 0 ]; then
    echo "$LOOP_TAG task $TASK_NAME succeeded in ${DURATION}s"
    cd "$REPO_DIR"
    git add -A

    # Detect REAL work vs empty commit. Compare HEAD before vs after — Claude often
    # commits + pushes within its own session, so the staged-changes check after
    # Claude returns is empty (everything already committed). Compare HEAD instead.
    local HEAD_AFTER=$(git rev-parse HEAD)
    if [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
      local CHANGED_FILES=$(git diff --name-only "$HEAD_BEFORE" "$HEAD_AFTER" | grep -v '^\.agent/tasks/' | wc -l | tr -d ' ')
      echo "$LOOP_TAG claude pushed $((CHANGED_FILES)) meaningful files between $HEAD_BEFORE and $HEAD_AFTER"
    else
      local CHANGED_FILES=$(git diff --cached --name-only | grep -v '^\.agent/tasks/' | wc -l | tr -d ' ')
      echo "$LOOP_TAG no commits made by claude; staged files: $CHANGED_FILES"
    fi

    if ! git diff --cached --quiet; then
      git commit -m "feat: $TASK_NAME (autonomous agent, ${DURATION}s, $CHANGED_FILES files)"
    fi

    # Re-read HEAD_AFTER after any staged-change commit above
    HEAD_AFTER=$(git rev-parse HEAD)

    if [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
      # Gate on verifier verdict before pushing, then designer gate (UI tasks only)
      if run_verifier_gate "$TASK_NAME" "$HEAD_BEFORE" "$HEAD_AFTER" && \
         run_designer_gate "$TASK_NAME" "$HEAD_BEFORE" "$HEAD_AFTER"; then
        git push origin main || {
          echo "$LOOP_TAG push failed"
          /usr/local/bin/notify-whatsapp.sh "⚠️ Agent built $TASK_NAME but push failed" || true
          return 1
        }
        mkdir -p .agent/tasks/done
        mv "$IN_PROGRESS_FILE" ".agent/tasks/done/$TASK_NAME.md"
        git add .agent/
        git commit -m "chore(agent): $TASK_NAME → done" || true
        git push origin main || true

        if [ "$CHANGED_FILES" -gt 0 ]; then
          /usr/local/bin/notify-whatsapp.sh "✅ Agent shipped: $TASK_NAME (${DURATION}s, $CHANGED_FILES files)" || true
        else
          echo "$LOOP_TAG SUSPICIOUS: $TASK_NAME marked done but ZERO meaningful files changed"
          /usr/local/bin/notify-whatsapp.sh "⚠️ $TASK_NAME marked done but produced 0 file changes — agent likely failed silently. Investigate." || true
        fi
      else
        echo "$LOOP_TAG verifier blocked push — moving task to failed/"
        mkdir -p .agent/tasks/failed
        mv "$IN_PROGRESS_FILE" ".agent/tasks/failed/$TASK_NAME.md" 2>/dev/null || true
        git add .agent/ 2>/dev/null || true
        git commit -m "chore(agent): $TASK_NAME → failed (verifier blocked)" 2>/dev/null || true
        git push origin main 2>/dev/null || true
        /usr/local/bin/notify-whatsapp.sh "🔍 Verifier blocked: $TASK_NAME — remediation queued" || true
      fi
    else
      # No commits at all — suspicious but mark done anyway
      mkdir -p .agent/tasks/done
      mv "$IN_PROGRESS_FILE" ".agent/tasks/done/$TASK_NAME.md"
      git add .agent/
      git commit -m "chore(agent): $TASK_NAME → done (no code changes)" || true
      git push origin main || true
      echo "$LOOP_TAG SUSPICIOUS: $TASK_NAME marked done but ZERO meaningful files changed"
      /usr/local/bin/notify-whatsapp.sh "⚠️ $TASK_NAME marked done but produced 0 file changes — agent likely failed silently. Investigate." || true
    fi
  else
    # Failure or question raised
    echo "$LOOP_TAG task $TASK_NAME stopped (build_exit=$BUILD_EXIT, question=$QUESTION_EXISTS)"
    mkdir -p .agent/tasks/failed
    mv "$IN_PROGRESS_FILE" ".agent/tasks/failed/$TASK_NAME.md"

    # Don't commit half-broken code — but DO commit the failure record so user sees it
    git add .agent/ 2>/dev/null || true
    git commit -m "chore(agent): $TASK_NAME → failed/blocked" 2>/dev/null || true
    git push origin main 2>/dev/null || true

    if [ $QUESTION_EXISTS -eq 1 ]; then
      /usr/local/bin/notify-whatsapp.sh "❓ Agent has a question on $TASK_NAME — see .agent/questions/" || true
    else
      /usr/local/bin/notify-whatsapp.sh "❌ Agent failed: $TASK_NAME (build error). Logs in .agent/tasks/failed/" || true
    fi
  fi
}

# -----------------------------------------------------------------------------
# 3. Main loop
# -----------------------------------------------------------------------------
bootstrap

while true; do
  cd "$REPO_DIR"
  echo "$LOOP_TAG tick at $(date -u +%FT%TZ)"

  # Always pull latest first — VERBOSE so we see what's happening (no --quiet)
  echo "$LOOP_TAG pre-fetch HEAD: $(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
  if git fetch origin main 2>&1; then
    echo "$LOOP_TAG fetch ok"
  else
    echo "$LOOP_TAG fetch FAILED — exit=$?" >&2
  fi

  if git reset --hard origin/main 2>&1; then
    echo "$LOOP_TAG reset ok — HEAD now: $(git rev-parse HEAD)"
  else
    echo "$LOOP_TAG reset FAILED — exit=$?" >&2
  fi

  # Diagnostic: what does the queue look like?
  echo "$LOOP_TAG queue contents:"
  ls -la .agent/tasks/queued/ 2>&1 | head -15

  # Pick a task
  TASK_FILE=$(pick_next_task)
  echo "$LOOP_TAG pick_next_task returned: '${TASK_FILE:-<empty>}'"

  if [ -n "$TASK_FILE" ]; then
    run_task "$TASK_FILE" || echo "$LOOP_TAG run_task returned non-zero"
    # Just finished work — sleep briefly so the next queued spec starts ASAP
    echo "$LOOP_TAG cycle done; active sleep ${ACTIVE_SLEEP_SECONDS}s before next pick"
    sleep "$ACTIVE_SLEEP_SECONDS"
  else
    # Queue empty — relax to a long sleep so we don't hammer git fetch
    echo "$LOOP_TAG no queued tasks; idle sleep ${IDLE_SLEEP_SECONDS}s"
    sleep "$IDLE_SLEEP_SECONDS"
  fi
done
