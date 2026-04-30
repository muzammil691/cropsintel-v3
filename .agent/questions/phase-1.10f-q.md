# Question — phase-1.10f (informational, not blocking)

**Topic:** Twilio WhatsApp webhook setup + required Railway env vars

---

## Action required by Muzammil

### 1. Add env vars to Atlas's Railway service

Open Railway → cropsintel-atlas service → Variables and add:

| Variable | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | Copy from V2 Supabase Edge Function secrets |
| `TWILIO_AUTH_TOKEN` | Copy from V2 Supabase Edge Function secrets |
| `TWILIO_FROM_NUMBER` | The Atlas WhatsApp number (default: `+12345622692`) |

### 2. Configure the Twilio webhook URL

1. Open [Twilio Console](https://console.twilio.com) → Messaging → Settings → WhatsApp Sandbox  
   (or if you have a registered number: Phone Numbers → Manage → Active Numbers → click the number)
2. Under **"When a message comes in"**, set:
   - URL: `https://courteous-simplicity-production.up.railway.app/whatsapp/inbound`
   - HTTP Method: **POST**
3. Click **Save**

### 3. Test

Send a WhatsApp message from Muzammil's number (`+971562556592`) to the Atlas sandbox number.

Expected:
- Twilio receives 200 + empty TwiML within < 1s
- `atlas_conversations` gets 2 rows: `role=user` (channel=whatsapp) and `role=atlas`
- Muzammil receives an Atlas reply on WhatsApp

---

## Notes

- Twilio signature verification (X-Twilio-Signature header) is **out of scope for v0.1** — will be added in a security-pass task.
- Media attachments (images, voice notes) are skipped for v0.1.
- Web sessions and WhatsApp sessions use separate `thread_id`s by default (web = caller-specified, WhatsApp = phone number digits). Cross-channel thread continuity can be added as a future improvement.
