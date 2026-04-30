#!/bin/bash
# ship-all.sh — bypass Railway Builder, run Claude Code locally on each queued spec
# Usage: ./ship-all.sh
#
# This loops through .agent/tasks/queued/*.md alphabetically and runs Claude Code
# on each one. After each task succeeds (build green, commit made), it pushes
# and moves the spec to done/. If a task fails, it stops and reports.
#
# Designed to run overnight. Claude Code uses your existing Anthropic auth.
# SSH push uses your existing GitHub key.

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

QUEUED_DIR=".agent/tasks/queued"
DONE_DIR=".agent/tasks/done"
FAILED_DIR=".agent/tasks/failed"
LOG_DIR=".agent/tasks/logs"

mkdir -p "$DONE_DIR" "$FAILED_DIR" "$LOG_DIR"

echo "═══════════════════════════════════════════════════════════════"
echo " ship-all.sh — local fallback for Railway Builder"
echo " repo: $REPO_ROOT"
echo " started: $(date -u +%FT%TZ)"
echo "═══════════════════════════════════════════════════════════════"

# Pull latest first
git pull --rebase origin main || { echo "Pull failed — fix manually"; exit 1; }

# Get queued specs in alphabetical order
SPECS=$(ls "$QUEUED_DIR"/phase-*.md 2>/dev/null | sort)

if [ -z "$SPECS" ]; then
  echo "✓ No queued specs. Queue empty."
  exit 0
fi

echo
echo "Specs to ship (in order):"
for s in $SPECS; do echo "  - $(basename "$s")"; done
echo

for SPEC_FILE in $SPECS; do
  SPEC_NAME=$(basename "$SPEC_FILE" .md)
  START=$(date +%s)
  LOG_FILE="$LOG_DIR/${SPEC_NAME}-local-$(date +%s).log"

  echo
  echo "═══════════════════════════════════════════════════════════════"
  echo " ▶ Starting: $SPEC_NAME"
  echo " logs: $LOG_FILE"
  echo "═══════════════════════════════════════════════════════════════"

  # Capture HEAD before, so we can detect if Claude Code committed
  HEAD_BEFORE=$(git rev-parse HEAD)

  # Move to in-progress
  mkdir -p .agent/tasks/in-progress
  mv "$SPEC_FILE" ".agent/tasks/in-progress/$SPEC_NAME.md"
  IN_PROG="$REPO_ROOT/.agent/tasks/in-progress/$SPEC_NAME.md"

  # Run Claude Code with the task spec
  # Uses your local Anthropic auth (no API key needed if you're logged in via /login)
  # --dangerously-skip-permissions = Claude can write files without per-action approval
  # Reads the task spec, executes it, runs npm run build to verify
  set +e
  claude \
    --dangerously-skip-permissions \
    --append-system-prompt "You are working in the cropsintel-v3 repo at $REPO_ROOT. The current task is $IN_PROG. Read it fully and execute every step in 'Files to create' and 'Required changes'. Use Write/Edit tools to actually create or modify files. After implementing, run 'npm run build' (or for TS subprojects 'cd <subproj> && npm install && npm run build') to verify. Commit changes with message 'feat: $SPEC_NAME (local agent ship)'. If anything blocks you, write to .agent/questions/$SPEC_NAME-q.md and stop." \
    "Execute the task spec at $IN_PROG end to end. Make all the file changes. Run the build. Commit when green. Tell me when done." \
    < /dev/null > "$LOG_FILE" 2>&1
  CLAUDE_EXIT=$?
  set -e

  HEAD_AFTER=$(git rev-parse HEAD)
  DURATION=$(($(date +%s) - START))

  echo "claude exit: $CLAUDE_EXIT, duration: ${DURATION}s"
  echo "HEAD before: $HEAD_BEFORE"
  echo "HEAD after:  $HEAD_AFTER"

  if [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
    # Real changes were made. Push them.
    echo "✓ Claude made commits. Pushing..."
    git push origin main || {
      echo "⚠ Push failed for $SPEC_NAME — leaving in in-progress, exiting"
      exit 1
    }
    # Move spec to done
    mv "$IN_PROG" "$DONE_DIR/$SPEC_NAME.md"
    git add .agent/
    git commit -m "chore(ship-all): $SPEC_NAME → done (${DURATION}s)" || true
    git push origin main || true
    echo "✓ $SPEC_NAME shipped successfully"
  else
    # No commits. Probably failed.
    echo "✗ $SPEC_NAME made no commits (exit=$CLAUDE_EXIT). Check $LOG_FILE"
    mv "$IN_PROG" "$FAILED_DIR/$SPEC_NAME.md"
    git add .agent/
    git commit -m "chore(ship-all): $SPEC_NAME → failed" || true
    git push origin main || true
    echo "Stopping ship-all. Investigate before continuing."
    exit 1
  fi
done

echo
echo "═══════════════════════════════════════════════════════════════"
echo " ✓ ALL SPECS SHIPPED"
echo " ended: $(date -u +%FT%TZ)"
echo "═══════════════════════════════════════════════════════════════"
