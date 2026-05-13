---
primary-domain: frontend
---
```markdown
---
model: claude-sonnet-4-5
phase: 1.10bd
type: probe
---

# Task: Phase 1.10bd — Atlas-Alive Probe

**Master plan reference:** CropsIntel V3 Master Plan — Phase 1, §10 (Atlas/Frontend Liveness Verification)
**Estimated effort:** 5 minutes
**Model:** claude-sonnet-4-5

## Goal

Perform a minimal safe liveness probe on the CropsIntel V3 frontend repository. Add a single `console.log("atlas-alive")` statement to `src/main.tsx` and commit it with the message `chore: atlas-alive probe`. This confirms the repository is writable, the build pipeline is reachable, and Atlas can successfully author and commit changes — before any substantive feature work begins. No refactoring, no new imports, no logic changes.

## Files

| File | Change |
|---|---|
| `src/main.tsx` | Insert `console.log("atlas-alive");` as the first executable line inside the file (after existing import statements, before any JSX/render call). No other edits. |

No other files are touched. No lock files, no configs, no test files, no component files.

## Architecture

This task is deliberately architecture-neutral. The single `console.log` call:

- Introduces no new dependencies
- Touches no schema, API layer, state management, or business logic
- Has no effect on the rendered UI
- Is not a Shadcn component interaction and requires no accessibility, responsive, or design-token consideration
- Creates no runtime side-effects beyond a browser/Node console emission at module load time

The probe exists solely to verify the write → commit → CI pipeline is alive and functioning.

## Success criteria

Verifier checks all of the following:

1. `src/main.tsx` contains the exact string `console.log("atlas-alive")` after the final import statement.
2. No other file in the repository has been modified (verified via `git diff --name-only HEAD~1 HEAD` returning exactly `src/main.tsx`).
3. The commit message is exactly `chore: atlas-alive probe` (no trailing punctuation, no capitalisation variation).
4. The project still compiles without errors (`npm run build` or equivalent exits 0).
5. The project's existing test suite passes without modification (`npm test` or equivalent exits 0, if a test runner is configured).
6. No new imports, exports, or symbols have been introduced in `src/main.tsx`.
7. The `console.log` line does not appear inside a conditional block, function, or class — it must be top-level module scope.

## Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Builder edits additional files "while they're there" | Medium | NEVER list below; Verifier git-diff check (criterion 2) catches any drift. |
| `console.log` accidentally placed inside JSX return or a function body rather than module scope | Low | Success criterion 7 explicitly requires top-level module scope; Verifier rejects anything else. |
| Commit message typo or formatting variation | Low | Success criterion 3 requires exact string match. |
| Build pipeline not configured / `npm run build` absent | Low | If build script is missing, treat exit-0 as pass and note in Verifier output — this is itself a finding. |
| Gemini / council tooling unavailable during future runs | Medium | This spec is self-contained and does not depend on council re-runs; Builder works from this document only. |
| Downstream phases attempt to build on this probe before it merges | Low | Phase ordering in master plan §10 gates phase 1.11+ on 1.10bd completion; no dependency on unshipped work exists here. |

## NEVER list

Builder hard constraints — violation causes immediate task rejection:

- **NEVER** modify any file other than `src/main.tsx`.
- **NEVER** add, remove, or reorder import statements in `src/main.tsx`.
- **NEVER** refactor, rename, or reformat any existing code in `src/main.tsx`.
- **NEVER** add a `console.log` inside a function, class, hook, or JSX block — top-level module scope only.
- **NEVER** use `console.warn`, `console.error`, or any variant other than `console.log`.
- **NEVER** pass any argument other than the exact string literal `"atlas-alive"` to the `console.log` call.
- **NEVER** create new files, delete files, or modify `package.json`, `tsconfig.json`, lock files, CI configs, or any test file.
- **NEVER** open a follow-up PR or stack additional changes onto this commit.
- **NEVER** run `npm install` or mutate `node_modules`.
- **NEVER** alter the commit message from `chore: atlas-alive probe`.
```