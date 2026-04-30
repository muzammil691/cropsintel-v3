# Task: Phase 1.10e — Atlas chat API with SSE streaming

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §5 (API endpoints) and §6 (multi-brain)
**Context:** This is where Atlas becomes interactive. POST /atlas/chat takes a user message, streams the LLM response back via Server-Sent Events, persists the conversation, and (when the LLM decides) calls tools via the dispatcher built in 1.10d.
**Estimated effort:** ~30 min
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Implement the chat handler in `atlas/src/server.ts` (extend the existing scaffold). Wire up:

1. POST /atlas/chat endpoint (Bearer auth)
2. Streaming response via SSE
3. Tool-calling integration — when Claude decides to call a tool, dispatch it and stream the result back into the conversation
4. Conversation persistence — write each user message and Atlas reply to `atlas_conversations`
5. Trust mode awareness — read `process.env.ATLAS_TRUST_MODE` per request (so flipping the env var without restart works)

## Design

### Request shape

```http
POST /atlas/chat
Authorization: Bearer <ATLAS_API_TOKEN>
Content-Type: application/json

{
  "thread_id": "muzammil-main",
  "channel": "web",
  "message": "What's our queued spec count?"
}
```

### Response shape (SSE)

```
event: message
data: {"role": "atlas", "content": "Let me check..."}

event: tool_call
data: {"tool": "status.snapshot", "arguments": {}}

event: tool_result
data: {"tool": "status.snapshot", "result": {"queuedSpecs": 4, ...}, "dispatchId": "..."}

event: message
data: {"role": "atlas", "content": "There are 4 specs queued: 1.10b, 1.10c, 1.10d, 1.10e."}

event: done
data: {"thread_id": "muzammil-main", "totalCostUsd": 0.0023}
```

### Implementation file: atlas/src/server.ts (extend existing)

Add a new handler for `/atlas/chat`. Use the Anthropic Messages API with `tools` parameter for native tool-calling. Sonnet 4.6 supports it.

```ts
import { dispatch } from './lib/dispatch'
import { TOOLS, ToolName } from './lib/tools'
import { getSupabaseClient } from './lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TOOL_DEFINITIONS = Object.entries(TOOLS).map(([name, t]) => ({
  name: name.replace('.', '_'),  // Anthropic tool names can't contain dots
  description: t.description,
  input_schema: { type: 'object', properties: {}, additionalProperties: true },  // permissive for v0.1
}))

const SYSTEM_PROMPT = `You are Atlas, the conductor of the CropsIntel V3 production house.

Your job: orchestrate the build of CropsIntel by reading state, querying institutional memory, and dispatching the right agent at the right time. You speak with Muzammil Akhtar (founder).

Capabilities — call tools to do anything beyond pure conversation:
- memory_search: query the master plan, audits, V1/V2 codebases
- builder_queue_spec / builder_list_queue / builder_cancel_task: manage the build queue
- verifier_audit / verifier_recent_runs: check audit results
- council_write_spec: ask Council to decompose a phase
- adela_trigger_scrape: trigger a scrape
- whatsapp_send: ping someone
- status_snapshot: fresh project state

Style: concise, decisive, no fluff. If you don't know something, call a tool. Never make up project state.

Trust mode: ${process.env.ATLAS_TRUST_MODE ?? 'passive'}.
- passive/chat: read-only tools only.
- confirm: ask before dispatching write tools (builder_queue_spec, etc.)
- auto: dispatch freely under cost cap.`

export async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authenticate(req)) {
    json(res, 401, { error: 'Unauthorized' })
    return
  }

  const body = await readBody(req)
  let payload: { thread_id: string; channel: string; message: string }
  try {
    payload = JSON.parse(body)
  } catch {
    json(res, 400, { error: 'Invalid JSON' })
    return
  }

  if (!payload.thread_id || !payload.message) {
    json(res, 400, { error: 'thread_id and message are required' })
    return
  }

  // Persist user message
  const sb = getSupabaseClient()
  await sb.from('atlas_conversations').insert({
    thread_id: payload.thread_id,
    channel: payload.channel || 'web',
    role: 'user',
    content: payload.message,
  })

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // Load recent conversation history (last 20 messages)
  const { data: history } = await sb
    .from('atlas_conversations')
    .select('role, content')
    .eq('thread_id', payload.thread_id)
    .order('created_at', { ascending: false })
    .limit(20)
  const messages = (history ?? []).reverse().map(m => ({
    role: m.role === 'atlas' ? 'assistant' as const : 'user' as const,
    content: m.content,
  }))

  const trustMode = (process.env.ATLAS_TRUST_MODE ?? 'passive') as TrustMode
  let totalCostUsd = 0
  let assistantText = ''

  try {
    // Tool-calling loop — Anthropic returns either text or tool_use blocks
    let iteration = 0
    while (iteration < 8) {  // safety cap
      iteration++
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS as any,
        messages: messages as any,
      })

      // Estimate cost
      const inputCost = (response.usage.input_tokens / 1_000_000) * 3
      const outputCost = (response.usage.output_tokens / 1_000_000) * 15
      totalCostUsd += inputCost + outputCost

      const textBlocks = response.content.filter(b => b.type === 'text') as Array<{ type: 'text'; text: string }>
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use') as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>

      // Stream text
      for (const block of textBlocks) {
        sendEvent('message', { role: 'atlas', content: block.text })
        assistantText += block.text
      }

      if (toolUseBlocks.length === 0) {
        break  // no tools requested, conversation turn complete
      }

      // Execute each tool call via dispatcher
      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
      for (const toolUse of toolUseBlocks) {
        const toolName = toolUse.name.replace('_', '.') as ToolName
        sendEvent('tool_call', { tool: toolName, arguments: toolUse.input })

        const dispatchResult = await dispatch({
          tool: toolName,
          arguments: toolUse.input,
          initiatedBy: `chat:${payload.thread_id}`,
          trustMode,
        })

        sendEvent('tool_result', { tool: toolName, ...dispatchResult })

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(dispatchResult.result ?? dispatchResult.error ?? null),
        })
      }

      // Append assistant message + tool_results, loop again
      messages.push({ role: 'assistant', content: response.content as any })
      messages.push({ role: 'user', content: toolResults as any })
    }

    // Persist final assistant message
    if (assistantText) {
      await sb.from('atlas_conversations').insert({
        thread_id: payload.thread_id,
        channel: payload.channel || 'web',
        role: 'atlas',
        content: assistantText,
        metadata: { totalCostUsd, iterations: iteration },
      })
    }

    sendEvent('done', { thread_id: payload.thread_id, totalCostUsd })
    res.end()
  } catch (err) {
    sendEvent('error', { error: err instanceof Error ? err.message : String(err) })
    res.end()
  }
}
```

Then in the existing `startServer()` function, add a route:

```ts
if (url === '/atlas/chat' && method === 'POST') {
  await handleChat(req, res)
  return
}
```

### Add @anthropic-ai/sdk to atlas/package.json

```bash
cd atlas && npm install @anthropic-ai/sdk
```

## Acceptance criteria

After this task ships:

1. `POST https://atlas-production.up.railway.app/atlas/chat` with valid Bearer token + `{thread_id, channel, message}` returns 200 with `text/event-stream` content-type and a stream of SSE events.
2. The first response event is `message` with role: atlas.
3. If the message triggers a tool (e.g., "what's queued?"), the stream includes `tool_call` and `tool_result` events.
4. After the response, `atlas_conversations` has 2 new rows: one role=user, one role=atlas, both with same `thread_id`.
5. After the response, `atlas_dispatches` has rows for any tool calls made.
6. Setting `ATLAS_TRUST_MODE=passive` (or chat) and asking Atlas to "queue a new spec" results in a `tool_result` event with `status: blocked` (not an actual queue).
7. `atlas/package.json` has `@anthropic-ai/sdk` as a dependency.

## Required env vars (document in question file if missing)

- `ANTHROPIC_API_KEY` (already documented in 1.10c)
- `ATLAS_API_TOKEN` (set in Railway; clients use it as Bearer)

## Out of scope

- Multi-brain debate from chat (that's escalation logic; chat uses simple Sonnet for now. Debate gets wired into specific high-stakes flows like architectural forks in 1.10h)
- WhatsApp inbound (1.10f routes WhatsApp to this same handler)
- Cost gatekeeper enforcement that rejects expensive dispatches mid-stream (1.10g)
- Frontend SSE consumer (1.10k builds the React side)

## Notes

- Anthropic SDK v0.30+ supports streaming. For v0.1, this implementation uses non-streaming `messages.create` and just sends one SSE chunk per text block. Pure streaming (token-by-token) can be a refinement.
- Anthropic tool names can't contain dots. We use underscores (`memory_search`) over the wire and translate to dot-form (`memory.search`) before dispatching. The `TOOLS` registry uses dot-form internally for readability.
- The 8-iteration safety cap prevents runaway tool loops. If Claude is still calling tools after 8 turns, something's stuck — break and tell the user.
- `messages` array conversion to Anthropic's format uses `as any` casts in places — this is acceptable for v0.1; tighten types in a polish pass later.
- `totalCostUsd` is reported in the `done` event for client-side burn tracking.
