# Task: Permission test — verify --permission-mode bypassPermissions works

**Estimated effort:** ~2 minutes
**Model:** claude-opus-4-7

model: claude-opus-4-7

## Goal

Tiny smoke test to verify Claude can actually use tools after the agent-loop.sh fix.

## In scope

Create a single file: `agent/.permission-test-PASSED.md` containing the text "Permission test passed at $(date -u +%FT%TZ)".

That's it. One file, one line. If this works, real tools work.

## Acceptance criteria

1. File `agent/.permission-test-PASSED.md` exists
2. File has at least one line of text
3. Commit includes this file (≥1 insertion)

