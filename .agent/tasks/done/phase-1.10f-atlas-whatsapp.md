# Task: Phase 1.10f — Atlas WhatsApp inbound webhook

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §11 (WhatsApp routing)
**Context:** Atlas needs to receive WhatsApp messages from Muzammil and route them through the same chat handler as web. Same conversation thread continues across web ↔ phone.
**Estimated effort:** ~30 min
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Add `POST /whatsapp/inbound` to `atlas/src/server.ts` that accepts Twilio's webhook payload, routes the message to Atlas's chat brain (reusing 1.10e's logic), persists both directions to `atlas_conversations`, and replies via Twilio's API.

## Twilio webhook payload (what arrives)

Twilio sends `application/x-www-form-urlencoded` with these fields:
- `From` — `whatsapp:+971562556592` (Muzammil's number)
- `To` — `whatsapp:+12345622692` (whichever number is registered for Atlas)
- `Body` — message text
- `MessageSid` — Twilio's unique ID
- `NumMedia`, `MediaUrl0`, etc. — for attachments (skip for v0.1)

## Implementation

### atlas/src/lib/twilio.ts

```ts
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER ?? '+12345622692'

export async function sendWhatsAppReply(toNumber: string, body: string): Promise<{ sid: string } | { error: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { error: 'Twilio creds not configured; reply not sent' }
  }
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
  const params = new URLSearchParams({
    From: `whatsapp:${TWILIO_FROM_NUMBER}`,
    To: toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`,
    Body: body.length > 1500 ? body.slice(0, 1497) + '...' : body,  // WhatsApp limit
  })
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) return { error: `Twilio API error: ${res.status} ${await res.text()}` }
  const data = await res.json() as { sid: string }
  return { sid: data.sid }
}

export function phoneToThreadId(from: string): string {
  // Strip whatsapp: prefix and + sign, use as thread_id
  // Multiple users could chat from same number on different days — same thread
  return from.replace('whatsapp:', '').replace('+', '')
}
```

### atlas/src/server.ts — add handler

```ts
import { sendWhatsAppReply, phoneToThreadId } from './lib/twilio'

async function handleWhatsAppInbound(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Twilio webhooks don't use Bearer auth; verify with X-Twilio-Signature instead (skip for v0.1)
  const body = await readBody(req)
  const params = new URLSearchParams(body)

  const from = params.get('From')
  const messageBody = params.get('Body')
  const messageSid = params.get('MessageSid')

  if (!from || !messageBody) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Missing From or Body')
    return
  }

  // Acknowledge to Twilio immediately (within 10s SLA)
  res.writeHead(200, { 'Content-Type': 'text/xml' })
  res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')

  // Process async — don't block the webhook
  processWhatsAppMessage(from, messageBody, messageSid).catch(err =>
    console.error('[whatsapp-inbound] processing error:', err),
  )
}

async function processWhatsAppMessage(from: string, body: string, messageSid: string | null): Promise<void> {
  const threadId = phoneToThreadId(from)
  const sb = getSupabaseClient()

  // Persist user message
  await sb.from('atlas_conversations').insert({
    thread_id: threadId,
    channel: 'whatsapp',
    role: 'user',
    content: body,
    metadata: { from, messageSid },
  })

  // Reuse the chat brain (extracted from 1.10e's handleChat into a callable function)
  // For v0.1, do a non-streaming call to Anthropic with the same SYSTEM_PROMPT and history
  // Final assistantText is sent via WhatsApp reply
  const assistantText = await runChatTurn({ threadId, channel: 'whatsapp', message: body })

  // Persist atlas reply
  await sb.from('atlas_conversations').insert({
    thread_id: threadId,
    channel: 'whatsapp',
    role: 'atlas',
    content: assistantText,
  })

  // Send WhatsApp reply
  const reply = await sendWhatsAppReply(from, assistantText)
  if ('error' in reply) {
    console.error('[whatsapp-inbound] reply failed:', reply.error)
  } else {
    console.log(`[whatsapp-inbound] replied with sid=${reply.sid}`)
  }
}
```

### Refactor 1.10e: extract `runChatTurn`

Pull out the LLM-loop logic from `handleChat` into a reusable function:

```ts
export async function runChatTurn(params: {
  threadId: string
  channel: string
  message: string
  onEvent?: (event: string, data: unknown) => void  // for SSE streaming
}): Promise<string> {
  // Same loop as before, but onEvent is called per event for streaming;
  // for non-streaming callers (WhatsApp), pass undefined and just collect final text
  // Returns the final assistantText
}
```

`handleChat` (web/SSE) and `processWhatsAppMessage` (WhatsApp) both call `runChatTurn`. SSE callers pass `onEvent`; WhatsApp doesn't.

### Add route in startServer()

```ts
if (url === '/whatsapp/inbound' && method === 'POST') {
  await handleWhatsAppInbound(req, res)
  return
}
```

## Twilio webhook URL configuration

After deploy, the user must:
1. Open Twilio Console → Messaging → Settings → WhatsApp Sandbox (or registered number)
2. Set "When a message comes in" webhook URL to: `https://courteous-simplicity-production.up.railway.app/whatsapp/inbound`
3. Set HTTP method: POST
4. Save

Document this in `.agent/questions/phase-1.10f-q.md` so the user knows.

## Acceptance criteria

After this task ships:

1. `POST /whatsapp/inbound` exists, returns 200 within 100ms with empty TwiML response.
2. After a WhatsApp message arrives, `atlas_conversations` has 2 new rows: role=user (with channel=whatsapp), role=atlas.
3. Twilio returns successfully when Atlas calls `sendWhatsAppReply`.
4. The same thread_id continues across web and WhatsApp (test by messaging from web first, then sending WhatsApp from same Twilio number — Atlas should remember the web context).

## Required env vars

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` (the registered Atlas business number; for now, can default to the Maxons-shared number `+12345622692`)

The Twilio creds live in V2's Supabase Edge Function secrets currently. The user needs to copy them into Atlas's Railway env. Document in `.agent/questions/phase-1.10f-q.md`.

## Out of scope

- Twilio signature verification (X-Twilio-Signature) — add in a security-pass task
- Media attachments (NumMedia > 0) — skip for v0.1
- Rate limiting on outbound (Atlas spamming Muzammil at 3am)
- Templates for proactive outbound — covered separately when we register a dedicated Atlas number

## Notes

- Twilio gives a 10-second SLA — webhook MUST 200 within that window or it retries. We respond immediately and process async.
- The `<Response></Response>` empty TwiML tells Twilio "I'll send the reply via API, no auto-reply needed."
- WhatsApp message limit is 1600 chars; we truncate to 1500 for safety. If Atlas's response is long, future improvement is to chunk into multiple messages.
- For inbound from Muzammil (`+971562556592`), thread_id will be `971562556592` (no plus). All web sessions can use a different thread_id like `muzammil-main` and continuity has to be explicit if we want it. For v0.1 keep them separate threads.
