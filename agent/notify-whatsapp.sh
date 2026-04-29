#!/bin/bash
# =============================================================================
# CropsIntel V3 Agent — WhatsApp notifier
# =============================================================================
# Usage: notify-whatsapp.sh "Your message here"
#
# Sends FREEFORM TEXT directly via Twilio API using the registered Maxons
# WhatsApp Business number. This works as long as the recipient has had
# inbound interaction within the last 24h (WhatsApp Business session window).
#
# Why direct Twilio (not V2 edge function):
#   - V2's whatsapp-send wraps every message in the "PRICE ALERT" template,
#     producing garbled mixed-format messages for agent status updates.
#   - Direct Twilio sends the exact text we pass — no template wrapping.
#
# Required env vars (set in Railway dashboard):
#   TWILIO_ACCOUNT_SID
#   TWILIO_AUTH_TOKEN
#   TWILIO_WHATSAPP_FROM   - "whatsapp:+12345622692" (registered Maxons number)
#   TWILIO_WHATSAPP_TO     - "whatsapp:+971562556592" (Muzammil's number)
#
# Fallback to V2 edge function only if direct Twilio fails (e.g., 24h window
# expired and freeform is rejected). The template-wrapped message is ugly but
# at least delivers something.
# =============================================================================

MESSAGE="${1:-(empty notification)}"

# -----------------------------------------------------------------------------
# Path A — Twilio direct (PRIMARY — freeform text, no template)
# -----------------------------------------------------------------------------
if [ -n "$TWILIO_ACCOUNT_SID" ] && [ -n "$TWILIO_AUTH_TOKEN" ] && \
   [ -n "$TWILIO_WHATSAPP_FROM" ] && [ -n "$TWILIO_WHATSAPP_TO" ]; then
  URL="https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json"

  RESPONSE=$(curl -s -w "\n__HTTP_STATUS__:%{http_code}" -X POST "$URL" \
    --user "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
    --data-urlencode "From=$TWILIO_WHATSAPP_FROM" \
    --data-urlencode "To=$TWILIO_WHATSAPP_TO" \
    --data-urlencode "Body=$MESSAGE")

  HTTP_STATUS=$(echo "$RESPONSE" | grep "__HTTP_STATUS__:" | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | sed '/__HTTP_STATUS__:/d')

  if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
    echo "[notify] WhatsApp sent via Twilio direct (freeform): $MESSAGE"
    exit 0
  else
    echo "[notify] Twilio direct failed (HTTP $HTTP_STATUS): $BODY" >&2
    echo "[notify] Falling back to V2 edge function (template-wrapped)..." >&2
    # fall through to Path B
  fi
fi

# -----------------------------------------------------------------------------
# Path B — V2 Edge Function (FALLBACK — ugly template wrap, but delivers)
# -----------------------------------------------------------------------------
if [ -n "$SUPABASE_V2_URL" ] && [ -n "$SUPABASE_V2_ANON_KEY" ] && [ -n "$AGENT_WHATSAPP_TO" ]; then
  RESPONSE=$(curl -s -w "\n__HTTP_STATUS__:%{http_code}" \
    -X POST "$SUPABASE_V2_URL/functions/v1/whatsapp-send" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SUPABASE_V2_ANON_KEY" \
    -d "{\"type\":\"alert\",\"to\":\"$AGENT_WHATSAPP_TO\",\"title\":\"CropsIntel V3 Agent\",\"summary\":$(printf '%s' "$MESSAGE" | jq -Rs .),\"urgency\":\"medium\"}")

  HTTP_STATUS=$(echo "$RESPONSE" | grep "__HTTP_STATUS__:" | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | sed '/__HTTP_STATUS__:/d')

  if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
    echo "[notify] WhatsApp sent via V2 edge function (template fallback): $MESSAGE"
    exit 0
  else
    echo "[notify] V2 edge function also failed (HTTP $HTTP_STATUS): $BODY" >&2
    exit 1
  fi
fi

echo "[notify] No WhatsApp config found. Set TWILIO_* env vars. Message was: $MESSAGE" >&2
exit 1
