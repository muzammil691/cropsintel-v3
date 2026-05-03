---
priority: 1
depends-on: []
---

# Task: Phase 1.10ax — Live agent visibility (in-flight name + pipeline + expandable logs + restart guard + manual push)

**Master plan reference:** §1.10 conductor self-management; user vision discussion 2026-05-02.

**Context:** Builder is actively running specs but Atlas's cockpit can't tell the user. The gap is architectural — Atlas's status reads from its own stale clone refreshed every 5 min, so a spec that moved to in-progress 10 seconds ago is invisible until the next cron tick.

User's exact asks:
1. Show currently-in-flight task name + small live progress text
2. Builder running should light up Builder node in the workflow pipeline diagram
3. Agents tab: expandable logs, restart button that warns if in-flight (and waits or aborts)
4. Manual "push to agent" button if queue isn't moving

This spec ships all four through a Builder→Atlas heartbeat channel (push-based, not poll-based) plus the UI surfaces.

**Estimated effort:** ~80 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Builder heartbeat channel (Builder pushes its state to Atlas)

`agent/agent-loop.sh` (extend):

After every heartbeat tick, also POST to Atlas with the current state:

```bash
post_atlas_heartbeat() {
  local state="$1"      # 'idle' | 'starting' | 'running' | 'shipping' | 'verifying'
  local task="$2"
  local elapsed_s="$3"
  local msg="$4"
  curl -sS -X POST "$ATLAS_URL/atlas/agents/builder/heartbeat" \
    -H "Authorization: Bearer $ATLAS_API_TOKEN" \
    -H "Content-Type: application/json" \
    -m 5 \
    -d "{\"state\":\"$state\",\"task\":\"$task\",\"elapsed_s\":$elapsed_s,\"msg\":\"$msg\"}" 2>/dev/null || true
}
```

Call sites:
- After `pick_next_task`: `post_atlas_heartbeat starting "$task" 0 "spec picked"`
- Inside the heartbeat loop (every 60s): `post_atlas_heartbeat running "$task" "$elapsed" "$tail_log_line"`
- Before `git push`: `post_atlas_heartbeat shipping "$task" "$elapsed" "pushing to main"`
- Before verifier call: `post_atlas_heartbeat verifying "$task" "$elapsed" "verifier audit"`
- On idle sleep: `post_atlas_heartbeat idle "" 0 "no queued tasks"`

`msg` is a 1-line snippet of what Builder is currently doing (e.g., last log line, current file being edited via Claude tool result, etc).

### Part B — Atlas server: heartbeat receiver + state cache

**Migration `supabase/migrations/20260502160000_agent_heartbeats.sql`:**

```sql
CREATE TABLE IF NOT EXISTS public.atlas_agent_heartbeats (
  agent text PRIMARY KEY,         -- 'builder' | 'verifier' | 'designer' | etc.
  state text NOT NULL,
  task text,
  elapsed_s int DEFAULT 0,
  msg text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.atlas_agent_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "atlas_agent_heartbeats_service" ON public.atlas_agent_heartbeats FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
```

**`POST /atlas/agents/:agent/heartbeat`** (NEW, atlas server):
- Auth: service-bearer ATLAS_API_TOKEN only (Builder, conductor cron call this)
- Body: `{state, task, elapsed_s, msg}`
- UPSERT the row keyed by agent name
- Trigger Realtime broadcast to subscribers (use Supabase Realtime on the table)

**`GET /atlas/agents/heartbeats`** (NEW):
- Auth: viewer+
- Returns all rows. Frontend uses this on cockpit mount.

### Part C — Frontend: live in-flight indicator

**`src/components/atlas/AtlasHeader.tsx`** (extend):

Right of the trust mode badge, add an in-flight chip:

```
🔨 Builder · phase-1.10aq · 10:24 · "running tsc..."
```

When `state = 'running' | 'shipping' | 'verifying'`: green pulse + truncated task + elapsed clock + msg.
When `state = 'idle'`: hidden (or shows "Builder idle" in muted).
Click chip → opens Agents tab with Builder selected.

Data source: subscribe to `atlas_agent_heartbeats` via Supabase Realtime (already wired pattern from 1.10aj). On mount, fetch current state via `/atlas/agents/heartbeats`. On Realtime UPDATE, update local state.

### Part D — Workflow tab pipeline reflects live status

`src/components/atlas/workflow/AgentPipeline.tsx` (extend):

Each of the 7 nodes consumes the heartbeat for its agent. Status logic:
- `state = running | shipping | verifying`: 🟢 + animated pulse ring + small text under node "phase-X · 10:24"
- `state = idle` AND `updated_at < 60s ago`: 🟢 idle (no pulse)
- `updated_at > 5 min ago`: 🟡 stale
- `updated_at > 30 min ago`: 🔴 unreachable

Add a small inline progress bar under the active node showing elapsed time relative to a 30-min budget.

### Part E — Agents tab: expandable logs + safe restart

`src/components/atlas/tabs/AtlasAgentsTab.tsx` (extend):

Each agent card gets:

1. **Live state badge** — same chip pattern from header.
2. **Expandable logs panel** — `<details>` that fetches `GET /atlas/agents/:agent/logs?limit=50` (NEW endpoint that proxies Railway logs via the Railway API token Atlas already has). Auto-scrolls to bottom.
3. **Restart button** with safety:
   - If state in `{running, shipping, verifying}`: button shows "Restart (will interrupt task)" in red. Click opens a confirmation Dialog: "Builder is currently running phase-X (10 min in). Restarting will lose this work — Builder will pick the spec up again from scratch on next boot. Continue?"
   - If state = idle: button shows "Restart" plain.
   - Either way, on confirm: calls existing `/atlas/agents/:agent/restart` → triggers Railway redeploy via `railwayRestartService` (1.10af).

`GET /atlas/agents/:agent/logs?limit=50` (NEW, atlas server):
- Auth: admin+
- Calls Railway GraphQL with the existing `RAILWAY_API_TOKEN` to fetch the latest deployment logs for that agent's serviceId. Returns `[{ ts, line }]`.
- Cache 10s.

### Part F — Manual "push to agent" button

If queue has items but no agent is in-flight for >5 min, show a banner in the Queue tab:

```
⚠️ Builder is idle but queue has 3 items. The autonomous loop should pick up
within 5 min. If it's stuck, you can manually nudge:
[🔄 Force Builder pick]
```

`POST /atlas/agents/builder/force-pick` (NEW, owner+admin only):
- Sends a Railway redeploy request — Builder boots, runs the agent loop, picks next task. Same effect as "Restart" but messaged as "force pick" so the user understands the intent.
- Confirmation dialog: "Force-pick will redeploy Builder. If Builder is currently in flight, that task is interrupted and re-queued. Continue?"

### Part G — Conductor self-heartbeat for the other 6 agents

Atlas's conductor (`atlas/src/cron/conductor.ts`) already pings each agent's `/health` endpoint every 5 min. Extend that pass to also write the result to `atlas_agent_heartbeats` so all 7 agents (Atlas, Builder, Verifier, Designer, Council, Memory, Adela) appear in the cockpit with live status.

For agents that don't push their own heartbeats, Atlas writes on their behalf:
- `state = 'idle'` if `/health` returns 200
- `state = 'running'` if their last activity row in their respective audit table is < 5 min old
- `state = 'unreachable'` if `/health` fails

## Files

- `agent/agent-loop.sh` (extend — heartbeat POST helper, call sites)
- `supabase/migrations/20260502160000_agent_heartbeats.sql` (NEW)
- `atlas/src/server.ts` (extend — heartbeat receiver, GET heartbeats, GET logs proxy, force-pick endpoint)
- `atlas/src/cron/conductor.ts` (extend — write heartbeats for non-Builder agents)
- `src/components/atlas/AtlasHeader.tsx` (extend — in-flight chip)
- `src/components/atlas/workflow/AgentPipeline.tsx` (extend — live state per node)
- `src/components/atlas/tabs/AtlasAgentsTab.tsx` (extend — expandable logs + safe restart + force-pick)
- `src/components/atlas/tabs/AtlasQueueTab.tsx` (extend — idle banner with force-pick button)
- `src/lib/atlas-client.ts` (extend — heartbeat fetch + Realtime subscribe + logs fetch + force-pick)

## Success criteria

- `npm run build` clean
- Within 60s of Builder picking a spec, the cockpit header shows "🔨 Builder · phase-X · MM:SS · msg" without manual refresh.
- Workflow tab agent pipeline: Builder node pulses green while running, returns to idle when done.
- Agents tab → click Builder card → expand logs → see live tail of last 50 lines.
- While Builder is running: Restart button shows red "Restart (will interrupt task)" with confirmation dialog. While idle: shows plain "Restart".
- Queue tab: when queue has items AND no agent in-flight for >5 min, shows the idle banner with [Force Builder pick] button.
- Click force-pick → confirmation → Railway redeploy fires → Builder picks next task within ~30s.
- All 7 agents in pipeline show their live state.

## Risks + mitigations

- **Risk:** Heartbeat POST blocks the agent-loop. **Mitigation:** `-m 5` timeout + `|| true` so failures don't propagate.
- **Risk:** Realtime subscription leaks. **Mitigation:** Cleanup on unmount (existing pattern from useAtlasChat).
- **Risk:** Logs proxy hits Railway rate limit. **Mitigation:** 10s cache + only fetch when the agent panel is expanded.
- **Risk:** Force-pick during in-flight task wastes Builder time. **Mitigation:** Confirmation dialog explicitly warns; idle banner only shows after 5 min of no activity (so user has signal before clicking).

## NEVER list

- Never silently lose Builder's heartbeat — if the POST fails 3 times in a row, log loudly and Atlas conductor falls back to its 5-min poll.
- Never let `viewer` role click Restart or Force-pick (operator+ only).
- Never proxy logs without auth — `/atlas/agents/:agent/logs` is admin+.
- Never spam heartbeats faster than once per 30s (rate-limit at receiver).
