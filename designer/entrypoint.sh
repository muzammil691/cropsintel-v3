#!/bin/bash
# CropsIntel V3 Designer — startup wrapper
# Clones the cropsintel-v3 repo so the designer can read .agent/design-system.md
# and audit changed files. Then runs the designer in the requested mode (default: server).

set -e

REPO_DIR="${REPO_DIR:-/workspace/cropsintel-v3}"
GIT_REPO_URL="${GIT_REPO_URL:-git@github.com:muzammil691/cropsintel-v3.git}"
SSH_DIR="/root/.ssh"
SSH_KEY="$SSH_DIR/id_ed25519"

# 1. Setup SSH key if provided (for private repo clone)
if [ -n "$AGENT_SSH_PRIVATE_KEY" ]; then
  mkdir -p "$SSH_DIR"
  chmod 700 "$SSH_DIR"
  printf '%b' "$AGENT_SSH_PRIVATE_KEY" | tr -d '\r' > "$SSH_KEY"
  [ -z "$(tail -c1 "$SSH_KEY")" ] || echo "" >> "$SSH_KEY"
  chmod 600 "$SSH_KEY"
  echo "[designer-entrypoint] SSH key written to $SSH_KEY ($(wc -l < $SSH_KEY) lines)"

  if ssh-keygen -y -f "$SSH_KEY" > /dev/null 2>&1; then
    echo "[designer-entrypoint] SSH key validated (parseable)"
  else
    echo "[designer-entrypoint] ERROR: SSH key failed to parse — check AGENT_SSH_PRIVATE_KEY env var"
    echo "[designer-entrypoint] First line: $(head -1 "$SSH_KEY")"
    echo "[designer-entrypoint] Last line:  $(tail -1 "$SSH_KEY")"
  fi
else
  echo "[designer-entrypoint] WARNING: AGENT_SSH_PRIVATE_KEY not set — clone will fail"
fi

# Pre-populate known_hosts with github's keys
ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> "$SSH_DIR/known_hosts" 2>/dev/null || true
chmod 644 "$SSH_DIR/known_hosts" 2>/dev/null || true

export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=$SSH_DIR/known_hosts"
echo "[designer-entrypoint] GIT_SSH_COMMAND=$GIT_SSH_COMMAND"

# 2. Clone or pull the repo
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[designer-entrypoint] cloning $GIT_REPO_URL → $REPO_DIR"
  mkdir -p "$(dirname "$REPO_DIR")"
  if ! git clone "$GIT_REPO_URL" "$REPO_DIR"; then
    echo "[designer-entrypoint] CLONE FAILED — sleeping 60s before exit"
    sleep 60
    exit 1
  fi
else
  echo "[designer-entrypoint] repo exists, pulling latest"
  cd "$REPO_DIR" && git pull --rebase --autostash || echo "[designer-entrypoint] pull failed (continuing with cached state)"
fi

# 3. Export REPO_ROOT so designer knows where to find .agent/design-system.md
export REPO_ROOT="$REPO_DIR"
echo "[designer-entrypoint] REPO_ROOT=$REPO_ROOT"

# 4. Run the designer with whatever args were passed (default: server)
cd /app
echo "[designer-entrypoint] starting designer: ${*:-server}"
exec node dist/index.js "${@:-server}"
