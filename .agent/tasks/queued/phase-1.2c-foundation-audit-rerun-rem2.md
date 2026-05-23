---
priority: 1
remediation: true
remediation-attempt: 2
---
feat(phase-1.2c): re-run foundation audit gate against live-DB snapshot

## Prior failure — gaps to address (attempt 2)

The previous run of `phase-1.2c-foundation-audit-rerun` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: empty-diff-guard
- Severity: `fail`
- Expected: Non-empty code diff to audit
- Actual: Shipped code summary is empty or whitespace-only
- Remediation: Verify that spec.filesRequired is populated and files exist in the repo

