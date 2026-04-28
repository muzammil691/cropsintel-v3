# CropsIntel V3 — Autonomous Agent runtime container
#
# Runs on Railway 24/7. Pulls latest code from GitHub, reads task queue,
# invokes Claude Code to write features, commits + pushes back.
#
# Architecture: see /agent/README.md

FROM node:22-bookworm-slim

# System deps (git, openssh-client for git push, curl for Anthropic, jq for JSON, postgresql-client for supabase CLI)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    curl \
    jq \
    ca-certificates \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Supabase CLI (for migrations + edge function deploys)
RUN curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz \
    | tar -xz -C /usr/local/bin && \
    chmod +x /usr/local/bin/supabase

# Install Claude Code (Anthropic's coding agent CLI)
RUN npm install -g @anthropic-ai/claude-code

# Install Bun (some V3 tooling prefers it; harmless to have)
RUN curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Workdir is where we clone cropsintel-v3
WORKDIR /workspace

# Copy agent scripts into the image
COPY agent-loop.sh /usr/local/bin/agent-loop.sh
COPY notify-whatsapp.sh /usr/local/bin/notify-whatsapp.sh
RUN chmod +x /usr/local/bin/agent-loop.sh /usr/local/bin/notify-whatsapp.sh

# Setup git identity
RUN git config --global user.name "CropsIntel V3 Agent" && \
    git config --global user.email "agent@cropsintel.com" && \
    git config --global core.sshCommand "ssh -i /root/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new"

# SSH key gets injected at container start via env var (see agent-loop.sh)
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh

# The loop runs forever (Railway treats this as a long-running service)
CMD ["/usr/local/bin/agent-loop.sh"]
