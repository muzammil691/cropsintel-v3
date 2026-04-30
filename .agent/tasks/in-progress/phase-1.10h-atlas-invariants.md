# Task: Phase 1.10h — Atlas master plan invariants engine

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §8 (master plan invariants engine, 7 rules)
**Context:** Atlas should refuse dispatches that violate master plan rules. The invariants engine encodes the 7 rules from §8 and runs as a check inside the dispatcher.
**Estimated effort:** ~45 min
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Implement `atlas/src/lib/invariants.ts` exporting:
- `checkInvariants(dispatch)` → returns `{ allow, violations[] }` where each violation has `rule_id`, `description`, `severity`
- Wire it into `dispatch.ts` as a check that runs before any write-tool execution
- Log all violations (even allowed ones, when `severity=warning`) to `atlas_decisions` with `decided_by='atlas-auto'`

## The 7 rules

### Rule 1 — Phase order

Cannot dispatch work on Phase N before Phase N-1's done condition is met. Done conditions are documented in master plan §11.x. For v0.1, encode a simple check: if the dispatch creates a task spec named `phase-X.Y-...md` and any Phase X task lower than Y is still in `.agent/tasks/queued/` or `.agent/tasks/in-progress/` AND blocks this one, refuse.

For now, use a heuristic: a task at phase 1.6 cannot land if phases 1.1, 1.2, 1.3 are still queued. Look at the phase number prefix.

```ts
function checkPhaseOrder(args: { filename?: string }, repoRoot: string): Violation | null {
  if (!args.filename) return null
  const match = args.filename.match(/^phase-(\d+)\.(\d+)/)
  if (!match) return null
  const [_, major, minor] = match
  const targetMajor = parseInt(major, 10)
  const targetMinor = parseInt(minor, 10)

  // Read queued+in-progress task IDs
  const queued = readdirSync(resolve(repoRoot, '.agent/tasks/queued')).filter(f => f.endsWith('.md'))
  const inProgress = readdirSync(resolve(repoRoot, '.agent/tasks/in-progress')).filter(f => f.endsWith('.md'))

  for (const f of [...queued, ...inProgress]) {
    const m = f.match(/^phase-(\d+)\.(\d+)/)
    if (!m) continue
    const [_, mjr, mnr] = m
    const mj = parseInt(mjr, 10), mn = parseInt(mnr, 10)
    if (mj === targetMajor && mn < targetMinor) {
      // Earlier task in same major still pending — ok if same phase
      continue
    }
    if (mj < targetMajor) {
      return { rule_id: 'phase_order', severity: 'high', description: `Cannot start Phase ${targetMajor}.${targetMinor} while Phase ${mj}.${mn} (${f}) is still pending` }
    }
  }
  return null
}
```

### Rule 2 — Named layers stable

Refuse any dispatch that renames Adela, Atlas, Zyra. Detect via filename or content of queued spec.

```ts
const PROTECTED_NAMES = ['adela', 'atlas', 'zyra']

function checkProtectedNames(args: { filename?: string; body?: string }): Violation | null {
  const text = (args.filename ?? '') + ' ' + (args.body ?? '')
  for (const name of PROTECTED_NAMES) {
    const renamePattern = new RegExp(`\\b(rename|replace|deprecate)\\s+\\w*${name}\\b`, 'i')
    if (renamePattern.test(text)) {
      return { rule_id: 'named_layers', severity: 'high', description: `Refused: appears to rename/deprecate protected layer "${name}"` }
    }
  }
  return null
}
```

### Rule 3 — No parallel restarts

Refuse a dispatch that creates a second implementation of an existing module (e.g., `zyra-2.tsx` next to `zyra.tsx`).

```ts
function checkParallelRestart(args: { filename?: string; body?: string }): Violation | null {
  const text = (args.filename ?? '') + ' ' + (args.body ?? '')
  // Pattern: word + "-2" or "-v2" or "-new" referring to existing file
  const patterns = [/\b(\w+)-2\.(ts|tsx|js|jsx|sql)\b/i, /\b(\w+)-v2\.(ts|tsx|js|jsx)\b/i, /\b(\w+)-new\.(ts|tsx|js|jsx)\b/i]
  for (const pat of patterns) {
    const m = text.match(pat)
    if (m) {
      // Check if the original (without -2/-v2/-new) exists
      // For v0.1 just warn; tightening later
      return { rule_id: 'no_parallel_restart', severity: 'medium', description: `Suspected parallel restart: "${m[0]}" — should refactor original instead of creating second version` }
    }
  }
  return null
}
```

### Rule 4 — Scope rules (NEVER list)

Refuse dispatches involving items from master plan §11.6 NEVER list:
- Sale Contract issuance
- Purchase Contract issuance
- BC posting
- LC workflow
- Bank document presentation
- Multi-tenant SaaS

```ts
const NEVER_KEYWORDS = [
  /\bsale\s+contract\s+(issu|generat|creat)/i,
  /\bpurchase\s+contract\s+(issu|generat|creat)/i,
  /\bbusiness\s+central\s+(post|integrat|sync)/i,
  /\bletter\s+of\s+credit\s+(workflow|posting)/i,
  /\bbank\s+document\s+(present|workflow)/i,
  /\bmulti.?tenant\s+saas/i,
]

function checkNeverList(args: { body?: string }): Violation | null {
  const text = args.body ?? ''
  for (const pat of NEVER_KEYWORDS) {
    if (pat.test(text)) {
      return { rule_id: 'scope_never', severity: 'high', description: `Spec mentions item on the master plan §11.6 NEVER list (matched pattern: ${pat.source})` }
    }
  }
  return null
}
```

### Rule 5 — AI cost cap

Already enforced by 1.10g's checkBudget. Don't duplicate; instead this rule checks "would this dispatch push us over $400". Since checkBudget runs before invariants, this rule is a no-op here — but documented for completeness.

### Rule 6 — Verified-tier gating

If a spec adds verified-tier features but no admin review queue exists yet, refuse. Detect: spec contains "verified" tier keywords AND no `verified_review_queue` table exists in schema.

```ts
async function checkVerifiedTierGating(args: { body?: string }): Promise<Violation | null> {
  const text = args.body ?? ''
  const mentionsVerified = /\bverified[\s_-]+(tier|user|access)\b/i.test(text)
  if (!mentionsVerified) return null

  const sb = getSupabaseClient()
  const { data, error } = await sb.from('information_schema.tables').select('table_name').eq('table_name', 'verified_review_queue')
  if (error || !data || data.length === 0) {
    return { rule_id: 'verified_gating', severity: 'high', description: 'Spec mentions verified-tier features but `verified_review_queue` admin table does not exist yet (master plan 1.11b prerequisite)' }
  }
  return null
}
```

### Rule 7 — No client-side AI keys

Refuse specs that put API keys in `src/`, `public/`, or any `.env` shipped to client bundle.

```ts
function checkClientSideKeys(args: { body?: string }): Violation | null {
  const text = args.body ?? ''
  // Patterns that suggest client-side key embedding
  const dangerous = [
    /\bVITE_(ANTHROPIC|OPENAI|GEMINI|ELEVENLABS)_API_KEY/i,
    /\bprocess\.env\.(ANTHROPIC|OPENAI|GEMINI)_API_KEY\b.*\bsrc\//i,
    /import.*from\s+['"`].*api-key.*['"`]/i,
  ]
  for (const pat of dangerous) {
    if (pat.test(text)) {
      return { rule_id: 'no_client_keys', severity: 'high', description: `Spec appears to put AI API keys in client bundle (V2's mistake — never repeat). Match: ${pat.source}` }
    }
  }
  return null
}
```

## Wire into dispatcher

```ts
// In dispatch.ts, BEFORE the tool executes:
import { checkInvariants } from './invariants'

const invariantCheck = await checkInvariants(req)
if (!invariantCheck.allow) {
  await sb.from('atlas_decisions').insert({
    fork_question: `Invariant check on ${req.tool}`,
    options_considered: { proposed: req.arguments },
    chosen_option: 'BLOCKED',
    rationale: invariantCheck.violations.map(v => `[${v.rule_id}] ${v.description}`).join('; '),
    decided_by: 'atlas-auto',
  })
  return {
    dispatchId,
    status: 'blocked',
    error: `Master plan invariants violated: ${invariantCheck.violations.map(v => v.description).join('; ')}`,
    durationMs: Date.now() - start,
  }
}
```

## Acceptance criteria

After this task ships:

1. `atlas/src/lib/invariants.ts` exists, exports `checkInvariants`.
2. Each of the 7 rules has a function and is included in the check.
3. Smoke tests in `atlas/scripts/test-invariants.ts`:
   - Test rule 1: synthetic dispatch for phase-1.6 while phase-1.3 still queued → blocked with rule_id=phase_order
   - Test rule 2: spec body containing "rename Atlas to..." → blocked with rule_id=named_layers
   - Test rule 4: spec mentioning "Sale Contract issuance" → blocked with rule_id=scope_never
   - Test rule 7: spec with `VITE_ANTHROPIC_API_KEY` → blocked with rule_id=no_client_keys
4. Successful dispatch logs violations to `atlas_decisions` table.

## Out of scope

- Rule overrides (e.g., user explicitly accepts violation) — add later via /atlas/decisions endpoint
- Soft warnings that allow dispatch but flag for review — for v0.1, all violations block. Tighten later.
- Cross-spec analysis (detecting that two queued specs together violate something) — too complex for v0.1.

## Notes

- The invariants engine is conservative — when in doubt, block. Better to surface a fork question to user than ship something that violates the master plan.
- Each rule has a `rule_id` so violations can be filtered/silenced individually if needed.
- Severity levels for v0.1: only `high` blocks; `medium`/`low` log warnings and allow. Most rules are coded as `high`.
