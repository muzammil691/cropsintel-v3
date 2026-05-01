---
priority: 2
depends-on: [phase-1.10aj-atlas-auth-and-live-sync]
---

# Task: Phase 1.10al — Atlas v2 smart diagnosis (cascading fix logic for Active Artifacts)

**Master plan reference:** §1.10 conductor auto-remediate; §9.2 R3 Atlas self-management.

**Context:** Active Artifacts pane currently shows failures (designer audits, verifier blocks, open forks) but doesn't TELL the user how to fix them. User has to manually triage. This spec adds a diagnosis layer that, for every artifact, classifies the failure into one of three actionable buckets:

1. **Atlas can fix this autonomously** — schedule remediation now (existing 1.10p path)
2. **Needs Claude Code in VS Code** — generate a paste-able prompt with full context
3. **Needs an in-app action** — render the action button (e.g., "Click to flip trust mode", "Click to rotate API key")

Plus a fourth fallback: **Needs the user to discuss with Atlas** — opens chat pre-loaded with the failure context.

**Estimated effort:** ~75 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Diagnosis classifier (`atlas/src/lib/diagnose.ts`)

```typescript
export type DiagnosisBucket =
  | { bucket: 'auto-remediate'; spec_filename: string; spec_body: string; reason: string }
  | { bucket: 'claude-code'; prompt: string; affected_files: string[]; reason: string }
  | { bucket: 'in-app-action'; action_id: string; label: string; payload: Record<string, unknown>; reason: string }
  | { bucket: 'discuss'; chat_seed: string; reason: string }

export interface ArtifactInput {
  kind: 'designer_audit' | 'verifier_run' | 'workflow_violation' | 'open_fork' | 'pending_spec'
  ref: string         // e.g., the gap object, the verifier_runs row, etc.
  payload: Record<string, unknown>
}

export async function diagnose(input: ArtifactInput): Promise<DiagnosisBucket>
```

**Internal logic:**

1. Pattern-match cheap cases first (no LLM call needed):
   - **designer_audit gap with `severity: 'medium'|'low'` and `check: 'mobile-responsive'|'motion'|'shadcn-usage'`** → `auto-remediate` (schedule a remediation spec — same as 1.10p path)
   - **verifier_run with `passed: false` and gap.actual contains `"<NotImplemented`** → `in-app-action` (it's a stub page; `label: "Mark stub as intentional"`, action writes to `verifier_waivers` table)
   - **verifier_run with `gap.check === 'gemini-judgment'` and `gap.actual contains '404 Not Found'`** → `in-app-action` (`label: "Update GEMINI_MODEL env var"`)
   - **open_fork with diverging branches but no commits in 24h** → `discuss` (cold fork, ask user)
   - **workflow_violation `verifier_audit_missing`** → `auto-remediate` (re-run the audit)

2. For everything else, call Claude (opus-4-7) with a tight prompt:
   ```
   Given this artifact failure:
   <full payload>
   
   Classify into one of:
   - "auto-remediate" if Atlas's existing tools (builder.queue_spec, designer.review_spec) can fix this without human help
   - "claude-code" if the fix requires editing source files Atlas can't touch (Atlas runs in a sandboxed Railway container without write access to src/)
   - "in-app-action" if a single button click would fix this (env var, trust mode, dismiss-as-waived, etc.)
   - "discuss" otherwise
   
   Respond as JSON with the bucket + the materials needed.
   ```

3. Cache classifier results in `atlas_diagnosis_cache` (keyed by `artifact_kind + sha256(payload)`) for 24h to avoid re-classifying the same gap repeatedly.

### Part B — Server route + ArtifactCard integration

**`POST /atlas/artifacts/diagnose`** — body `{ kind, ref, payload }` → returns `DiagnosisBucket`.

**Frontend:** every artifact card (DesignerAuditCard, VerifierFailCard, OpenForkCard) gets a new "Diagnose" button below the existing "Remediate / Dismiss". On click:
- Show a loading skeleton
- Call `/atlas/artifacts/diagnose`
- Render the result inline:
  - `auto-remediate` → button "Queue remediation spec now" (one-click, calls existing `builder.queue_spec`)
  - `claude-code` → expandable code block with the full prompt + a "Copy prompt" button + "Open in VS Code" button (uses the `vscode://` URL scheme to open VS Code with Claude Code activated)
  - `in-app-action` → render the suggested button directly with a confirmation dialog
  - `discuss` → button "Ask Atlas about this" → opens chat pane with `chat_seed` pre-filled

### Part C — Claude Code prompt generation (the meat of `claude-code` bucket)

When the classifier returns `claude-code`, the prompt must be SELF-CONTAINED:

```
You are working on cropsintel-v3 (TypeScript + React + Vite + Supabase).

PROBLEM:
<verbatim failure description from the artifact>

AFFECTED FILES (read these first):
- src/components/atlas/AtlasShell.tsx (lines 226, 232, 303)
- src/components/atlas/AtlasTopNav.tsx (lines 48, 93)

EVIDENCE:
- Designer audit verdict: fail
- Gap 1: [full gap object pretty-printed]
- Gap 2: ...

WHAT TO DO:
1. Read the affected files completely.
2. Apply the changes per each gap's `remediation` field.
3. Run `npm run build` and fix any TS errors.
4. Commit with: `fix(atlas-pd): designer audit follow-up — <summary>`
5. Push to main. CI will trigger redeploys; Designer will re-audit automatically.

CONSTRAINTS:
- Use only shadcn/ui components, lucide-react icons, and Tailwind classes already in use.
- Do not modify any file outside the AFFECTED FILES list.
- Do not add new npm packages.
- If you discover the gap description is wrong, write a `.agent/questions/<task-id>-q.md` file and stop.
```

The prompt builder MUST include:
- The actual file content of each AFFECTED FILE (truncated to 3KB per file if >3KB)
- The full gap details
- The git HEAD sha so the user knows which commit the diagnosis was based on

### Part D — Workflow chain analysis (the `discuss` bucket fallback)

When all heuristics fail and Atlas wants to escalate to discussion, it should NOT just dump the raw payload. It should walk the workflow chain:

```
Trace artifact backward:
- This designer_audit failed on commit abc123
- abc123 was built from spec phase-1.X-foo
- phase-1.X-foo was queued by atlas:conductor on YYYY-MM-DD
- atlas:conductor queued it because it detected gaps in commit def456 (the parent design audit)
- def456 was built from spec phase-1.X-foo (the SAME spec — this is a remediation loop)

Diagnosis: this is the third remediation attempt on the same gap chain.
Atlas should escalate to: "Builder cannot fix this gap; the spec is ambiguous.
Should I rewrite the spec or pause this thread?"
```

This trace lives in `atlas/src/lib/workflow-trace.ts` (extend existing `invariants.ts` if it has trace utilities) and is invoked by the `discuss` bucket.

The chat seed includes the trace so Atlas's response in chat reads like a senior engineer's diagnostic ("I've traced this back 3 commits; here's what I see; here are 3 options").

## Files

- `atlas/src/lib/diagnose.ts` (NEW)
- `atlas/src/lib/workflow-trace.ts` (NEW or extend existing invariants)
- `atlas/src/lib/claude-code-prompt-builder.ts` (NEW)
- `atlas/src/server.ts` (extend — `/atlas/artifacts/diagnose` route)
- `src/components/atlas/DesignerAuditCard.tsx` (extend — Diagnose button)
- `src/components/atlas/VerifierFailCard.tsx` (NEW or extend existing)
- `src/components/atlas/OpenForkCard.tsx` (extend)
- `src/components/atlas/DiagnosisResult.tsx` (NEW — renders the four bucket UIs)
- `supabase/migrations/20260501150000_atlas_diagnosis_cache.sql` (NEW)

## Success criteria

- `npm run build` clean
- Click "Diagnose" on the existing 12 stale designer audits → each returns a verdict within 5s
- At least 1 stale audit returns `auto-remediate` and successfully queues a spec
- At least 1 returns `claude-code` and the generated prompt is paste-ready (test by running it through Claude Code locally on this repo and confirming Claude makes sensible changes)
- At least 1 returns `in-app-action` (e.g., the gemini-model bug from prior Atlas WhatsApp output)
- Diagnosis cache prevents re-classifying the same payload within 24h (verified by inspecting `atlas_diagnosis_cache`)
- Workflow trace correctly identifies the 2371ee2e remediation loop as a 3rd-attempt failure

## Risks + mitigations

- **Risk:** Claude classifier hallucinates an in-app-action that doesn't exist. **Mitigation:** Frontend whitelist of known `action_id` values; unknown IDs render as "discuss" fallback.
- **Risk:** `claude-code` prompt embeds files that contain secrets. **Mitigation:** redact `*.env*` and any line matching `/sk-|api[_-]?key|secret|password/i` before embedding.
- **Risk:** Diagnosis is slow on artifact-heavy days. **Mitigation:** 24h cache + run classifier in parallel for bulk-diagnose ("Diagnose all" button = 12 parallel calls).

## NEVER list

- Never embed Anthropic / OpenAI keys in the generated `claude-code` prompts.
- Never auto-execute an `in-app-action` without an explicit user click.
- Never auto-retry an `auto-remediate` more than 2 times without escalating to `discuss` (prevents infinite remediation loops — the 1.10ag-style 2371ee2e bug).
