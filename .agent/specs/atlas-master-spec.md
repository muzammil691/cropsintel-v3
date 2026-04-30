# Atlas — Master Spec

**Author:** Cowork → Muzammil Akhtar
**Date:** 2026-04-30
**Status:** Draft v1.0 — pending Muzammil sign-off
**Master plan reference:** §1.6 (named layer), §11.3 Phase 2.11/2.12 (Atlas UI + runtime). Brought forward from Phase 2 to Phase 1 by user decision 2026-04-30.

---

## 1. What Atlas is

Atlas is the **conductor** of the production house. It sits above the five existing dev-time services (Builder, Verifier, Memory, Council, Adela) and treats them as tools it dispatches.

Atlas's job is everything that currently requires Muzammil + Cowork in the loop:

- Decide what gets built next.
- Decompose phases into specs (or instruct Council to).
- Watch progress; react to failures.
- Hold the project's mental model.
- Talk to Muzammil from a phone, laptop, WhatsApp — same conversation thread.
- Enforce the master plan's invariants.
- Keep the AI cost budget under $400/month.

Atlas is **not** a runtime feature shipped to CropsIntel users. Atlas is a dev-time agent that builds and supervises CropsIntel itself. The customer-facing version of this name space is **Zyra** (Phase 1.10).

## 2. Architecture

```
                  Muzammil (chat / WhatsApp / mobile PWA)
                              ║
                              ▼
              ┌─────────── ATLAS ──────────────┐
              │  Multi-brain orchestrator       │
              │  Memory of every prior decision │
              │  Master-plan invariants engine  │
              │  Cost gatekeeper                │
              │  Tool dispatch                  │
              │  Status snapshot writer (cron)  │
              └─┬────┬────┬────┬────┬───────────┘
                ▼    ▼    ▼    ▼    ▼
            Council Builder Verif Memory Adela
            (specs) (code) (audit)(know) (data)
```

Atlas is a **separate Railway service** (service #6) — own container, own brain, own deployment cycle. The dashboard is its UI surface, but the work happens server-side.

## 3. Trust modes (single config flag, not a code change)

Atlas ships with four operating modes. The mode is set via env var `ATLAS_TRUST_MODE` and changeable without redeploy (read on every request).

| Mode | Behavior |
|---|---|
| `passive` | Reads project state, posts daily snapshots. **Cannot dispatch.** Cannot spend AI budget. Read-only. |
| `chat` | `passive` + can answer questions in chat. Can call read-only tools (Memory.search, status queries). Still cannot dispatch builds. |
| `confirm` | `chat` + can propose dispatches but each one requires Muzammil's `yes` in chat or WhatsApp. Trust-building. |
| `auto` | `confirm` + auto-dispatches under cost cap. Asks only on architectural forks (multi-brain disagreement, scope-questionable specs, budget warnings). |

Default at boot: `passive`. Muzammil flips to `chat` after sanity-checking the snapshot, then to `confirm` after a few approvals, then to `auto` when comfortable.

**Kill switch:** setting `ATLAS_TRUST_MODE=stopped` halts all dispatches immediately. Atlas keeps responding to chat ("I'm stopped, you'll need to flip my mode back to operate").

## 4. Schema additions

```sql
-- 4.1 Conversation thread (chat history, mirrored across web/WhatsApp/mobile)
CREATE TABLE atlas_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id text NOT NULL,          -- one continuous thread per user
  channel text NOT NULL,            -- 'web' | 'whatsapp' | 'mobile-pwa'
  role text NOT NULL,               -- 'user' | 'atlas' | 'system'
  content text NOT NULL,
  metadata jsonb DEFAULT '{}',      -- tool calls, dispatch IDs, cost tags
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_atlas_conv_thread ON atlas_conversations (thread_id, created_at);

-- 4.2 Snapshots (project mental model, written every 5 min by cron)
CREATE TABLE atlas_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at timestamptz NOT NULL DEFAULT now(),
  current_phase text,               -- e.g., 'Phase 1.3 — auth'
  queued_specs int,
  in_flight_specs int,
  done_specs_24h int,
  failed_specs_24h int,
  verifier_pass_rate numeric(5,2),
  memory_chunk_count int,
  cost_today_usd numeric(10,4),
  cost_month_to_date_usd numeric(10,4),
  open_forks jsonb DEFAULT '[]',    -- pending architectural questions for user
  raw_state jsonb DEFAULT '{}'      -- full JSON dump for dashboard
);

-- 4.3 Dispatch log (every action Atlas takes)
CREATE TABLE atlas_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiated_at timestamptz NOT NULL DEFAULT now(),
  trust_mode text NOT NULL,         -- mode at dispatch time
  initiated_by text NOT NULL,       -- 'cron' | 'chat:<thread_id>' | 'auto'
  tool text NOT NULL,               -- 'council.write_spec' | 'memory.search' | etc.
  arguments jsonb NOT NULL,
  result jsonb,
  cost_usd numeric(10,4) DEFAULT 0,
  duration_ms int,
  status text NOT NULL DEFAULT 'pending', -- 'pending'|'success'|'failed'|'cancelled'
  error_message text
);

-- 4.4 Decision log (architectural forks resolved)
CREATE TABLE atlas_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decided_at timestamptz NOT NULL DEFAULT now(),
  fork_question text NOT NULL,
  options_considered jsonb NOT NULL,
  multi_brain_votes jsonb,          -- {claude:'A', gpt:'A', gemini:'B'}
  chosen_option text NOT NULL,
  rationale text,
  decided_by text NOT NULL,         -- 'user' | 'atlas-auto' | 'multi-brain-quorum'
  related_phase text,
  related_specs text[]
);

-- 4.5 Cost log (per-call AI spend)
CREATE TABLE atlas_cost_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,           -- 'anthropic' | 'openai' | 'google' | 'elevenlabs'
  service text NOT NULL,            -- 'atlas' | 'council' | 'verifier' | etc.
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10,4) NOT NULL,
  request_metadata jsonb
);
CREATE INDEX idx_cost_log_date ON atlas_cost_log (occurred_at DESC);
```

## 5. API endpoints

Atlas runs an HTTP server on port 8080. All endpoints under `/atlas/*`. Auth via Bearer token in `ATLAS_API_TOKEN`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness, no auth |
| GET | `/atlas/status` | Current snapshot (latest row from `atlas_snapshots`) |
| GET | `/atlas/threads/:thread_id` | Full chat history for a thread |
| POST | `/atlas/chat` | Send a user message; returns streamed response (SSE) |
| GET | `/atlas/dispatches` | Recent dispatch log (paginated) |
| POST | `/atlas/dispatch` | Manually trigger a tool call (used by chat handler internally; exposed for power use) |
| GET | `/atlas/decisions` | List architectural decisions |
| POST | `/atlas/decisions` | User decides a pending fork (Atlas waits for this) |
| GET | `/atlas/costs` | Cost burn (today / month-to-date / by provider) |
| POST | `/whatsapp/inbound` | Twilio webhook — receives WhatsApp messages, routes to chat handler with `channel=whatsapp` |
| POST | `/atlas/mode` | Change trust mode (auth-gated, body `{mode: "auto"}`) |

## 6. Multi-brain orchestrator

Atlas decides three classes of things:

1. **Trivial** — single Sonnet call. (e.g., "list queued specs")
2. **Substantive** — Claude Sonnet first; if it expresses uncertainty or the question is high-stakes, escalate to debate.
3. **Architectural fork** — full multi-brain debate: Claude Opus + GPT-5 + Gemini 2.5 Pro each write an opinion; quorum of 2-of-3 → that option wins; 3-way split → ask Muzammil.

Reuses `council/src/pair-session.ts` and `council/src/providers/*.ts` patterns. New code lives in `atlas/src/lib/multi-brain.ts`.

**Quorum rules:**
- Default: 2-of-3 agreement → auto-decide
- High-stakes (anything affecting auth, billing, security): require 3-of-3 OR escalate to Muzammil
- High-stakes flag determined by spec-prompt heuristic (looks for keywords) + manual override list

## 7. Tool registry — what Atlas can call

```ts
// atlas/src/lib/tools.ts
const TOOLS = {
  // Memory
  'memory.search':       async (q: string) => POST(MEMORY_URL + '/search', { query: q }),
  'memory.ingest':       async (s: string) => POST(MEMORY_URL + '/ingest', { source: s }),

  // Council
  'council.write_spec':  async (phase: string) => /* Council /write-spec endpoint */,
  'council.debate_fork': async (q: string)     => /* Council /debate endpoint */,

  // Builder (via task queue, not HTTP)
  'builder.queue_spec':  async (filename, body) => writeFile('.agent/tasks/queued/' + filename, body),
  'builder.list_queue':  async ()              => listFiles('.agent/tasks/queued/'),
  'builder.cancel_task': async (taskId)        => moveFile(`queued/${taskId}.md`, `cancelled/${taskId}.md`),

  // Verifier
  'verifier.audit':      async (taskId, sha)   => POST(VERIFIER_URL + '/audit', { task_id: taskId, head_after: sha }),
  'verifier.recent_runs': async ()             => GET(VERIFIER_URL + '/runs'),

  // Adela
  'adela.trigger_scrape': async (source)       => POST(ADELA_URL + '/scrape', { source }),

  // Git/repo (via Supabase + GitHub API)
  'git.recent_commits':  async (n: number)     => /* GitHub API or local cache */,

  // Notification
  'whatsapp.send':       async (msg: string)   => POST(TWILIO + freeform text to Maxons number),

  // Status
  'status.snapshot':     async ()              => /* compute fresh snapshot, write to atlas_snapshots */,
}
```

Atlas's chat handler exposes these as tools to its underlying LLM (function-calling), with descriptions. The LLM picks which tool to call and Atlas executes.

## 8. Master plan invariants engine

`atlas/src/lib/invariants.ts` enforces master plan rules. Every dispatch is checked against:

1. **Phase order** — cannot work on Phase N before Phase N-1's done condition is met (per master plan §11.x).
2. **Named layers stable** — refuse renames of Adela / Atlas / Zyra.
3. **No parallel restarts** — refuse dispatches that create a second implementation of an existing module (e.g., `zyra-2.tsx` next to `zyra.tsx`).
4. **Scope rules** — refuse anything in the §11.6 NEVER list (Sale Contracts, BC posting, LC workflows, etc.).
5. **AI cost cap** — refuse dispatches that would push monthly burn over $400.
6. **Verified-tier gating** — admin-side review queue must exist before any verified-tier features ship (§1.4).
7. **No client-side AI keys** — refuse any spec that suggests embedding API keys in `src/` or `public/` (V2's mistake; explicit memory entry).

A dispatch that violates an invariant: Atlas writes to `atlas_decisions` with `decided_by='atlas-auto'` and the rationale, replies to the user explaining the block, does not dispatch.

## 9. Cost gatekeeper

Atlas tracks every API call's cost in `atlas_cost_log`. On each dispatch:

```
if month_to_date + estimated_dispatch_cost > $400:
   refuse; alert user; require explicit override token to proceed
elif month_to_date > $320 (80%):
   warn user in chat; proceed
elif daily_burn > $40 (3x normal):
   pause auto-dispatch for 1 hour; chat-mode only; alert user
```

Provider sub-budgets enforced separately (Anthropic $200, OpenAI $50, Gemini $50, ElevenLabs $100 per master plan §10.3).

## 10. Status snapshot writer (cron)

Runs every 5 minutes inside Atlas:

```
1. Query repo: git log --since="24 hours ago" --oneline
2. Query .agent/tasks/{queued,in-progress,done,failed}/ dir counts
3. Query verifier_runs for last 24h pass/fail
4. Query memory_runs for last ingest
5. Sum atlas_cost_log for today & month
6. Read pending forks from atlas_decisions where chosen_option IS NULL
7. Write a row to atlas_snapshots with all of the above
8. If anything notable changed (new fork, budget warning, big failure), push WhatsApp ping
```

Dashboard subscribes via Supabase realtime to `atlas_snapshots` and re-renders on each insert.

## 11. WhatsApp routing

Twilio webhook posts to `POST /whatsapp/inbound`. Atlas:

1. Identifies the thread by phone number → `thread_id` mapping.
2. Routes message to the same chat handler as web (`/atlas/chat`) with `channel=whatsapp`.
3. Writes both user message and Atlas reply to `atlas_conversations`.
4. Replies via Twilio API, freeform text (registered Maxons number `+12345622692`, see locked sender memory).

For outbound (Atlas → Muzammil unsolicited):
- Budget warnings, build failures, fork questions, daily summaries.
- Outbound is rate-limited to max 6 messages/hour to avoid spam.

## 12. Mobile PWA

Same dashboard frontend, served from `cropsintel.com/atlas` (or a subdomain). PWA manifest installs to home screen. WebSocket / Supabase realtime keeps state synced.

## 13. Dashboard frontend (separate task spec)

Single-page app, two columns:

```
┌──────────────────────────────────┬───────────────────────────┐
│ ATLAS chat                       │ STATUS panel              │
│  (left, primary interaction)     │  - current phase          │
│                                  │  - queue/in-flight        │
│  - SSE stream from /atlas/chat   │  - verifier pass rate     │
│  - markdown rendering            │  - cost burn              │
│  - tool-call visibility          │  - memory chunks          │
│  - approve/reject buttons for    │  - open forks (clickable) │
│    confirm-mode dispatches       │                           │
│                                  │ Recent ships:             │
│  Wizards (top): Open Phase,      │  ✓ 1.3.1 ...              │
│   Review Audit, Approve ADR      │  ⚠ 1.3.3 ... (re-queued)  │
│   Set Trust Mode                 │                           │
└──────────────────────────────────┴───────────────────────────┘
                  Mobile: tabs, chat default
```

Built with React + Tailwind + shadcn/ui (consistent with rest of CropsIntel frontend). Uses Supabase realtime for live status, fetch+SSE for chat.

## 14. Decomposition into Builder task specs

The Atlas master spec decomposes into these task files in `.agent/tasks/queued/`:

| Phase ID | Task | Effort |
|---|---|---|
| 1.10a | Atlas Railway service scaffold (package.json, Dockerfile, entrypoint.sh, tsconfig, basic Express/HTTP server with /health) | ~30 min |
| 1.10b | Atlas Supabase schema (migration with all 5 tables in §4) | ~15 min |
| 1.10c | Multi-brain orchestrator (port from council patterns, atlas/src/lib/multi-brain.ts) | ~30 min |
| 1.10d | Tool registry + dispatch executor (atlas/src/lib/tools.ts, atlas/src/lib/dispatch.ts) | ~30 min |
| 1.10e | Chat API endpoint with SSE streaming (atlas/src/server.ts, /atlas/chat handler) | ~30 min |
| 1.10f | WhatsApp inbound webhook (Twilio integration, /whatsapp/inbound handler) | ~30 min |
| 1.10g | Cost gatekeeper (atlas/src/lib/cost-gate.ts, $400 cap enforcement) | ~30 min |
| 1.10h | Master plan invariants engine (atlas/src/lib/invariants.ts, all 7 rules) | ~45 min |
| 1.10i | Status snapshot cron (atlas/src/cron/snapshot.ts, every 5 min) | ~30 min |
| 1.10j | Trust mode flag + kill switch (atlas/src/lib/trust-mode.ts) | ~15 min |
| 1.10k | Dashboard frontend — chat panel + status grid + wizards (separate React work in src/pages/Atlas.tsx) | ~3-4 hr |
| 1.10l | Mobile PWA polish (manifest, install prompt, offline shell) | ~1 hr |

**Total Builder effort: ~12-13 hours of code generation, executed in ~2 hours of wall clock if specs run sequentially through the loop.**

User effort: Read this spec (~10 min), answer ~3-5 architectural-fork WhatsApp pings as Council/Atlas raise them.

## 15. Success criteria

Atlas v1.0 is done when:

1. `https://atlas-production.up.railway.app/health` returns 200.
2. POST to `/atlas/chat` with a Bearer token streams a response that includes at least one tool call (`memory.search` or `status.snapshot`).
3. WhatsApp message to Maxons number routes to Atlas, gets a contextual reply.
4. `atlas_snapshots` has rows being inserted every 5 min.
5. `atlas_cost_log` has rows accumulating with non-zero costs.
6. Trust mode env var change (`passive` → `chat` → `confirm` → `auto`) takes effect within 60s without redeploy.
7. Dashboard at `cropsintel.com/atlas` (or temporary GitHub Pages route) shows live status grid + chat.
8. Killing Atlas service does NOT break Council/Builder/Verifier/Memory/Adela — they remain functional independently.

## 16. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Atlas dispatches in a runaway loop, blowing budget | Cost gatekeeper hard cap; trust mode `passive` default; kill switch via env var |
| Atlas's mental model goes stale | 5-min snapshot cron; every dispatch re-queries fresh state |
| Multi-brain debate too expensive | Tier the calls — only ~5% of dispatches escalate to debate; logged in cost_log per-call |
| Builder ships Atlas with bugs that block other agents | Atlas is independent service — Builder/Verifier/etc. unaffected if Atlas crashes |
| Frontend dashboard is wrong | Backend + WhatsApp = system functional even with broken UI; UI fixed in iteration |

## 17. Open questions for Muzammil

These need answers before Council writes the decomposition specs:

1. **Atlas's primary brain for chat:** Claude Opus (best reasoning, $15/M tokens) or Sonnet (5x cheaper, still excellent)? Recommend Sonnet for chat, Opus for architectural debate.
2. **WhatsApp identity:** does Atlas reply from the SAME registered Maxons number as Zyra runtime, or do we register a second number for dev-time? Recommend same number — Zyra hasn't shipped yet so no conflict; we re-register before Zyra.
3. **Dashboard URL:** subdomain `atlas.cropsintel.com` or path `/atlas` on existing site? Recommend `/atlas` for now (one less DNS step).
4. **Phone number authentication:** dashboard accessible only when authenticated (Supabase Auth) — but for solo Muzammil use, is a single magic-link / personal token enough?
5. **Trust mode default at first deploy:** `passive` (recommended) or `chat` (slightly faster to validate)?

These can be answered now or deferred to Council debate. If deferred, my recommended defaults stand.

---

**End of Atlas master spec v1.0.** Council should read this in full before writing decomposition specs. Memory should ingest this file at next cycle.
