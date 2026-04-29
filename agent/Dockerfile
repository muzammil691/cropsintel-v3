# CropsIntel V3 — Autonomous Agent runtime container
#
# Runs on Railway 24/7. Pulls latest code from GitHub, reads task queue,
# invokes Claude Code to write features, commits + pushes back.
#
# Architecture: see /agent/README.md
#
# IMPORTANT: runs as non-root user `claudeagent`. Claude Code's
# --dangerously-skip-permissions flag refuses to run as root for
# security reasons. Without that flag (or equivalent), claude --print
# silently produces zero file changes. See agent_loop_permission_bug
# memory file for full diagnosis.

FROM node:22-bookworm-slim

# System deps (git, openssh-client for git push, curl for Anthropic, jq for JSON, postgresql-client for supabase CLI, sudo for build-time only)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    curl \
    jq \
    ca-certificates \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Supabase CLI globally (root install)
RUN curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz \
    | tar -xz -C /usr/local/bin && \
    chmod +x /usr/local/bin/supabase

# Install Claude Code globally (root install)
RUN npm install -g @anthropic-ai/claude-code

# Copy agent scripts (still owned by root, executable by anyone)
COPY agent-loop.sh /usr/local/bin/agent-loop.sh
COPY notify-whatsapp.sh /usr/local/bin/notify-whatsapp.sh
RUN chmod +x /usr/local/bin/agent-loop.sh /usr/local/bin/notify-whatsapp.sh

# Create non-root user for Claude Code execution
# UID 1001 to avoid collision with default uid 1000
RUN useradd -m -u 1001 -s /bin/bash claudeagent && \
    mkdir -p /workspace && \
    chown -R claudeagent:claudeagent /workspace

# Switch to non-root user
USER claudeagent
WORKDIR /home/claudeagent

# Setup git identity for the non-root user
RUN git config --global user.name "CropsIntel V3 Agent" && \
    git config --global user.email "agent@cropsintel.com" && \
    git config --global core.sshCommand "ssh -i /home/claudeagent/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new"

# SSH key gets injected at container start via env var (see agent-loop.sh)
RUN mkdir -p /home/claudeagent/.ssh && chmod 700 /home/claudeagent/.ssh

# The loop runs forever (Railway treats this as a long-running service)
CMD ["/usr/local/bin/agent-loop.sh"]
