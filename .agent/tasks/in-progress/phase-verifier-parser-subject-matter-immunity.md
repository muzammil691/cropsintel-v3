---
priority: 1
source: ADR-2026-05-07-verifier-cluster-1778161030385.md (rem3)
track: verifier
---
# Task: Council parser — subject-matter immunity for fail keywords

**Master plan reference:** section 9.3 (every agent's actions write to its audit log; every agent emits a confidence score)
**V3-CODING-INSTRUCTIONS reference:** section 0 rule "Anti-restart" — fix the parser in place, no parallel implementation
**Estimated effort:** 0.5 day

## Goal

Stop `verifier/src/lib/council-parser.ts:parseJudgmentText` from over-triggering `verdict: 'fail'` on judges' writeups whose **subject matter** is a failure investigation.

On 2026-05-07 the same `phase-1.10af-workflow-quality-gates-fix` lineage produced **eight identical investigation clusters in under three hours**. The conductor side is being addressed by the queued spec at `.agent/tasks/queued/phase-conductor-cluster-dedupe-upgrade.md`. Even with that conductor dedupe in place, however, the verifier itself currently bricks every cluster-investigation ADR because the judges' pass-writeup uses words like *"Verifier failures"* and *"Verifier was failing"* — which the deterministic regex at `verifier/src/lib/council-parser.ts:15` (`FAIL_KEYWORDS = /\b(fail(?:s|ed|ing|ure)?|missing|absent|deficien\w*)\b/gi`) matches as a fail verdict.

The negation window in `verifier/src/lib/council-parser.ts:17` (`NEGATOR_BEFORE`, 40-char lookback) cannot help: these are not negated keywords, they are nouns that name the subject of the analysis. See ADR `docs/atlas-decisions/ADR-2026-05-07-verifier-cluster-1778161030385.md` rem3 for the full root-cause walk-through.

## In scope

### Parser changes

- `verifier/src/lib/council-parser.ts` — extend `findHits` to skip matches that fall inside any of the following regions, treating them as subject-matter rather than verdict:
  1. **Backtick code spans** (`` `Verifier failures` ``, `` `phase-1.10af-workflow-quality-gates-fix` ``). Use a one-pass mask before `pattern.exec` so positions inside backtick runs do not contribute to `findHits`.
  2. **Fenced code blocks** (triple-backtick blocks); scan them once and exclude all match offsets in their range.
  3. **Quoted strings** — straight `"…"` and curly `"…"` of length ≤120 chars. Useful when judges quote the spec body or other ADRs verbatim.
  4. **Task-id tokens** matching `/\b(phase-[0-9.]+(?:-[a-z0-9-]+)?|cluster-id-\d+|verifier-cluster-\d+)\b/i` — these names contain `fail`/`failure` (e.g. `phase-1.10af-workflow-quality-gates-fix`) and are not verdicts.
  5. **Paths** — anything that looks like `*.md`, `*.ts`, `*.sql` etc. (i.e. matches the `FILE_EXT_RE` in `verifier/src/lib/spec-parser.ts:3`) — same reason.
  6. **The 40-word window after a "subject:" / "topic:" / "investigating" / "investigation about" / "diagnose"-class introducer.** A judge writing *"this is an investigation about Verifier failures and the agent passed"* should not flip to fail.

- `verifier/src/lib/council-parser.ts` — add a tunable threshold: a single subject-matter-immune fail hit alone should not flip the verdict. Require **either ≥2 unnegated, non-immune fail hits OR ≥1 unnegated non-immune fail hit AND zero pass hits** before returning `verdict: 'fail'`. This protects against the "the implementation is missing the API call" pattern (true fail) while immunising against "the agent investigated a missing-API-call failure cluster" (subject matter).

### Tests

- `verifier/src/tests/council-parser.test.ts` — add cases:
  1. Judge text that quotes a verifier-cluster ADR title containing the words `Verifier failures` should resolve to `pass` when the rest of the text reads as pass.
  2. Judge text that names a task id like `phase-1.10af-workflow-quality-gates-fix` should not flip on the trailing `-fix` token.
  3. Judge text containing one un-negated `failed` followed by `passed`, `complete`, `approved` keywords should still resolve to `pass` (boundary case for the new threshold).
  4. Judge text that genuinely says `"the implementation failed because the migration is missing the trader_id column"` should resolve to `fail` (regression guard — the parser must not become *too* permissive).
  5. Round-trip property test: feed in the exact judges' notes from cluster `1778161030385` rem2 (verbatim from `gaps[0].actual`) and confirm the new parser returns `verdict: 'pass'`.

### Resolver wiring

- `verifier/src/lib/verdict-resolver.ts` — no logic changes required. The resolver already trusts `parseJudgmentText`; the fix lives entirely in the parser.

### Synthesis fallback

- `verifier/src/lib/gaps-builder.ts` — the `judgment-synthesis-judgment-text-fail` synthesizer at line 42-49 stays as a defence-in-depth for cases where the parser still returns `fail` legitimately. No change.

### Audit / observability

- `verifier/src/lib/audit.ts` — when `parseJudgmentText` flips a hit from `failHits` to `subjectMatterHits` (the new bucket), record the count in the run's audit row so we can monitor false-positive rate post-fix.

## Out of scope

- Re-running the eight historical cluster ADRs through the new parser. They are closed.
- Changing the conductor's debate verdict logic — that is `.agent/tasks/queued/phase-conductor-cluster-dedupe-upgrade.md`'s job.
- Touching `verifier/src/verifiers/` prompt files. The bug lives in deterministic post-processing, not in the prompts.

## Acceptance criteria

1. The five new test cases in `verifier/src/tests/council-parser.test.ts` pass on `npm run --prefix verifier test`.
2. `parseJudgmentText` returns `verdict: 'pass'` for the verbatim judges'-notes excerpt embedded in `docs/atlas-decisions/ADR-2026-05-07-verifier-cluster-1778161030385.md` rem3.
3. The phase-1.10b regression guard still passes — i.e. judge text saying *"passed=true but the migration failed"* still resolves to `fail`.
4. `npm run build` is green at the project root.
5. Audit log captures the new `subjectMatterHits` count.

## Notes

The parser must remain **deterministic and LLM-free** (per the file's own header comment at `verifier/src/lib/council-parser.ts:1-12`). The fix is regex / windowing / threshold logic — do not introduce a model call.
