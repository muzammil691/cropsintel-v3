-- ADR: Verifier false-positive elimination (phase-1.00b1)
-- Inserts the architectural decision record documenting the tuning choices made
-- in the spec parser and AI judgment layer.

INSERT INTO public.architecture_decisions (
  decision_number,
  title,
  status,
  context_md,
  decision_md,
  consequences_md
)
VALUES (
  1,
  'Verifier: Eliminate False Positives in Spec Parser + AI Judgment',
  'accepted',
  $$## Context

The first Verifier audit cycle (2026-04-29) produced 31 gaps across 6 tasks.
Investigation confirmed ALL 31 were false positives caused by:

1. **Placeholder filenames** — spec text like `20260429xxxxxx_verifier.sql` or
   `<task-id>-remediation-NNN.md` was treated as required file paths.
2. **External read-only paths** — paths the agent should READ (e.g. `~/Documents/...`)
   were treated as deliverables.
3. **Question files** — `.agent/questions/<id>-q.md` is optional (created only when
   the agent is blocked). Absence is success, not a gap.
4. **Self-reflexive stub detection** — `stub-detector.ts` flagged itself because
   it defines stub patterns as string literals that trivially match.
5. **Gemini hallucination** — Gemini reported routes missing from `src/App.tsx` that
   were present at lines 35-38; it judged from spec text without reading the file.
6. **Path variant mismatches** — `./src/foo.ts`, `/src/foo.ts`, and
   `cropsintel-v3/src/foo.ts` all resolved to the same file but were treated as
   three different required paths.$$,
  $$## Decision

Six targeted fixes, no structural changes to the Verifier flow:

### 1. spec-parser.ts — placeholder path filtering
Added `PLACEHOLDER_PATTERN_RE = /xxxxxx|<[^>]+>|phase-X\.YY|remediation-NNN/`.
Any extracted path matching this pattern is dropped before building `filesRequired`.

### 2. spec-parser.ts — path normalisation
`normalizePath()` strips `./`, leading `/`, and `cropsintel-v3/` prefix.
Applied after extraction; duplicates collapsed into a `Set`.

### 3. spec-parser.ts — question-file opt-out
Paths under `.agent/questions/` are filtered out of `filesRequired`.
These are fallback artifacts, not deliverables.

### 4. files-exist.ts — external path skip
Added `KNOWN_REPO_PREFIXES` list. Paths starting with `~/` or not matching any
known prefix are silently skipped — the agent only reads them, never creates them.
Also applies `normalizeFilePath()` before the existence check.

### 5. stub-detector.ts — self-exclusion list
`SCAN_EXCLUSIONS` array (regex list) prevents the stub-detector source file and
test fixtures from being scanned for stub patterns — they contain pattern literals
by design.

### 6. gemini-2-5-pro.ts — evidence-gated judgment
* Temperature lowered to 0.0 (was default, likely 1.0).
* Prompt now requires Gemini to **quote the relevant lines** before claiming
  anything is missing. If it cannot quote, it must drop the claim.
* Explicit self-check step: re-read each gap claim and verify by quoting.
* Placeholder/question-file/home-dir rules included in prompt as hard rules.$$,
  $$## Consequences

**Positive:**
- Expected false-positive count drops from 31 to ≤3 across 8 audited tasks.
- The 2 tasks that already passed (phase-0.99, phase-1.07b) continue to pass.
- Placeholder-heavy task specs (task queuing, roadmap tasks) can now be verified
  without noise.

**Trade-offs:**
- `files-exist` now silently skips external paths. A badly-formatted spec
  referencing `src/` files via a wrong prefix might be missed. Mitigation:
  `spec-parser.ts` normalises known prefixes before the check.
- Lowering Gemini temperature to 0 reduces creativity in gap discovery. This is
  intentional — evidence-based at 0.0 is more valuable than creative at 1.0 for
  a quality gate.
- Self-exclusion in stub-detector means those files are never stub-checked.
  Mitigated by the existing components-implemented check which reads the same files.$$
)
ON CONFLICT (decision_number) DO NOTHING;
