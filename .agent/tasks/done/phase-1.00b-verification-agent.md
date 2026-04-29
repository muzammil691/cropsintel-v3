# Task: Phase 1.00b — Verification Agent (the missing quality gate)

**Master plan reference:** new agent — D2 Scope Guardian (master plan 9.1) + extension of D3 Dev Loop quality control
**User instruction 2026-04-29:** "verify it" + "build a production house inside the production with verification agents"
**Critical context:** previous "shipped" tasks (Phase 1.3 auth, 1.04 RBAC, 1.05 landing) were STUBS — the build-green gate alone is not sufficient. The Verification Agent is the missing piece.

**AI separation principle (user instruction 2026-04-29):** The Builder is Claude Opus 4.7. The Verifier MUST NOT be Claude — using the same brain to verify itself produces blindspots. The Verifier uses OpenAI `o3` (reasoning model) + Gemini 2.5 Pro (large-context). Two independent AIs produce verification reports. If they disagree, escalate to Council. This is the production house's quality gate.

**Estimated effort:** ~6-10 hours
**Model for BUILDING this verifier code:** claude-opus-4-7
**Model that the verifier USES at runtime:** OpenAI o3 + Gemini 2.5 Pro (NEVER Claude)

model: claude-sonnet-4-6

---

## Goal

Build the **Verification Agent** — an automated quality gate that runs after every "shipped" task. It compares the task's acceptance criteria against the actual code shipped and either signs off or generates a remediation task.

This agent has two modes:
1. **Audit-only mode** — runs against any task in `.agent/tasks/done/` and produces a gap report
2. **Gate mode** — runs immediately after the dev-time agent commits, BEFORE the loop moves to the next task. If gaps are found, the task moves from `done/` back to `queued/` as a remediation task.

## In scope

### Repo structure
Create `verifier/` directory at repo root:

```
verifier/
├── Dockerfile
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts          ← entrypoint: dispatches based on argv (audit-all | audit-task | gate)
│   ├── verify.ts         ← THE CORE: takes task spec + commit, produces gap report
│   ├── checks/
│   │   ├── files-exist.ts        ← does every file the spec required exist?
│   │   ├── components-implemented.ts ← does each component have real code, not just a stub comment?
│   │   ├── migrations-applied.ts ← did the new migrations actually create the tables they should?
│   │   ├── routes-wired.ts       ← are routes mentioned in the spec actually in App.tsx?
│   │   ├── tests-exist.ts        ← did the spec require tests? Are they present and passing?
│   │   ├── deps-installed.ts     ← did the spec require new npm packages? Are they in package.json?
│   │   ├── stub-detector.ts      ← finds files matching common stub patterns (e.g. "// STUB", "// TODO: implement", "Phase X will wire...")
│   │   └── e2e-smoke.ts          ← attempts a Playwright headless smoke test if e2e tests exist
│   ├── verifiers/
│   │   ├── openai-o3.ts          ← uses OpenAI o3 (reasoning model) for deep code-quality verification
│   │   ├── gemini-2-5-pro.ts     ← uses Gemini 2.5 Pro (large context — can hold whole repo) for spec-compliance check
│   │   └── escalate-to-council.ts ← when o3 and Gemini disagree, sends question to Council for tiebreak
│   ├── lib/
│   │   ├── supabase.ts   ← V3 Supabase client (sb_secret_ key)
│   │   ├── audit.ts      ← writes verifier_runs to V3 Supabase
│   │   ├── notify.ts     ← WhatsApp on verification failures
│   │   └── git.ts        ← git operations for moving tasks back to queued/
│   └── types.ts
└── .gitignore
```

### Schema additions
Write `supabase/migrations/20260429xxxxxx_verifier.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.verifier_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL,                    -- 'phase-1.04-rbac' etc.
  task_spec_path text NOT NULL,             -- path to the task .md file
  commit_sha text NOT NULL,                 -- the commit being verified
  mode text NOT NULL CHECK (mode IN ('audit-only','gate')),
  passed boolean NOT NULL,
  gaps jsonb DEFAULT '[]'::jsonb,           -- array of {check, expected, actual, severity}
  remediation_task_id text,                 -- if gaps found, the new task's id
  duration_ms int,
  ran_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.verifier_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can read verifier runs" ON public.verifier_runs FOR SELECT USING (public.has_role(auth.uid(), 'team'));
```

### Core verifier (`verifier/src/verify.ts`)

```typescript
export interface TaskSpec {
  id: string                          // 'phase-1.04-rbac'
  filesRequired: string[]             // parsed from spec's "In scope" sections
  componentsRequired: string[]
  migrationsRequired: { tablesCreated: string[]; functionsCreated: string[] }
  routesRequired: string[]
  testsRequired: string[]
  acceptanceCriteria: string[]        // numbered list from "Acceptance criteria"
  outOfScope: string[]
}

export interface Gap {
  check: string                       // 'files-exist', 'stub-detector', etc.
  severity: 'fail' | 'warn'
  expected: string
  actual: string
  remediation: string                 // suggested fix in plain English
}

export interface VerificationResult {
  taskId: string
  passed: boolean
  gaps: Gap[]
  durationMs: number
  judgmentCallNotes: string           // Claude's narrative assessment
}

export async function verify(taskSpecPath: string, commitSha: string, mode: 'audit-only' | 'gate'): Promise<VerificationResult> {
  // 1. Parse task spec markdown into TaskSpec structure
  const spec = parseTaskSpec(readFileSync(taskSpecPath, 'utf-8'))

  // 2. Run all programmatic checks
  const gaps: Gap[] = []
  gaps.push(...await checkFilesExist(spec))
  gaps.push(...await checkStubDetector(spec))
  gaps.push(...await checkMigrationsApplied(spec))
  gaps.push(...await checkRoutesWired(spec))
  gaps.push(...await checkTestsExist(spec))
  gaps.push(...await checkDepsInstalled(spec))

  // 3. If basic checks pass, run e2e smoke
  if (!gaps.some(g => g.severity === 'fail')) {
    gaps.push(...await checkE2ESmoke(spec))
  }

  // 4. Two independent AI judgments (NOT Claude — Builder used Claude, so we use different models)
  //    o3 = deep reasoning, finds subtle bugs and spec gaps
  //    Gemini 2.5 Pro = 2M-token context, can hold the entire shipped code + spec at once
  let judgmentCallNotes = ''
  if (!gaps.some(g => g.severity === 'fail')) {
    const [o3Judgment, geminiJudgment] = await Promise.all([
      askO3Judgment(spec, /* shipped code summary */),
      askGemini25ProJudgment(spec, /* full shipped code (uses 2M context) */),
    ])

    // Both verdicts:
    // - If both PASS → real pass (high confidence)
    // - If both FAIL → real fail with combined gaps (high confidence)
    // - If they DISAGREE → escalate to Council for tiebreak (NOT decided by either alone)
    if (o3Judgment.passed === geminiJudgment.passed) {
      judgmentCallNotes = `o3: ${o3Judgment.notes}\n\nGemini 2.5 Pro: ${geminiJudgment.notes}`
      if (!o3Judgment.passed) gaps.push(...o3Judgment.gaps, ...geminiJudgment.gaps)
    } else {
      const councilTiebreak = await escalateToCouncil({
        question: `o3 says ${o3Judgment.passed ? 'pass' : 'fail'}, Gemini 2.5 Pro says ${geminiJudgment.passed ? 'pass' : 'fail'}. Who is right?`,
        context: { spec, o3Judgment, geminiJudgment, shippedCode: ... },
        depth: 'quick',  // tiebreak doesn't need deep mode
      })
      judgmentCallNotes = `DISAGREEMENT — escalated. ${councilTiebreak.finalDecision}`
      if (!councilTiebreak.passes) gaps.push(...councilTiebreak.gaps)
    }
  }

  return {
    taskId: spec.id,
    passed: !gaps.some(g => g.severity === 'fail'),
    gaps,
    durationMs: Date.now() - startedAt,
    judgmentCallNotes,
  }
}
```

### Stub detector (`verifier/src/checks/stub-detector.ts`)

Critical check. Scans the changeset for stub patterns:

```typescript
const STUB_PATTERNS = [
  /\/\/ STUB\b/i,
  /\/\/ TODO: implement/i,
  /\/\/ Phase \d+\.\d+ will/i,
  /<\w+ STUB/,
  /\bplaceholder\b/i,
  /\bcoming soon\b/i,
  /Real implementation lands in/i,
  /Real content lands in/i,
  /will wire \d+ login methods/i,
  /will be added later/i,
]

export async function checkStubDetector(spec: TaskSpec): Promise<Gap[]> {
  const gaps: Gap[] = []
  for (const filePath of spec.filesRequired) {
    if (!existsSync(filePath)) continue
    const content = readFileSync(filePath, 'utf-8')
    for (const pattern of STUB_PATTERNS) {
      if (pattern.test(content)) {
        gaps.push({
          check: 'stub-detector',
          severity: 'fail',
          expected: `${filePath} fully implemented`,
          actual: `${filePath} contains stub pattern: ${pattern}`,
          remediation: `Replace stub in ${filePath} with full implementation per task spec`,
        })
      }
    }
  }
  return gaps
}
```

### Judgment calls via OpenAI o3 + Gemini 2.5 Pro (NEVER Claude)

For nuanced verifications a regex can't catch (e.g., "is this implementation good enough or just minimal?"), TWO different models read independently:

**OpenAI o3** (reasoning model — slow but deep):
- Task spec + all files the task touched + acceptance criteria
- Outputs: structured `{ passed: boolean, gaps: Gap[], notes: string, confidence: number }`
- Why o3: extended chain-of-thought reasoning catches subtle spec violations (e.g., "spec said 4 login methods, this has only the form for 2")
- API: `openai.chat.completions.create({ model: 'o3', ... })`

**Gemini 2.5 Pro** (large context — fast and holistic):
- Same inputs but can also see the ENTIRE rest of the repo (2M token context)
- Outputs: same structured shape
- Why Gemini 2.5 Pro: can spot inconsistencies across the codebase that a per-file reviewer misses (e.g., "this new component uses X pattern, but the rest of the repo uses Y")
- API: `genai.getGenerativeModel({ model: 'gemini-2.5-pro' }).generateContent(...)`

**Combine logic:**
- Both pass → high-confidence pass
- Both fail → high-confidence fail (combine their gap lists, dedupe)
- Disagree → escalate to Council quick mode (Council's judge synthesizes; this avoids letting either AI alone decide)

**Why NOT Claude:** Builder is Claude. If Claude verifies Claude, both share the same training and reasoning patterns. Independent models = independent failure modes = catches more.

### Modes

#### Mode 1: audit-all (one-off CLI)
- `cd verifier && npm run audit:all`
- Iterates EVERY task in `.agent/tasks/done/`
- Runs verify() against each
- Outputs combined report to stdout + writes verifier_runs rows

#### Mode 2: audit-task (one-off CLI)
- `cd verifier && npm run audit phase-1.04-rbac`
- Verifies a single task

#### Mode 3: gate (cron / hook)
- Cron schedule: every 10 min
- Looks for tasks in `.agent/tasks/done/` that don't have a verifier_runs row yet
- Runs verify() on each
- If gaps found:
  1. Move the task file back to `.agent/tasks/queued/<task-id>-remediation-NNN.md`
  2. The remediation task spec includes the original spec + the gap report + a clear "fix these gaps" header
  3. Push to GitHub
  4. WhatsApp ping: "🔍 Verifier found gaps in <task-id>. Remediation queued."
- If clean: just record the success row.

### Integration with existing dev-time agent

Update `agent/agent-loop.sh` to call the verifier before marking a task done:

```bash
# After build green, before commit:
verifier_result=$(node /workspace/cropsintel-v3/verifier/dist/index.js gate --task-spec ".agent/tasks/in-progress/$TASK_NAME.md" --commit-sha HEAD)
if [ "$(echo $verifier_result | jq -r .passed)" != "true" ]; then
  # don't mark task done; move to remediation queue
  echo "[loop] Verifier rejected $TASK_NAME"
  /usr/local/bin/notify-whatsapp.sh "🔍 Verifier rejected $TASK_NAME — see logs"
  # ... move to .agent/tasks/queued/$TASK_NAME-remediation-1.md ...
  return 1
fi
```

(For now, build the verifier as a standalone service. Wiring into agent-loop.sh is a follow-up task once we trust the verifier is correct.)

## Out of scope (do NOT do in this task)

- Wiring verifier into agent-loop.sh (follow-up task once verifier proves itself)
- A web UI for browsing verifier_runs (Phase 2 admin work)
- Auto-remediation by the verifier itself (it generates remediation TASKS for the dev-time agent; doesn't fix code itself)

## First-run validation expectations

After the verifier ships and runs `audit-all`, it should immediately flag:
- `phase-1.3-auth` — STUB (Auth.tsx contains "Phase 1.3 will wire 4 login methods")
- `phase-1.5-public-landing` — INCOMPLETE (only Welcome page, no MarketInsight/News/About/Pricing pages)
- `phase-1.4-profile-org` — DELETED-CORRECTLY (clean-slate took it out, expected)
- `phase-1.5-dashboard-shell` — DELETED-CORRECTLY
- `phase-1.6-crm` — DELETED-CORRECTLY

The remediation tasks generated for 1.3 and 1.5 will then be picked up by the dev-time agent and properly built. This is the loop closing.

## Acceptance criteria

1. `verifier/` directory with the file structure above
2. `cd verifier && npm install && npx tsc` compiles cleanly
3. The 7 programmatic checks each have at least one passing test case AND one failing test case (vitest)
4. `npm run audit phase-1.04-rbac` runs successfully and returns a gap report (likely with gaps, given the agent's recent stubs)
5. `npm run audit:all` runs against the entire done/ folder and produces a combined report
6. Migration creates `verifier_runs` table with RLS
7. README.md is detailed enough for user to deploy as a 4th Railway service
8. Stub-detector regex catches the actual stubs in the current Auth.tsx and Welcome.tsx files
9. Verification of phase-1.05-public-landing flags missing pages (MarketInsight, News, About, Pricing)
10. The verifier itself uses Opus 4.7 for judgment calls — this is in the cost budget
11. Conventional commits

## Foundation check (BEFORE starting)

- Verify Phase 1.04 RBAC has `has_role()` SQL function (it does, in 20260428000001_v3_foundation.sql)
- Verify the dev-time agent infrastructure is stable (it is — multiple successful runs already)
- Verify all 4 AI keys are in Railway env (they are)

## Notes

- This is the SINGLE MOST IMPORTANT task right now. Without verification, every "shipped" feature is suspect. Until this exists, treat the agent's "done" status as "claimed-done", not "verified-done".
- The judgment-call Claude prompt is critical. Should explicitly ask: "Given this task spec and these files, is this a STUB or a real implementation? Be ruthlessly honest. A stub passes the build but doesn't satisfy the spec."
- After this ships, run audit-all immediately. The remediation tasks will queue automatically.
- DO NOT skip the e2e smoke check — Playwright can catch flows that look implemented but don't actually work.

---

**Done condition:** verifier exists, deploys cleanly, audit-all flags the existing stubs in Phase 1.3/1.5, remediation tasks are generated for them, the queue is repopulated with real work that the dev-time agent will pick up.
