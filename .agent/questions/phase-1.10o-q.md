# Env vars for phase-1.10o — Verifier strict gate

**Not a question — this is an action required from you.**

The new strict-gate Verifier loop requires two new env vars on the **cropsintel-agent** Railway service.
Add them in Railway → your agent service → Variables tab:

| Variable | Value | Purpose |
|---|---|---|
| `VERIFIER_FAIL_CONFIDENCE_THRESHOLD` | `0.3` | Gate threshold (was 0.7). Any fail with confidence ≥ 0.3 blocks the push. |
| `MAX_REMEDIATION_ATTEMPTS` | `3` | After 3 failed remediations for a task, escalate to WhatsApp instead of queueing a 4th. |

These already have defaults in `agent/agent-loop.sh` (0.3 and 3 respectively), so the agent will work
correctly without them — but setting them explicitly lets you tune without redeploying code.

## What changed (summary)

- `run_verifier_gate()` now counts all remediation tasks across queued/in-progress/failed/done
- At 3 failures: `git reset --hard <head_before>` + WhatsApp escalation, no more remediation queued
- Remediation files now include full gap descriptions, severity, fix hints, and AI judgment notes
- `verifier/src/lib/spec-parser.ts`: routes only extracted from explicit `<Route path="...">` syntax
  (backend API paths like `/atlas/mode` no longer trigger false-positive route checks)
- `verifier/src/lib/spec-parser.ts`: lines with `(optional)` are filtered before path extraction
- `verifier/src/checks/routes-wired.ts`: backend route safeguard + spec-aware NotImplemented check
- `verifier/src/server.ts`: gaps now include `check`, `fix`, and `ai_judgment` fields
