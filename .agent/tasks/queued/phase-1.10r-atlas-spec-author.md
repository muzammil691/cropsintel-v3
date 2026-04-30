# Task: Phase 1.10r — Atlas as primary spec author (wraps Council)

**Master plan reference:** Atlas master spec §6 (multi-brain), §7 (tools), §11.2 row 1.10. User directive 2026-05-01: Atlas owns feature spec authorship from this point forward.
**Context:** Today Atlas can call `council.write_spec` but spec authorship still requires the user (or Claude Code) to pre-write the markdown. This spec turns Atlas into the primary author: when the user says "build feature X" in chat / WhatsApp / live mode, Atlas runs a multi-brain debate, drafts the full spec markdown, shows it in chat for sign-off, and on YES calls `builder.queue_spec` (which auto-commits+pushes per commit `6baecd1`). The user no longer hand-writes specs.
**Estimated effort:** ~75 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

1. New tool `atlas.draft_spec` — given a phase ID and freeform goal, returns a full spec markdown matching the format of `phase-1.10n-designer-agent.md`. Internally calls `council.write_spec` (battle-tested) AND a multi-brain debate review pass to harden the draft.
2. New tool `atlas.propose_and_queue` — orchestrates: draft → user sign-off in chat → queue. Stays paused on user response in `confirm` mode; auto-queues in `auto` mode (subject to invariants + cost gate that already exist).
3. Chat handler (server.ts) recognizes intent patterns ("build me X", "queue spec for Y", "open phase Z", "we need a spec to do W") and offers `atlas.propose_and_queue` proactively rather than waiting for explicit tool name.
4. After queuing, Atlas reports the spec filename + git SHA + queue position, and pings WhatsApp with a one-liner.
5. Spec drafts include all the rigor of hand-written specs: master plan reference, model directive, file list, schema additions, success criteria, risks, NEVER list. Draft template lives in `atlas/src/lib/spec-template.ts`.

## Architecture

```
atlas/
├── src/
│   ├── lib/
│   │   ├── spec-template.ts            (NEW)
│   │   ├── spec-draft.ts               (NEW — multi-brain draft + review pipeline)
│   │   ├── intent-detect.ts            (NEW — heuristic: which tool does user want)
│   │   ├── tools.ts                    (extend — add atlas.draft_spec, atlas.propose_and_queue)
│   │   └── ...
│   └── server.ts                       (extend — wire intent detection)
```

## Pipeline

```
User: "Build me a profile-edit page for subscribers"
   ↓
intent-detect.ts → matches 'build' verb + feature noun → suggests atlas.propose_and_queue
   ↓
atlas.propose_and_queue:
   1. multi-brain.simple() → "Identify which master-plan phase this fits" → '1.7c'
   2. memory.search → fetch master plan §11.2 row for that phase + V2 reference
   3. council.write_spec → first-draft markdown
   4. multi-brain.debate → 3-way review of the draft (Claude/GPT/Gemini)
   5. apply suggested fixes → final spec markdown
   6. spec_template.validate(final) → ensures all required sections present
   7. emit 'spec_drafted' SSE event with full markdown for ChatPanel preview
   8. mode === 'auto' → call builder.queue_spec immediately
      mode === 'confirm' → wait for "YES" in next user message; cancel on "NO" or 5-min idle
      mode === 'chat' or 'passive' → emit summary, do NOT queue
   9. After queue: call builder.list_queue → verify file in queue → report SHA + position
```

## Spec template (validate against)

`atlas/src/lib/spec-template.ts` exports `validate(markdown: string): { ok: boolean; missing: string[] }`.
Required sections (case-insensitive header match):
- `# Task: Phase X.Y — <name>`
- `**Master plan reference:**` line
- `**Estimated effort:**` line
- `**Model:**` line
- `model:` frontmatter (Builder reads this; see `agent-loop.sh:353`)
- `## Goal`
- `## Files` or `## Architecture`
- `## Success criteria`
- `## Risks + mitigations`
- `## NEVER list`

If any section is missing, draft fails validation; pipeline auto-retries with the missing-section list as additional context, max 2 retries.

## Intent detection

`intent-detect.ts` uses simple regex + keyword matches for low cost (no LLM call):

```typescript
const INTENT_PATTERNS: Array<{ pattern: RegExp; tool: ToolName; reason: string }> = [
  { pattern: /\b(build|ship|queue|spec|open phase)\b.*\b(page|feature|service|widget|spec|task)\b/i, tool: 'atlas.propose_and_queue', reason: 'feature-request intent' },
  { pattern: /\b(cancel|drop|kill)\b.*\bspec\b/i, tool: 'builder.cancel_task', reason: 'cancel intent' },
  { pattern: /\b(status|how|where are|progress)\b/i, tool: 'status.snapshot', reason: 'status query' },
  // ... more
]
```

The chat handler runs these BEFORE invoking Claude — if a high-confidence pattern matches, it adds a system message hint: "User likely wants to invoke <tool>. Ask for confirmation if details are unclear."

This is advisory, not deterministic — the LLM remains free to call other tools.

## Files

- `atlas/src/lib/spec-template.ts` (NEW)
- `atlas/src/lib/spec-draft.ts` (NEW — orchestrates Council + multi-brain review)
- `atlas/src/lib/intent-detect.ts` (NEW)
- `atlas/src/lib/tools.ts` (extend — register `atlas.draft_spec`, `atlas.propose_and_queue`)
- `atlas/src/lib/dispatch.ts` (extend — these new tools count as `confirm`-able writes)
- `atlas/src/server.ts` (extend — intent-hint injection; SSE event `spec_drafted` for ChatPanel preview)

## Success criteria

- `npm run build` clean in `atlas/`
- E2E test in `confirm` mode: send "Atlas, queue a spec for Phase 1.7a position-reports page" → Atlas drafts the markdown → user sees full draft in chat → user replies "YES" → Atlas calls `builder.queue_spec` → verifies via `builder.list_queue` → confirms SHA + queue position
- Same test in `auto` mode: same flow but no YES needed; queues immediately under invariants + budget gates
- Same test in `chat` mode: drafts and shows but does NOT queue; reports "Currently in chat mode — flip to confirm or auto to actually queue."
- Drafted spec passes `spec_template.validate()` 100% of the time
- ToolChip in dashboard shows the full multi-brain debate cost + final SHA
- Atlas's `atlas_dispatches` rows show new tools used; `verified_at` populated (per 1.10q)

## Risks + mitigations

- **Risk:** Draft quality varies. **Mitigation:** Multi-brain review step + spec_template.validate forces structural rigor; user always sees the full draft in `confirm` mode.
- **Risk:** Cost: 1 Council call + 1 multi-brain debate ≈ $0.30-$0.50 per spec. **Mitigation:** budget gate already enforces $400/mo cap; cost-log per dispatch.
- **Risk:** Council service down → draft fails. **Mitigation:** Fallback path — if `council.write_spec` errors, Atlas drafts directly via `multi-brain.simple()` using `spec-template.ts` as scaffold; emits warning to user.
- **Risk:** User says "YES" 10 minutes after the draft, by which time the chat session has rotated. **Mitigation:** Persist pending-drafts in `atlas_pending_specs` table with TTL 1 hour; reload on user reply.

## Schema addition

```sql
CREATE TABLE IF NOT EXISTS public.atlas_pending_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id text NOT NULL,
  spec_markdown text NOT NULL,
  filename text NOT NULL,
  drafted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  resolved_at timestamptz,
  resolution text          -- 'queued' | 'cancelled' | 'expired'
);
```

## NEVER list

- Never queue a spec without showing the full markdown to the user first (in `confirm` mode).
- Never silently change a draft after the user has approved — if user says "tweak X", run the pipeline again, show new draft.
- Never invent phase numbers — if user asks for a phase the master plan doesn't have, refuse and ask them to clarify.
- Never violate master plan §11.6 NEVER list (Sale Contracts etc.) — invariants engine should already block, but spec drafts must self-audit.
