# Task: Phase 1.10v — Verifier Verdict Aggregation Fix

## Goal
Fix the Verifier aggregation bug where `verdict: pass` is written to the result even when the `ai_judgment` text concludes a fail decision. Add `"inconclusive"` as an explicit VerdictValue so null is never coerced to pass. Extract a deterministic `council-parser.ts` that uses regex/keyword matching only (no LLM calls) to resolve AI judge disagreements.

## Background
On phase-1.10b-atlas-schema-followup (commit 839457f8), the Verifier returned `verdict: pass` with `passed: null` and `gaps: []` while the `ai_judgment` text explicitly stated "fail decision" and listed 4 critical missing components. This is an aggregation bug in the disagree-branch of verdict-resolver.ts. The null coercion to pass means real failures are silently masked as passes, undermining the entire audit pipeline.

## Files to change
- `verifier/src/lib/verdict-resolver.ts` — fix disagree-branch logic to read judgment text before writing verdict; never coerce null to pass
- `verifier/src/lib/council-parser.ts` — NEW FILE — deterministic regex/keyword parser that extracts pass/fail from judgment text without LLM calls
- `verifier/src/lib/gaps-builder.ts` — populate gaps[] when verdict = fail, even if individual judge gaps[] are empty
- `verifier/src/types/verdict.ts` — add `"inconclusive"` as explicit VerdictValue alongside `"pass"` and `"fail"`
- `verifier/src/tests/verdict-resolver.test.ts` — NEW FILE — regression tests covering: all-pass, all-fail, disagree-pass-wins, disagree-fail-wins, null-coercion-blocked, inconclusive

## Success criteria
- [ ] `verdict: pass` is never written when `ai_judgment` text contains fail keywords ("fail", "missing", "absent", "deficien")
- [ ] `passed: null` is never the final output — resolves to pass, fail, or inconclusive
- [ ] `gaps: []` is never returned when verdict = fail — at minimum a gap entry is synthesized from judgment text
- [ ] `council-parser.ts` uses zero LLM calls — deterministic regex only
- [ ] Regression test for phase-1.10b scenario passes: judgment says fail → verdict = fail
- [ ] All 3 verdict outcomes (pass/fail/inconclusive) covered by tests
- [ ] Existing passing audits are not retroactively changed

## Risks + mitigations
- Risk: regex keyword matching produces false positives on judgment text that says "no fail found" → mitigation: parser uses negation-aware patterns, e.g. "fail" not preceded by "no " or "not "
- Risk: adding inconclusive breaks downstream consumers expecting only pass/fail → mitigation: audit all consumers of VerdictValue in codebase before shipping, add inconclusive handler to each
- Risk: gaps synthesis from judgment text is too noisy → mitigation: synthesized gaps are clearly tagged as `source: "judgment-synthesis"` so they are distinguishable from direct judge gaps

## NEVER list
- NEVER modify stub-detector.ts or its patterns
- NEVER change judge prompt templates
- NEVER modify scraper fetchers or data ingestion pipeline
- NEVER use LLM calls anywhere in council-parser.ts
- NEVER retroactively mutate verdict records already written to the database
- NEVER remove the `"pass"` or `"fail"` VerdictValues — only add `"inconclusive"`
