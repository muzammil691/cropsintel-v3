#!/bin/bash
# CropsIntel V3 Memory — startup wrapper
# Clones the cropsintel-v3 repo so Memory can ingest local files
# (master plan, workflow doc, audits, agent task history).

set -e

REPO_DIR="${REPO_DIR:-/workspace/cropsintel-v3}"
GIT_REPO_URL="${GIT_REPO_URL:-git@github.com:muzammil691/cropsintel-v3.git}"
SSH_DIR="/root/.ssh"
SSH_KEY="$SSH_DIR/id_ed25519"

# 1. Setup SSH key for private repo clone
if [ -n "$AGENT_SSH_PRIVATE_KEY" ]; then
  mkdir -p "$SSH_DIR"
  chmod 700 "$SSH_DIR"
  printf '%b' "$AGENT_SSH_PRIVATE_KEY" | tr -d '\r' > "$SSH_KEY"
  [ -z "$(tail -c1 "$SSH_KEY")" ] || echo "" >> "$SSH_KEY"
  chmod 600 "$SSH_KEY"
  echo "[memory-entrypoint] SSH key written ($(wc -l < $SSH_KEY) lines)"

  if ssh-keygen -y -f "$SSH_KEY" > /dev/null 2>&1; then
    echo "[memory-entrypoint] SSH key validated"
  else
    echo "[memory-entrypoint] WARNING: SSH key failed to parse"
  fi
else
  echo "[memory-entrypoint] WARNING: AGENT_SSH_PRIVATE_KEY not set"
fi

# Bypass strict host key checking
export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

# 2. Clone or update repo
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[memory-entrypoint] cloning $GIT_REPO_URL"
  mkdir -p "$(dirname "$REPO_DIR")"
  if ! git clone "$GIT_REPO_URL" "$REPO_DIR"; then
    echo "[memory-entrypoint] CLONE FAILED — sleeping 60s"
    sleep 60
    exit 1
  fi
else
  cd "$REPO_DIR" && git pull --rebase --autostash || echo "[memory-entrypoint] pull failed (using cached)"
fi

# 3. Export REPO_ROOT so Memory's ingest reads from the cloned repo
export REPO_ROOT="$REPO_DIR"
echo "[memory-entrypoint] REPO_ROOT=$REPO_ROOT"

# 4. Run Memory in the requested mode (default: server)
cd /app
echo "[memory-entrypoint] starting memory: ${@:-server}"
exec node dist/index.js "${@:-server}"

