# ADR — Verifier cluster `7da23cc3f830` (3× `empty-diff-guard` on phase-1.2c chain)

- **Date:** 2026-05-23
- **Cluster id:** `7da23cc3f830`
- **Status:** Diagnosed — root cause confirmed; fix out of scope for this
  investigation, to be shipped under a separate task spec (see §5).
- **Multi-brain verdict:** 2-of-3 majority → investigate

## 1. Symptom

Three consecutive Verifier audits failed inside a 30-minute window, all on
the same task lineage and all with the identical gap signature
`check: empty-diff-guard`:

| # | Task id                                               | Time (UTC)                  |
|---|-------------------------------------------------------|-----------------------------|
| 1 | `phase-1.2c-foundation-audit-rerun`                   | 2026-05-23T12:48:12.720724Z |
| 2 | `phase-1.2c-foundation-audit-rerun-rem`               | 2026-05-23T12:54:37.611257Z |
| 3 | `phase-1.2c-foundation-audit-rerun-rem3`              | 2026-05-23T13:06:15.471759Z |

The `-rem2` run between (2) and (3) passed Verifier review (commit `7dd2a06`),
but did not break the cluster pattern because the conductor still
auto-requeued a rem3 on a separate gap signature (`gemini-judgment`) that
also tripped `empty-diff-guard` again.

## 2. Hypotheses checked

The task spec proposed four hypotheses. Findings:

| # | Hypothesis                                       | Verdict      |
|---|--------------------------------------------------|--------------|
| 1 | Recent migration broke a contract                | **Ruled out** — no migration touched `verifier/` or the audit artifacts in the cluster window. `git log supabase/migrations/` HEAD is `20260428000001_v3_foundation.sql`, unchanged. |
| 2 | Env var missing or rotated                       | **Ruled out** — `empty-diff-guard` fires deterministically inside `verifier/src/verify.ts:90-106` before any AI call. No secret read happens on this path. |
| 3 | Builder picked up a stale base                   | **Ruled out** — Builder commits `00a61f3`, `83128e8`, `7dd2a06`, `75f86b3` were each built on the prior head; `git log --oneline` shows a clean linear chain since the last green build `5b1aa7d`. |
| 4 | Verifier prompt regression in `verifier/src/verifiers/` | **Ruled out** — the four files under `verifier/src/verifiers/` are only invoked AFTER the empty-diff-guard. The guard fires before any judge call. |

The actual root cause is none of the four — it is a **contract gap in the
auto-requeue path** that turns one bad spec into a doomed retry loop.

## 3. Root cause

Two compounding gaps, both deterministic:

### 3.1 Original task spec was authored title-only

`commit 1cccb1a` queued `phase-1.2c-foundation-audit-rerun.md` with a
**one-line title-only body** (verified by `Read` → 1 line):

```
feat(phase-1.2c): re-run foundation audit gate against live-DB snapshot
```

The spec parser at `verifier/src/lib/spec-parser.ts:42-75` extracts file
paths only from backtick code spans, markdown table cells, and bullet lists
that match `(src|supabase|agent|verifier|adela)/...`. A title-only body
produces **zero** matches, so `spec.filesRequired = []`.

At `verifier/src/verify.ts:84`, `buildShippedCodeSummary(spec)` then calls
`loadShippedCodeContext({ spec, ... })`, which at
`verifier/src/lib/context-loader.ts:113` iterates `spec.filesRequired` — an
empty list — and returns `contextString = ''`. The empty-diff guard at
`verifier/src/verify.ts:90-106` correctly trips, emits the FAIL verdict,
and short-circuits judge invocation.

**This is the Verifier behaving exactly as designed.** The
`empty-diff-guard` was added in phase 1.00f precisely to refuse audits with
no diff to look at, rather than passing an empty prompt to o3 / Gemini and
risking hallucinated PASS verdicts. The guard is correct; the upstream
contract is broken.

### 3.2 Auto-requeue reseeds from the title-only original each round

`atlas/src/cron/conductor.ts:1957-1993` strips the `-rem<N>` suffix off the
failing task id to get the `rootTaskId`, then calls
`requeueWithGaps({ taskId: rootTaskId, attempt: nextAttempt })`.

`requeueWithGaps` at `atlas/src/lib/plan-server.ts:237-296`:

```ts
const failedPath = resolve(REPO_ROOT, '.agent/tasks/failed', `${args.taskId}.md`)
const donePath   = resolve(REPO_ROOT, '.agent/tasks/done',   `${args.taskId}.md`)
// ... reads originalContent from failedPath || donePath
// ... mutates frontmatter, appends a generated `## Gaps` section
const newContent = `---\n${fmText}\n---\n${body}\n\n${gapsSection}\n`
```

Because `args.taskId === rootTaskId === 'phase-1.2c-foundation-audit-rerun'`,
the function reads **the title-only original** every round and re-emits it
as the body of `-rem`, `-rem2`, `-rem3`. The Builder's enumeration work in
the prior remediation is **never inherited**: rem1 carried backtick paths
(commit `83128e8`), rem2 carried backtick paths (commit `7dd2a06`), but
when the conductor generated rem3 it pulled the title-only body and emitted
a spec with NO paths (verified by `Read`: rem3.md is 24 lines, 0 backticks).

The Verifier on rem3 then loads an empty `filesRequired` and trips
`empty-diff-guard` again, completing the cluster.

This violates the **anti-restart** rule (V3-CODING-INSTRUCTIONS §0): each
remediation attempt restarts from the broken original rather than building
on the previous attempt's fix.

### 3.3 Why rem1 also failed despite carrying backtick paths

Less clear, but the most plausible cause is a sync race in the Verifier
service. `verifier/src/server.ts:139` resolves the spec by reading the
filesystem; if the service had not yet `git pull`-ed to `head_after` at
audit time, it would see the pre-Builder body (title-only) for the rem1
filename. The Verifier's `syncToCommitOnDisk` guard exists for exactly this
reason, but its history shows recurring redeploy / pull issues (commit
`bc7ff0f`: "force verifier redeploy + literal-YYYY-MM-DD backstop"). This
is consistent with rem1 failing on the same signature.

## 4. Why this is not a false alarm

The Verifier's `empty-diff-guard` is correctly authored and correctly
firing. The cluster is real: a doomed retry loop driven by an upstream
contract gap. Without intervention, the same pattern will recur for any
task spec authored with no `filesRequired`-eligible paths in its body —
because the conductor will requeue from that same empty body forever,
capped only by the 3-attempt cap that then escalates to WhatsApp.

The rem2 success (commit `7dd2a06`) is incidental: it succeeded because the
Builder happened to author the rem2 body with enumeration AND the Verifier
happened to pull a fresh head in time. Neither condition is contractually
enforced.

## 5. Recommended fixes (out of scope for this investigation)

These should be authored as **follow-up task specs**, not shipped here.
Each is a small, contained surgical patch:

1. **Workshop pre-flight**: `parseTaskSpec` the queued spec before it
   lands in `.agent/tasks/queued/`. Refuse to queue if `filesRequired`
   is empty AND the spec is not explicitly tagged `audit-only: true` or
   similar. Catches the upstream gap at authoring time.
2. **`requeueWithGaps` inheritance**: when computing the body for
   attempt N, prefer the most recent existing remediation's body
   (`${rootTaskId}-rem.md` for N=2, `${rootTaskId}-rem<N-1>.md` for N≥3)
   over the title-only original. Falls back to the original only if no
   prior remediation exists. Restores anti-restart semantics across the
   auto-requeue chain.
3. **Verifier sync hardening**: add an assertion in
   `verifier/src/server.ts` that `git rev-parse HEAD` equals `head_after`
   AFTER `syncToCommitOnDisk` returns, and emit `verdict: 'unknown'` with
   `sync_failed` reason (already wired) on mismatch. Closes the rem1
   stale-pull window.

Each of these is a separate, independently-shippable fix. Recommended
priority order: 2 → 1 → 3 (the requeue inheritance bug is the largest
blast radius; the Workshop pre-flight catches the class at authoring;
the sync hardening is a belt-and-braces backstop).

## 6. Action taken in this investigation

- Diagnosed the cluster.
- Recorded the root cause and recommended fixes in this ADR.
- No code change shipped — per task spec acceptance criterion 2, fixes
  are deferred to follow-up task specs that Workshop will author.

## 7. Master plan reference

- V3-CODING-INSTRUCTIONS §0 (anti-restart rule)
- master plan §9.3 (Atlas agent rules — every agent emits a confidence
  score; sub-threshold flags to escalation queue)
- master plan §11.2 (Phase 1 sub-tasks — Phase 1.2c is the live-DB
  foundation audit rerun)
