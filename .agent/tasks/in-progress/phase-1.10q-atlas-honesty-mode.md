# Task: Phase 1.10q — Atlas honesty mode

**Master plan reference:** Atlas master spec §1, §3 (trust modes), §6 (multi-brain). User directive 2026-05-01: "100% honest with me."
**Context:** For Atlas to be trusted in `auto` mode, the user must be able to believe everything Atlas says. Today Atlas can hallucinate completed actions, summarize tool calls it didn't make, or paper over errors. This spec hardens Atlas's behavior so it never claims a tool succeeded without verifying, surfaces every tool call transparently, and says "I don't know" when it doesn't. Foundation for trust-mode flips and live voice.
**Estimated effort:** ~50 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

1. Tighten Atlas's chat system prompt so the LLM is forced to ground every claim in tool output.
2. Wrap the existing `TOOLS` registry calls in a verification layer that double-checks side effects (e.g. after `builder.queue_spec`, re-list the queue and confirm the file is there).
3. Stream every tool call's arguments AND result back to the client over SSE — `ChatPanel`'s `ToolChip` already renders these; this spec just makes them mandatory.
4. Add a dedicated `atlas_dispatches` post-condition row: `verified_at` timestamp + `verified_evidence` JSON (e.g. for queue_spec, the `git rev-parse HEAD` after push).
5. Replace any "summary" prose in Atlas replies with explicit "I called X with args Y, it returned Z, here's what that means" structure when actions are taken.

## Architecture

```
atlas/
├── src/
│   ├── lib/
│   │   ├── tools.ts                    (existing — keep)
│   │   ├── dispatch.ts                 (extend with post-condition verifier)
│   │   ├── verify-side-effects.ts      (NEW — per-tool post-condition checks)
│   │   ├── system-prompt.ts            (NEW — central honesty prompt builder)
│   │   └── multi-brain.ts              (existing)
│   └── server.ts                       (extend chat handler to pass honest prompt + emit verified events)
```

## System prompt (the load-bearing change)

Create `atlas/src/lib/system-prompt.ts` exporting `buildHonestyPrompt(context)`. Mandatory clauses:

```
You are Atlas, the conductor of the CropsIntel V3 production house. You are speaking with Muzammil Akhtar, the founder. He has explicitly asked for 100% honesty.

NON-NEGOTIABLE RULES (violating any of these is failure):

1. Never claim an action succeeded without calling the relevant tool and reading its result.
2. Never summarize what you "would have done" as if you did it. If you cannot or did not act, say so explicitly.
3. When a tool returns an error, surface the exact error message verbatim — do not paraphrase, do not soften.
4. When you do not know something, say "I don't know" — never guess, never invent file paths, function names, or commit SHAs.
5. After any write-tool call (builder.queue_spec, builder.cancel_task, memory.ingest, adela.trigger_scrape, whatsapp.send), call the appropriate verification tool to confirm the side effect, and report the verification result before claiming success.
6. If trust_mode blocks a tool call, do not pretend the action happened. Report: "Trust mode is <mode>; that action was blocked. To unblock, flip to <higher mode>."
7. Show your work: when you make a decision, name the tools you used, what they returned, and how that drove the decision. The user can see these in the dashboard ToolChips — never describe a tool call you did not actually make.
8. If multiple tools could answer the user's question, say which you chose and why.
9. Refuse to summarize prior session "ships" or activity without first calling status.snapshot or git tools. If those return empty/error, say so.
10. End every action-taking message with a one-line "verified: <yes|no|partial>" footer.
```

## Side-effect verification

For each write tool, define a post-condition check in `verify-side-effects.ts`:

| Tool | Post-condition |
|---|---|
| `builder.queue_spec` | After call, `builder.list_queue` must include the new filename AND `git rev-parse HEAD` must equal the SHA returned. |
| `builder.cancel_task` | The task must NOT be in `queued/` and MUST be in `cancelled/`. |
| `memory.ingest` | `memory_runs` row exists with `created_at >= dispatch.initiated_at`. |
| `adela.trigger_scrape` | `adela_runs` row exists with `started_at >= dispatch.initiated_at`. |
| `whatsapp.send` | Twilio response includes `sid` AND status is `queued` or `sent`. |
| `designer.audit_commit` | Response has `verdict` field set. |

Each verifier returns `{ verified: boolean, evidence: object, error?: string }`. Wire into `dispatch.ts` so every successful tool call also runs its verifier, and the dispatch row is updated with `verified_at` + `verified_evidence`.

If verification FAILS, the dispatch row goes to `status='partial'` (new status), and the tool result returned to the LLM includes `{ ...result, verification_failed: true, evidence_collected: ... }`. The system prompt rule 5 then forces the LLM to surface that to the user.

## Schema addition

```sql
-- migration 20260501010000_atlas_dispatch_verification.sql
ALTER TABLE atlas_dispatches
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_evidence jsonb;

-- Add 'partial' to allowed statuses (existing CHECK constraint may need replacement)
-- If status uses an enum, expand it; if free text, no migration needed beyond above.
```

## Files

- `atlas/src/lib/system-prompt.ts` (NEW) — single source of truth for chat system prompt
- `atlas/src/lib/verify-side-effects.ts` (NEW) — post-condition verifiers
- `atlas/src/lib/dispatch.ts` (extend — call verifier after success; update row)
- `atlas/src/server.ts` (extend — use buildHonestyPrompt; ensure SSE emits verification events)
- `atlas/src/types.ts` (extend — ToolDispatchResult now includes verified)
- `supabase/migrations/20260501010000_atlas_dispatch_verification.sql` (NEW)
- `atlas/CLAUDE.md` if exists (extend — same honesty rules for any inline Claude calls)

## Success criteria

- `npm run build` passes in `atlas/`
- After deploy, asking Atlas "did you ship phase-1.10n?" returns evidence-grounded answer (calls `git log` via tool, reads result, reports actual state) — NEVER a hallucinated yes
- Every Atlas reply involving an action ends with `verified: yes/no/partial` footer
- ToolChip in dashboard shows all tool calls with args + result + verification line
- A test queue: ask Atlas to queue a fake spec → it calls `builder.queue_spec` → verifier confirms via `builder.list_queue` → both events visible in chat
- A blocked test: ask Atlas (in passive mode) to queue a spec → reply must say "Trust mode is passive; that action was blocked." NOT a fake confirmation
- `atlas_dispatches.verified_at` is non-null for every successful write call

## Risks + mitigations

- **Risk:** Verification tool calls double the write-cost. **Mitigation:** Verifier reads are cheap (single Supabase query / file stat); cost negligible vs. write itself.
- **Risk:** LLM ignores rules 1–10. **Mitigation:** Multi-brain echo check — periodically (1 of 10 messages) Claude Sonnet judges its own previous reply for honesty-rule violations and self-flags; logs to `atlas_decisions` for review.
- **Risk:** Verification timing race (Supabase row not yet committed when verifier reads). **Mitigation:** verifier retries up to 3 times with 200ms backoff before declaring `verified=false`.

## NEVER list

- Never silence an error to make output look cleaner.
- Never strip or shorten error messages from tool results before showing the user.
- Never claim a feature shipped if you can't point to a commit SHA via tool call.
