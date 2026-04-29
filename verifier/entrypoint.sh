#!/bin/bash
# CropsIntel V3 Verifier — startup wrapper
# Clones the cropsintel-v3 repo so the verifier can read .agent/tasks/done/.
# Then runs the verifier in the requested mode (default: audit-all).

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
  echo "[verifier-entrypoint] SSH key written to $SSH_KEY ($(wc -l < $SSH_KEY) lines)"

  # Validate the key is parseable BEFORE git clone tries to use it
  if ssh-keygen -y -f "$SSH_KEY" > /dev/null 2>&1; then
    echo "[verifier-entrypoint] SSH key validated (parseable)"
  else
    echo "[verifier-entrypoint] ERROR: SSH key failed to parse — check AGENT_SSH_PRIVATE_KEY env var"
    echo "[verifier-entrypoint] First line: $(head -1 "$SSH_KEY")"
    echo "[verifier-entrypoint] Last line:  $(tail -1 "$SSH_KEY")"
  fi
else
  echo "[verifier-entrypoint] WARNING: AGENT_SSH_PRIVATE_KEY not set — clone will fail"
fi

# Pre-populate known_hosts with github's keys (avoids interactive prompt)
ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> "$SSH_DIR/known_hosts" 2>/dev/null || true
chmod 644 "$SSH_DIR/known_hosts" 2>/dev/null || true

# Use ABSOLUTE path in GIT_SSH_COMMAND (~ doesn't expand inside this string when ssh reads it)
export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=$SSH_DIR/known_hosts"
echo "[verifier-entrypoint] GIT_SSH_COMMAND=$GIT_SSH_COMMAND"

# 2. Clone or pull the repo
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[verifier-entrypoint] cloning $GIT_REPO_URL → $REPO_DIR"
  mkdir -p "$(dirname "$REPO_DIR")"
  if ! git clone "$GIT_REPO_URL" "$REPO_DIR"; then
    echo "[verifier-entrypoint] CLONE FAILED — sleeping 60s before exit (so container doesn't restart loop too fast)"
    sleep 60
    exit 1
  fi
else
  echo "[verifier-entrypoint] repo exists, pulling latest"
  cd "$REPO_DIR" && git pull --rebase --autostash || echo "[verifier-entrypoint] pull failed (continuing with cached state)"
fi

# 3. Export REPO_ROOT so verifier knows where to find .agent/tasks/done/
export REPO_ROOT="$REPO_DIR"
echo "[verifier-entrypoint] REPO_ROOT=$REPO_ROOT"

# 4. Run the verifier with whatever args were passed (default: audit-all)
cd /app
echo "[verifier-entrypoint] starting verifier: ${@:-audit-all}"
exec node dist/index.js "${@:-audit-all}"


