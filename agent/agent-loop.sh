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

# Atlas heartbeat configuration (Phase 1.10ax — push Builder state to cockpit)
ATLAS_URL="${ATLAS_URL:-https://courteous-simplicity-production.up.railway.app}"
ATLAS_API_TOKEN="${ATLAS_API_TOKEN:-}"
ATLAS_HEARTBEAT_ENABLED="${ATLAS_HEARTBEAT_ENABLED:-true}"
# Track consecutive heartbeat failures so we log loudly after 3 (NEVER list).
ATLAS_HEARTBEAT_FAIL_COUNT=0

# -----------------------------------------------------------------------------
# 0a. post_atlas_heartbeat — push Builder's current state to Atlas cockpit.
#     Bounded with -m 5 + `|| true` so a failed POST never blocks the loop.
#     Args: $1=state, $2=task, $3=elapsed_s, $4=msg
# -----------------------------------------------------------------------------
post_atlas_heartbeat() {
  [ "$ATLAS_HEARTBEAT_ENABLED" != "true" ] && return 0
  [ -z "$ATLAS_API_TOKEN" ] && return 0

  local state="$1"
  local task="${2:-}"
  local elapsed_s="${3:-0}"
  local msg="${4:-}"

  # JSON-escape minimally: backslash, double-quote, and control chars to spaces.
  local task_esc=$(printf '%s' "$task" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g')
  local msg_esc=$(printf '%s' "$msg" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-200)

  local http_code
  http_code=$(curl -sS -X POST "$ATLAS_URL/atlas/agents/builder/heartbeat" \
    -H "Authorization: Bearer $ATLAS_API_TOKEN" \
    -H "Content-Type: application/json" \
    -m 5 \
    -o /dev/null -w '%{http_code}' \
    -d "{\"state\":\"$state\",\"task\":\"$task_esc\",\"elapsed_s\":$elapsed_s,\"msg\":\"$msg_esc\"}" 2>/dev/null) || http_code="000"

  if [ "$http_code" = "200" ] || [ "$http_code" = "204" ]; then
    ATLAS_HEARTBEAT_FAIL_COUNT=0
  else
    ATLAS_HEARTBEAT_FAIL_COUNT=$((ATLAS_HEARTBEAT_FAIL_COUNT + 1))
    if [ "$ATLAS_HEARTBEAT_FAIL_COUNT" -ge 3 ]; then
      echo "$LOOP_TAG WARN: atlas heartbeat failed $ATLAS_HEARTBEAT_FAIL_COUNT times in a row (last http=$http_code, state=$state, task=$task)" >&2
    fi
  fi
  return 0
}

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

  # Apply any pending migrations that were committed but never pushed to the DB.
  # Without this, services depending on new tables (atlas_config, designer_runs,
  # atlas_events, etc.) fail at runtime even though the migration .sql files exist.
  echo "$LOOP_TAG pushing pending supabase migrations"
  if supabase db push --include-all --yes 2>&1 | tee /tmp/supabase-push.log | tail -20; then
    echo "$LOOP_TAG supabase db push ok"
  else
    echo "$LOOP_TAG WARN: supabase db push failed — see /tmp/supabase-push.log" >&2
  fi

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
# 1. Pick next task — frontmatter-aware (priority + depends-on)
# -----------------------------------------------------------------------------
# Spec frontmatter (between leading --- markers) MAY declare:
#   priority: 1     # 1=urgent, 5=normal (default), 10=lowest
#   depends-on:
#     - phase-X-foo
# Algorithm:
#   1. Read all queued specs' frontmatter.
#   2. Filter out specs whose `depends-on` ids are NOT all present in done/.
#   3. Sort by (priority ASC, filename ASC). Lower priority number ships first.
#   4. Return head.
# When no spec declares frontmatter, behavior is identical to alphabetical sort
# (priority defaults to 5 for every spec) — preserves the 1.10n-w shipping order.
pick_next_task() {
  cd "$REPO_DIR"
  local done_ids
  done_ids=$(ls .agent/tasks/done/ 2>/dev/null | sed 's|\.md$||')

  local candidates=""
  for spec in .agent/tasks/queued/*.md; do
    [ -e "$spec" ] || continue
    local id
    id=$(basename "$spec" .md)
    [ "$id" = "_template" ] && continue

    # Extract frontmatter block (between leading --- fences). Empty if absent.
    local fm
    fm=$(awk 'NR==1 && $0!="---" {exit} /^---$/{f++; next} f==1{print} f==2{exit}' "$spec")

    # priority: scalar; default 5
    local priority=5
    if [ -n "$fm" ]; then
      local p
      p=$(echo "$fm" | awk -F: '/^priority:[[:space:]]*[0-9]+/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit}')
      if [ -n "$p" ]; then
        priority="$p"
      fi
    fi

    # depends-on: list of bullets under "depends-on:" key
    local blocked=0
    if [ -n "$fm" ]; then
      local deps
      deps=$(echo "$fm" | awk '
        /^depends-on:[[:space:]]*$/ {in_list=1; next}
        in_list==1 && /^[[:space:]]+-[[:space:]]+/ { sub(/^[[:space:]]+-[[:space:]]+/, ""); sub(/[[:space:]]+$/, ""); print; next }
        in_list==1 && /^[^[:space:]]/ {in_list=0}
      ')
      if [ -n "$deps" ]; then
        local dep
        while IFS= read -r dep; do
          [ -z "$dep" ] && continue
          # Strip optional surrounding quotes
          dep=$(echo "$dep" | sed 's/^"\(.*\)"$/\1/' | sed "s/^'\(.*\)'$/\1/")
          if ! echo "$done_ids" | grep -qx "$dep"; then
            blocked=1
            break
          fi
        done <<< "$deps"
      fi
    fi
    [ "$blocked" = "1" ] && continue

    # Sortable line: zero-padded priority, then filename
    candidates="${candidates}$(printf '%02d' "$priority") ${spec}"$'\n'
  done

  if [ -z "$candidates" ]; then
    return 0
  fi

  printf '%s' "$candidates" | sort -k1,1n -k2,2 | head -1 | awk '{print $2}'
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
    # Step 3 of agent-loop stabilization: treat verifier-unreachable as BLOCK,
    # not silent-pass. Without this, every Verifier outage shipped unverified
    # commits — defeats the purpose of having a gate. Operator gets WhatsApp
    # ping so they can investigate.
    echo "$LOOP_TAG verifier UNREACHABLE — BLOCKING push: $response" >&2
    /usr/local/bin/notify-whatsapp.sh "🛑 Verifier unreachable for $task_id @ ${head_after:0:8}. Push blocked. Investigate verifier service." 2>/dev/null || true
    git reset --hard "$head_before"
    return 1
  }

  local verdict=$(echo "$response" | jq -r '.verdict // "unknown"')
  local confidence=$(echo "$response" | jq -r '.confidence // 0')
  local unknown_reason=$(echo "$response" | jq -r '.unknown_reason // ""')
  echo "$LOOP_TAG verifier verdict: $verdict (confidence $confidence)"

  if [ "$verdict" = "pass" ]; then
    return 0
  fi

  # Step 3 of agent-loop stabilization: handle verdict='unknown' explicitly
  # instead of letting it fall through to silent-pass. The verifier returns
  # unknown for: spec_not_found, sync_failed, verify_crashed, db_write_failed,
  # judge_unreachable. None of these mean "the code is fine."
  if [ "$verdict" = "unknown" ]; then
    echo "$LOOP_TAG verifier verdict UNKNOWN (reason=$unknown_reason) — BLOCKING push" >&2
    /usr/local/bin/notify-whatsapp.sh "🛑 Verifier verdict=unknown for $task_id @ ${head_after:0:8} (reason=${unknown_reason:-unspecified}). Push blocked. Manual review needed." 2>/dev/null || true
    git reset --hard "$head_before"
    return 1
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

      # Persist the verifier response so research-remediate.sh can extract gaps + ai_judgment
      local verifier_response_path="/tmp/verifier-response-${task_id}-${rem_num}.json"
      printf '%s' "$response" > "$verifier_response_path"

      # Run research step (Part A): memory.search + Multi-Brain debate on root cause.
      # research-remediate.sh always exits 0 — it emits markdown for us to inline.
      # On failure of the upstream service, it emits a degraded-mode block.
      local research_block=""
      if [ -x "$REPO_DIR/agent/research-remediate.sh" ]; then
        echo "$LOOP_TAG calling research-remediate.sh for $task_id"
        research_block=$("$REPO_DIR/agent/research-remediate.sh" "$task_id" "$head_before" "$head_after" "$verifier_response_path" 2>/dev/null || echo "")
      else
        echo "$LOOP_TAG WARN: research-remediate.sh not executable, skipping research step" >&2
      fi

      # Extract research confidence from the block; gate human-review escalation on it.
      local research_confidence=$(echo "$research_block" | grep -m1 '^## Research confidence:' | sed 's/^## Research confidence: *//' | awk '{print $1}')
      [ -z "$research_confidence" ] && research_confidence="0"
      local needs_human_review="false"
      if awk -v c="$research_confidence" 'BEGIN { exit !(c < 0.4) }'; then
        needs_human_review="true"
      fi
      echo "$LOOP_TAG research confidence: $research_confidence (human_review=$needs_human_review)"

      cat > "$rem_file" <<EOF
---
priority: $([ "$needs_human_review" = "true" ] && echo 0 || echo 1)
human-review: $needs_human_review
research-confidence: $research_confidence
---

# Task: ${task_id} remediation ${rem_num} of ${MAX_REMEDIATION_ATTEMPTS}

**Reason:** Verifier blocked push at $(date -u +%FT%TZ)
**Original task:** ${task_id}
**Verifier verdict:** fail (confidence: $confidence)
**Attempt:** $((rem_count + 1)) of $MAX_REMEDIATION_ATTEMPTS

## Gaps Verifier identified

$(echo "$response" | jq -r '.gaps[] | "### \(.severity // "medium"): \(.check // "general")\n- **Description:** \(.description)\n- **Fix:** \(.fix // "")\n"' 2>/dev/null || echo "$response")

## AI Judgment context

$(echo "$response" | jq -r '.ai_judgment // "" | if type == "object" then to_entries[] | "**\(.key):** \(.value | tostring | .[0:500])" else . end' 2>/dev/null)
${research_block}
## Action

Re-attempt the original task spec at \`.agent/tasks/done/${task_id}.md\` (or wherever it landed), addressing EACH gap above. Do not skip any. **Read the research-driven root cause analysis above first** — the recommended_fix should drive the approach, not just patching the surface gaps.

After fixes, the new commit will be re-audited by Verifier. If gaps remain, this task will spawn another remediation. If $MAX_REMEDIATION_ATTEMPTS attempts fail in a row, the cycle escalates to the user.

EOF
      rm -f "$verifier_response_path" 2>/dev/null || true
      git add "$rem_file" && git commit -m "verifier: queue remediation $rem_num/$MAX_REMEDIATION_ATTEMPTS for $task_id (conf=$confidence, research=$research_confidence)" && git push origin main || true

      # If research couldn't converge on a root cause, also write a question file
      # so the human reviewer is paged. The remediation spec is still queued
      # (priority=0 means it sits at the head until someone reviews), but the
      # question file ensures WhatsApp + the .agent/questions/ surface flag it.
      if [ "$needs_human_review" = "true" ]; then
        mkdir -p .agent/questions
        local question_file=".agent/questions/${task_id}-remediation-${rem_num}-q.md"
        cat > "$question_file" <<EOF
# Question — ${task_id} remediation ${rem_num}

**Blocking:** Verifier auto-research could not converge on a root cause (confidence $research_confidence < 0.4)

**Context:**
Verifier failed the push for ${task_id} with confidence $confidence. The research helper ran memory.search + Multi-Brain debate but the three brains disagreed or returned low-confidence diagnoses. Builder should NOT auto-retry blindly.

**See:** \`$rem_file\` for the full remediation spec including gaps, AI judgment, and research output.

**Recommendation:** review the gaps + research block manually, then either edit the remediation spec to add direction or close the loop by deleting the spec.

**Master plan reference:** §1.6 (Verifier hardening), spec phase-1.10ad
EOF
        git add "$question_file" && git commit -m "verifier: human-review question for ${task_id} remediation $rem_num (research conf=$research_confidence)" && git push origin main || true
      fi

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
is_ui_diff() {
  # Diff-based UI detection: if the commit range touches any frontend file under
  # src/pages/, src/components/, src/styles/, or src/index.css, Designer audits.
  # No more keyword guesswork from filenames or spec text.
  local head_before="$1"
  local head_after="$2"
  if [ -z "$head_before" ] || [ -z "$head_after" ]; then
    return 1
  fi
  git diff --name-only "$head_before" "$head_after" 2>/dev/null \
    | grep -qE '^src/(pages|components|styles)/|^src/index\.css$'
}

run_designer_gate() {
  local task_id="$1"
  local head_before="$2"
  local head_after="$3"

  if [ "$DESIGNER_GATE_ENABLED" != "true" ]; then
    echo "$LOOP_TAG designer gate disabled, skipping"
    return 0
  fi

  if ! is_ui_diff "$head_before" "$head_after"; then
    echo "$LOOP_TAG designer gate skipped — diff did not touch src/pages, src/components, src/styles, or src/index.css"
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

  # Phase 4 of agent-loop redesign: surface the spec's primary-domain tag for
  # observability. Today every domain still routes to Claude Code. Phase 4b
  # (deferred) wires an OpenAI Codex sibling for primary-domain=frontend specs.
  local TASK_DOMAIN=$(grep -m1 "^primary-domain:" "$IN_PROGRESS_FILE" | sed 's/^primary-domain:[[:space:]]*//' | tr -d '"' | tr -d "'" )
  if [ -n "$TASK_DOMAIN" ]; then
    echo "$LOOP_TAG primary-domain: $TASK_DOMAIN (routing: claude-code; per-domain routing pending Phase 4b)"
  fi

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

  # Notify Atlas cockpit that Builder just picked this spec (state=starting).
  post_atlas_heartbeat "starting" "$TASK_NAME" 0 "spec picked"

  # Background heartbeat — emits "still running" every 60s to STDOUT so Railway logs
  # show the loop is alive even though Claude's output goes to a separate log file.
  # Without this, Builder LOOKS idle from Railway's perspective for 15-30+ min.
  # Also POSTs to Atlas (state=running) so the cockpit chip + pipeline update
  # without waiting for the conductor's 5-min poll.
  local LOG_FILE=".agent/tasks/in-progress/$TASK_NAME.log"
  (
    while true; do
      sleep 60
      local ELAPSED=$(($(date +%s) - START_TIME))
      echo "$LOOP_TAG heartbeat: claude running on $TASK_NAME for ${ELAPSED}s (model=$MODEL)"
      local TAIL_LINE=""
      if [ -f "$LOG_FILE" ]; then
        TAIL_LINE=$(tail -n1 "$LOG_FILE" 2>/dev/null | tr -d '\r' | cut -c1-160)
      fi
      [ -z "$TAIL_LINE" ] && TAIL_LINE="claude running (${ELAPSED}s)"
      post_atlas_heartbeat "running" "$TASK_NAME" "$ELAPSED" "$TAIL_LINE"
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
      # Push BEFORE running gates. Reason: Verifier and Designer audit by
      # inspecting their own clone of origin/main, not Builder's local commit.
      # Without this push-first ordering, Verifier's files-exist check sees the
      # OLD origin state and fails with "files missing" for any spec that
      # creates new files. The trade-off: broken code briefly hits main between
      # push and verifier-fail, but npm run build is gated on Builder's side
      # before reaching here, so at minimum the code compiles.
      post_atlas_heartbeat "shipping" "$TASK_NAME" "$DURATION" "pushing to main"
      git push origin main || {
        echo "$LOOP_TAG push failed (pre-gate)"
        /usr/local/bin/notify-whatsapp.sh "⚠️ Agent built $TASK_NAME but push failed" || true
        return 1
      }

      # Now gate on verifier + designer using the actually-pushed commit.
      post_atlas_heartbeat "verifying" "$TASK_NAME" "$DURATION" "verifier audit"
      if run_verifier_gate "$TASK_NAME" "$HEAD_BEFORE" "$HEAD_AFTER" && \
         run_designer_gate "$TASK_NAME" "$HEAD_BEFORE" "$HEAD_AFTER"; then
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
        # Code already pushed above; gates failed. Move spec to failed/ for
        # human review; the verifier_gate / designer_gate functions have
        # already auto-queued a remediation spec.
        echo "$LOOP_TAG gates failed after push — task moved to failed/, remediation queued"
        mkdir -p .agent/tasks/failed
        mv "$IN_PROGRESS_FILE" ".agent/tasks/failed/$TASK_NAME.md" 2>/dev/null || true
        git add .agent/ 2>/dev/null || true
        git commit -m "chore(agent): $TASK_NAME → failed (gates blocked, code on main)" 2>/dev/null || true
        git push origin main 2>/dev/null || true
        /usr/local/bin/notify-whatsapp.sh "🔍 Gates failed for $TASK_NAME — code on main, remediation queued" || true
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
    post_atlas_heartbeat "idle" "" 0 "between tasks"
    sleep "$ACTIVE_SLEEP_SECONDS"
  else
    # Queue empty — relax to a long sleep so we don't hammer git fetch
    echo "$LOOP_TAG no queued tasks; idle sleep ${IDLE_SLEEP_SECONDS}s"
    post_atlas_heartbeat "idle" "" 0 "no queued tasks"
    sleep "$IDLE_SLEEP_SECONDS"
  fi
done
