---
priority: 1
remediation: true
remediation-attempt: 3
---
feat(phase-1.2c): re-run foundation audit gate against live-DB snapshot

## Prior failure — gaps to address (attempt 3)

The previous run of `phase-1.2c-foundation-audit-rerun` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: empty-diff-guard
- Severity: `fail`
- Expected: Task spec contains back-tick quoted paths for the four audit artifacts so spec.filesRequired is populated
- Actual: phase-1.2c-foundation-audit-rerun.md contains no back-tick paths; spec.filesRequired will be empty
- Remediation: Add the required file paths in back-ticks inside the task spec file exactly as listed in the remediation plan

### Gap 2: gemini-judgment
- Severity: `fail`
- Expected: The task spec's verification criteria require four specific audit artifacts to exist on disk so they can be loaded by the verifier. These are: `.agent/audit/live-schema-snapshot-2026-05-23.json`, `.agent/audit/gate-result-2026-05-23.md`, `.agent/audit/gap-report-2026-05-23.md`, and `.agent/audit/open-questions-2026-05-23.md`.
- Actual: Three of the four required files are missing from the codebase context. The context only contains `.agent/tasks/done/phase-1.2c-foundation-audit-rerun.md` and `.agent/audit/live-schema-snapshot-2026-05-23.json`. The other essential files are not present, making it impossible for the verifier to load the full context for the audit.
- Remediation: Ensure that all files enumerated in the task spec are included in the commit and provided in the codebase context. The verifier cannot audit files that do not exist at the specified paths.

