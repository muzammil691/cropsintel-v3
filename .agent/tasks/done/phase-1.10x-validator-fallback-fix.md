# Task: Phase 1.10x — Structural Validator Fallback Fix

## Goal
Patch the `atlas.propose_and_queue` fallback draft pipeline so that when Council is unavailable (404), the fallback draft function always injects all 4 required spec sections before the structural validator runs. Add a pre-queue section-injector as a safety net that detects missing required sections and injects them with correct markdown headers + placeholder content rather than failing hard.

## Background
The structural validator requires 4 mandatory sections: `# Task: Phase X.Y`, `## Success criteria`, `## Risks + mitigations`, `## NEVER list`. Council normally injects these. When Council is at 404, the fallback produces good content but drops these headers. The fix passes cannot reliably inject them. This has caused 6+ consecutive spec queue failures across multiple sessions, blocking all build work.

## Files to change
- `atlas/src/lib/propose-and-queue.ts` — patch fallback draft path to call section-injector before validator
- `atlas/src/lib/section-injector.ts` — NEW FILE — detects missing required sections, injects them with correct headers
- `atlas/src/lib/structural-validator.ts` — add explicit error message naming the exact missing section(s)
- `atlas/src/lib/council.ts` — add 404 fallback handler that logs Council unavailability and routes to fallback without crashing

## Success criteria
- [ ] When Council returns 404, fallback draft path runs without throwing
- [ ] `section-injector.ts` detects all 4 required sections and injects any that are missing
- [ ] Structural validator passes on a spec that went through section-injector
- [ ] Structural validator error messages name the exact missing section(s) verbatim
- [ ] `atlas.propose_and_queue` successfully queues a spec when Council is at 404
- [ ] Existing specs in queued/ and done/ are not modified
- [ ] All existing tests pass

## Risks + mitigations
- Risk: section-injector injects duplicate sections if Council partially succeeded → mitigation: injector checks for existing section headers before injecting, never duplicates
- Risk: injected placeholder content is too thin and spec fails Verifier later → mitigation: injector uses content-aware templates per section type, not empty strings
- Risk: patching propose-and-queue.ts breaks the happy path (Council available) → mitigation: injector only runs when Council returns 404, guarded by explicit status check

## NEVER list
- NEVER modify or delete specs already in .agent/tasks/queued/ or .agent/tasks/done/
- NEVER remove the structural validator — only make it more informative
- NEVER call LLM or external services from section-injector.ts — deterministic only
- NEVER change the 4 required section names or their markdown header levels
- NEVER touch builder.ts, verifier.ts, or any agent outside the Atlas propose pipeline
