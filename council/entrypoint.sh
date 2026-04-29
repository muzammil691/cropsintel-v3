#!/bin/bash
# CropsIntel V3 Council — startup wrapper
# Clones the cropsintel-v3 repo so Council's auto-task-writer mode can read
# the master plan + workflow doc + existing task queue.

set -e

REPO_DIR="${REPO_DIR:-/workspace/cropsintel-v3}"
GIT_REPO_URL="${GIT_REPO_URL:-git@github.com:muzammil691/cropsintel-v3.git}"
SSH_DIR="/root/.ssh"
SSH_KEY="$SSH_DIR/id_ed25519"

# 1. Setup SSH key
if [ -n "$AGENT_SSH_PRIVATE_KEY" ]; then
  mkdir -p "$SSH_DIR"
  chmod 700 "$SSH_DIR"
  printf '%b' "$AGENT_SSH_PRIVATE_KEY" | tr -d '\r' > "$SSH_KEY"
  [ -z "$(tail -c1 "$SSH_KEY")" ] || echo "" >> "$SSH_KEY"
  chmod 600 "$SSH_KEY"
  echo "[council-entrypoint] SSH key written ($(wc -l < $SSH_KEY) lines)"

  if ssh-keygen -y -f "$SSH_KEY" > /dev/null 2>&1; then
    echo "[council-entrypoint] SSH key validated"
  else
    echo "[council-entrypoint] WARNING: SSH key failed to parse"
  fi
else
  echo "[council-entrypoint] WARNING: AGENT_SSH_PRIVATE_KEY not set"
fi

export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

# 2. Clone or update
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[council-entrypoint] cloning $GIT_REPO_URL"
  mkdir -p "$(dirname "$REPO_DIR")"
  if ! git clone "$GIT_REPO_URL" "$REPO_DIR"; then
    echo "[council-entrypoint] CLONE FAILED — sleeping 60s"
    sleep 60
    exit 1
  fi
else
  cd "$REPO_DIR" && git pull --rebase --autostash || echo "[council-entrypoint] pull failed (using cached)"
fi

# 3. Export REPO_ROOT
export REPO_ROOT="$REPO_DIR"
echo "[council-entrypoint] REPO_ROOT=$REPO_ROOT"

# 4. Run Council in requested mode (default: server)
cd /app
echo "[council-entrypoint] starting council: ${@:-server}"
exec node dist/index.js "${@:-server}"
