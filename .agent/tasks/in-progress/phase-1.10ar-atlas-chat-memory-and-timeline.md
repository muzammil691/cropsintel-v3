---
priority: 1
depends-on: []
---

# Task: Phase 1.10ar — Chat memory summarization + clickable timeline

**Master plan reference:** §1.10 conductor self-management; user vision discussion 2026-05-02 ("chat should recall what's happening and what was happening for more understanding").

**Context:** The Atlas chat persists every message in `atlas_conversations`, but the longer the thread runs the harder it is for the user to find earlier context, and the harder it is for Atlas to remember what was discussed two hours ago. Today the chat handler only loads the last 20 messages into Claude's context — anything older is invisible.

The user wants:

1. **Auto-summarize every 10 min of active conversation** — a rolling summary captures what was discussed, ingested into memory.
2. **Memory ingest** — the summary becomes a `memory_chunks` row with embeddings, retrievable by `memory.search`.
3. **Clickable scrollable timeline** above the chat — each summary is a chip; clicking it scrolls the chat to that segment + replays it as Atlas context.
4. **Atlas recall** — when the user references "earlier" or asks about prior conversation, Atlas pulls the relevant summary chunks into its prompt automatically.

**Estimated effort:** ~60 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Storage schema

Migration `supabase/migrations/20260502130000_atlas_chat_summaries.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.atlas_chat_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id text NOT NULL,
  -- Range of messages this summary covers (inclusive at both ends).
  range_start_msg_id uuid NOT NULL,
  range_end_msg_id uuid NOT NULL,
  range_start_at timestamptz NOT NULL,
  range_end_at timestamptz NOT NULL,
  message_count int NOT NULL,
  -- Single-paragraph summary used in the timeline chip.
  summary_short text NOT NULL,
  -- Up to ~500 word longer form for context recall.
  summary_long text NOT NULL,
  -- Topics / keywords for keyword-search fallback when embeddings miss.
  topics text[] DEFAULT '{}'::text[],
  cost_usd numeric(10,4) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Link back to the memory_chunks row that holds the embedded version of summary_long.
  memory_chunk_id uuid
);
CREATE INDEX IF NOT EXISTS idx_atlas_chat_summaries_thread_time
  ON public.atlas_chat_summaries (thread_id, range_end_at DESC);
ALTER TABLE public.atlas_chat_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "atlas_chat_summaries_service" ON public.atlas_chat_summaries
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
```

The summary row references a `memory_chunks` row so semantic search across the user's entire chat history works through existing memory machinery (no new search index).

### Part B — Summarization trigger + producer

**`atlas/src/lib/chat-summarizer.ts`** (NEW):

Two trigger conditions, whichever first:
- Wall clock: ≥10 min since the last summary OR since the thread started
- Message count: ≥30 new messages since last summary

Producer fn `maybeSummarize(threadId)`:
1. Look up most recent `atlas_chat_summaries.range_end_msg_id` for this thread (or null if first run).
2. Pull all `atlas_conversations` rows newer than that boundary, ordered by `created_at`.
3. If neither trigger condition met, return early.
4. Otherwise, call Claude (haiku for cost — this is a routine summarization) with:
   - System: "Summarize the following Atlas conductor chat segment. Output JSON with `short` (≤80 words, third-person), `long` (≤500 words, bullet points OK), `topics` (≤8 keywords). The user is the founder of CropsIntel running build agents through Atlas. Preserve technical detail (commit shas, spec ids, error messages, decisions)."
   - User: messages serialised as `[role] content` lines.
5. Insert `atlas_chat_summaries` row.
6. Insert paired `memory_chunks` row with `summary_long` as the indexed text + the existing memory.ingest pipeline. Link via `memory_chunk_id`.

**When to call it:**
- After every assistant turn completes in `server.ts`'s chat handler (fire-and-forget; never blocks the response).
- On a 5-min cron pass in `atlas/src/cron/conductor.ts` for threads that received messages but aren't in active streaming (covers WhatsApp inbound, voice, etc).

**Cost guardrail:** summarization rate-limited to 1 per thread per 5 min. The chat handler short-circuits if the last summary is <5 min old.

### Part C — Server route

**GET `/atlas/conversations/:threadId/summaries?limit=N`** (NEW):
- Auth required (existing `requireAuth`)
- Returns `[{ id, range_start_at, range_end_at, message_count, summary_short, topics, range_start_msg_id }]` ordered by `range_end_at DESC`, default limit 30.

The frontend uses this to render the timeline.

### Part D — Frontend timeline

**`src/components/atlas/ChatTimeline.tsx`** (NEW):

Renders a horizontal scroll bar **above** the message list:

```
┌──────────────────────────────────────────────────────────────┐
│ 12:30 OTP fix · 12:45 Audit tab wire · 13:00 Phase A ship · │
│ 13:20 Diagnose flow · 13:45 Memory plan ▶ now                │
└──────────────────────────────────────────────────────────────┘
```

Behavior:
- One chip per `atlas_chat_summaries` row
- Chip label: `<time>  <summary_short truncated to 30 chars>`
- Hover: tooltip shows full `summary_short` + topic chips
- Click: scrolls the message list to the message whose id matches `range_start_msg_id` (smooth scroll, briefly highlights the target message)
- Right edge: a `▶ now` marker for the live tail
- Horizontal overflow → scroll, with mouse wheel / trackpad horizontal-pan support
- Empty state: hide the bar entirely (no clutter on first conversation)

**Wired in `CockpitChat.tsx`:**
- Render `<ChatTimeline threadId={threadId} onChipClick={(msgId) => scrollToMessage(msgId)} />` between the pane header and the message list.
- Refetch summaries every 5 min OR after any user message that triggers a summary (use the same `atlas:chat-summary-created` CustomEvent pattern we're already using).

### Part E — Atlas recall (the "remember earlier" feature)

When the user types something like:

- "what did we discuss earlier?"
- "remind me about the OTP fix"
- "we talked about this yesterday"
- "before"  / "previously" / "earlier"

The chat handler should pull relevant summaries into the LLM context BEFORE calling Claude.

**Implementation in `atlas/src/server.ts` chat handler:**

After loading the last 20 messages, also:

1. Detect intent via lightweight heuristic: if the user message contains any of `(\bearlier\b|\bbefore\b|\bpreviously\b|\bremember\b|\brecall\b|\byesterday\b|\blast (week|time|night)\b|\bwhat (did|were|was)\b)` OR has `?` AND length >40 chars, fire memory recall.

2. If memory recall fires:
   - Call existing `memory.search` with the user's full message as query, scoped to `thread_id = web-default` filtered by `kind = 'chat-summary'` (we'll tag it that way at insert).
   - Take top 3 results.
   - Inject as a synthetic system message at the START of the messages array: `Earlier in this conversation:\n\n[12:30] <summary_long>\n\n[12:45] <summary_long>\n\n[13:00] <summary_long>`
   - Continue with the normal prompt.

3. The `memory_chunks.kind` column probably needs adding if it doesn't exist:
   ```sql
   ALTER TABLE public.memory_chunks ADD COLUMN IF NOT EXISTS kind text DEFAULT 'general';
   ```
   At insert time, chat-summary rows get `kind = 'chat-summary'`.

### Part F — Click-chip-to-replay UX

When user clicks a timeline chip:

1. The frontend scrolls to the matching message and highlights it for 2s.
2. The frontend ALSO sends a hidden context prefix to the chat handler on the user's NEXT message (stored in `localStorage.atlas_replay_context = { range_start_at, summary_long }`).
3. On that next chat send, the handler prepends a synthetic system message: `User clicked the timeline chip from [<range_start_at>]. Summary of that segment:\n\n<summary_long>\n\nUser is referencing back to that point.`
4. The localStorage flag is cleared after the next message.

This means clicking a chip + asking a question = Atlas replies with full context of the prior segment, naturally.

## Files

- `supabase/migrations/20260502130000_atlas_chat_summaries.sql` (NEW)
- `atlas/src/lib/chat-summarizer.ts` (NEW)
- `atlas/src/server.ts` (extend — chat handler triggers summarizer + recall heuristic + new GET route)
- `atlas/src/cron/conductor.ts` (extend — 5min summarizer sweep for inactive-but-not-summarised threads)
- `src/components/atlas/ChatTimeline.tsx` (NEW)
- `src/components/atlas/CockpitChat.tsx` (extend — render `<ChatTimeline />`, scrollToMessage helper, replay-context flag)
- `src/lib/atlas-client.ts` (extend — `fetchChatSummaries`)

## Success criteria

- `npm run build` clean
- After 10+ min of active conversation, a new chat-summary row appears in `atlas_chat_summaries`.
- Refresh the cockpit — the timeline bar appears above the chat with the summary chip.
- Click a chip → message list smooth-scrolls to that segment, target message briefly highlighted.
- Type a follow-up → Atlas's response shows it has context from that segment (e.g., references commit shas or specs from the summarised window).
- Type "what did we discuss earlier?" without clicking a chip → Atlas pulls the top 3 relevant summaries via memory.search and answers from them.
- Cost per summary <$0.005 (haiku-priced).

## Risks + mitigations

- **Risk:** Summarizer fires too often, costs spike. **Mitigation:** Hard rate-limit 1 per thread per 5 min; haiku only.
- **Risk:** Summary loses critical detail (a commit sha, an env var). **Mitigation:** System prompt explicitly preserves technical tokens; summary_long is also indexed in memory_chunks for retrieval.
- **Risk:** Timeline chip click scrolls to a message id that's been pruned from view. **Mitigation:** If the message is below the loaded window, fetch a wider history slice on click.
- **Risk:** Recall heuristic over-triggers and inflates Claude tokens on every message. **Mitigation:** Heuristic biased toward explicit reference words; injected context capped at 3 summaries × 500 words ≈ 2000 tokens.

## NEVER list

- Never block the chat response on summarization — fire-and-forget always.
- Never drop a chat message because summarization failed; degrade to no-summary mode silently.
- Never summarise across thread boundaries (the schema enforces per-thread).
- Never include OTP codes, session tokens, or `sk-` API keys in the summary text — strip those at producer time.
