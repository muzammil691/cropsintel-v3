---
priority: 9
depends-on: [phase-1.10ah-verifier-quality-fixes]
---

# Task: phase-test-verifier-fix — Smoke test for verifier quality fixes

**Master plan reference:** none (operational smoke test for phase-1.10ah).

**Context:** Phase 1.10ah disabled boot retro-audit and rewrote the verifier
context loader. We need a tiny no-op task that the autonomous loop can ship
end-to-end so we can confirm the verifier's `/audit` HTTP endpoint returns
`pass` (not `unknown`) within 60 seconds.

**Estimated effort:** ~2 min Builder time
**Model:** claude-haiku-4-5-20251001

---

## Goal

Make a single trivial change: append a comment line to `verifier/README.md`
acknowledging that this smoke test ran. Nothing else.

## Files

- `verifier/README.md` (extend — append one comment line at end of file)

## Success criteria

- `verifier/README.md` ends with a line containing
  `<!-- smoke test phase-test-verifier-fix verified verifier audit path -->`
- `npm run build` is green (root project)
- Builder's `/audit` call to the verifier returns verdict `pass` within 60s
- A row appears in `verifier_runs` for `phase-test-verifier-fix` with verdict `pass`

## Risks + mitigations

- **Risk:** Smoke test pollutes README. **Mitigation:** It's a single HTML
  comment line; harmless. Can be removed in a follow-up `chore:` after the
  audit succeeds.

## NEVER list

- Never add functional code in this spec — it must remain a no-op smoke test.
