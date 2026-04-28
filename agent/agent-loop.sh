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
SLEEP_SECONDS="${SLEEP_SECONDS:-300}" # 5 minutes default
LOOP_TAG="[agent-loop]"

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
    printf '%b' "$AGENT_SSH_PRIVATE_KEY" | tr -d '\r' > /root/.ssh/id_ed25519
    # Ensure file ends with newline (OpenSSH requires it)
    [ -z "$(tail -c1 /root/.ssh/id_ed25519)" ] || echo "" >> /root/.ssh/id_ed25519
    chmod 600 /root/.ssh/id_ed25519

    # Validate the key parses correctly. If not, dump diagnostics.
    if ssh-keygen -y -f /root/.ssh/id_ed25519 > /root/.ssh/id_ed25519.pub 2>/dev/null; then
      echo "$LOOP_TAG SSH key written and validated"
      echo "$LOOP_TAG public key fingerprint:"
      ssh-keygen -lf /root/.ssh/id_ed25519
    else
      echo "$LOOP_TAG ERROR: SSH key failed to parse" >&2
      echo "$LOOP_TAG First line: $(head -1 /root/.ssh/id_ed25519)" >&2
      echo "$LOOP_TAG Last line:  $(tail -1 /root/.ssh/id_ed25519)" >&2
      echo "$LOOP_TAG Line count: $(wc -l < /root/.ssh/id_ed25519)" >&2
      exit 1
    fi

    # Add github.com to known_hosts so ssh doesn't prompt
    ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null
    chmod 644 /root/.ssh/known_hosts
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

  # Notify start
  /usr/local/bin/notify-whatsapp.sh "🤖 CropsIntel V3 agent online" || true

  echo "$LOOP_TAG bootstrap complete"
}

# -----------------------------------------------------------------------------
# 1. Pick next task
# -----------------------------------------------------------------------------
pick_next_task() {
  cd "$REPO_DIR"
  ls .agent/tasks/queued/*.md 2>/dev/null | grep -v ".gitkeep" | sort | head -1
}

# -----------------------------------------------------------------------------
# 2. Run Claude Code on a task
# -----------------------------------------------------------------------------
run_task() {
  local TASK_FILE="$1"
  local TASK_NAME=$(basename "$TASK_FILE" .md)
  local START_TIME=$(date +%s)

  echo "$LOOP_TAG starting task: $TASK_NAME"

  cd "$REPO_DIR"

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

  # Run Claude Code with the system prompt
  # `--print` makes it non-interactive and exit when done
  # `--max-turns` caps how many tool-use turns it gets
  # `--model` selects the underlying Claude model
  set +e
  claude \
    --print \
    --model "$MODEL" \
    --max-turns 200 \
    --append-system-prompt "$(cat "$SYSTEM_PROMPT_FILE")" \
    "Read .agent/tasks/in-progress/$TASK_NAME.md and execute it. When done, run 'npm run build' to verify. If green, stop. If errors, fix and retry up to 5 times. If you hit an architectural decision you can't make, write a question file to .agent/questions/$TASK_NAME-q.md describing the question, then stop." \
    > ".agent/tasks/in-progress/$TASK_NAME.log" 2>&1
  local CLAUDE_EXIT=$?
  # If Opus 4.7 isn't available (model error) and we used the default, retry on Opus 4.6
  if [ $CLAUDE_EXIT -ne 0 ] && [ "$MODEL" = "claude-opus-4-7" ]; then
    echo "$LOOP_TAG opus-4-7 failed; retrying with opus-4-6"
    claude \
      --print \
      --model "claude-opus-4-6" \
      --max-turns 200 \
      --append-system-prompt "$(cat "$SYSTEM_PROMPT_FILE")" \
      "Read .agent/tasks/in-progress/$TASK_NAME.md and execute it. When done, run 'npm run build' to verify. If green, stop. If errors, fix and retry up to 5 times. If you hit an architectural decision you can't make, write a question file to .agent/questions/$TASK_NAME-q.md describing the question, then stop." \
      >> ".agent/tasks/in-progress/$TASK_NAME.log" 2>&1
    CLAUDE_EXIT=$?
  fi
  set -e

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
    # Success: commit + push + move to done
    echo "$LOOP_TAG task $TASK_NAME succeeded in ${DURATION}s"
    cd "$REPO_DIR"
    git add -A
    if ! git diff --cached --quiet; then
      git commit -m "feat: $TASK_NAME (autonomous agent, ${DURATION}s)"
      git push origin main || {
        echo "$LOOP_TAG push failed"
        /usr/local/bin/notify-whatsapp.sh "⚠️ Agent built $TASK_NAME but push failed" || true
        return 1
      }
    fi
    mkdir -p .agent/tasks/done
    mv "$IN_PROGRESS_FILE" ".agent/tasks/done/$TASK_NAME.md"
    git add .agent/
    git commit -m "chore(agent): $TASK_NAME → done" || true
    git push origin main || true
    /usr/local/bin/notify-whatsapp.sh "✅ Agent shipped: $TASK_NAME (${DURATION}s)" || true
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

  # Always pull latest first
  git fetch origin main --quiet || echo "$LOOP_TAG fetch failed (will retry)"
  git reset --hard origin/main --quiet || echo "$LOOP_TAG reset failed"

  # Pick a task
  TASK_FILE=$(pick_next_task)
  if [ -n "$TASK_FILE" ]; then
    run_task "$TASK_FILE" || echo "$LOOP_TAG run_task returned non-zero"
  else
    echo "$LOOP_TAG no queued tasks; sleeping ${SLEEP_SECONDS}s"
  fi

  sleep "$SLEEP_SECONDS"
done
