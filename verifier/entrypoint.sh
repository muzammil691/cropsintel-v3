#!/bin/bash
# CropsIntel V3 Verifier — startup wrapper
# Clones the cropsintel-v3 repo so the verifier can read .agent/tasks/done/.
# Then runs the verifier in the requested mode (default: audit-all).

set -e

REPO_DIR="${REPO_DIR:-/workspace/cropsintel-v3}"
GIT_REPO_URL="${GIT_REPO_URL:-git@github.com:muzammil691/cropsintel-v3.git}"

# 1. Setup SSH key if provided (for private repo clone)
if [ -n "$AGENT_SSH_PRIVATE_KEY" ]; then
  mkdir -p ~/.ssh
  chmod 700 ~/.ssh
  printf '%b' "$AGENT_SSH_PRIVATE_KEY" | tr -d '\r' > ~/.ssh/id_ed25519
  [ -z "$(tail -c1 ~/.ssh/id_ed25519)" ] || echo "" >> ~/.ssh/id_ed25519
  chmod 600 ~/.ssh/id_ed25519
  ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null
  chmod 644 ~/.ssh/known_hosts
  echo "[verifier-entrypoint] SSH key written"
fi

# 2. Clone or pull the repo
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[verifier-entrypoint] cloning $GIT_REPO_URL → $REPO_DIR"
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone "$GIT_REPO_URL" "$REPO_DIR"
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
