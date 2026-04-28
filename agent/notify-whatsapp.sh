#!/bin/bash
# =============================================================================
# CropsIntel V3 Agent — WhatsApp notifier
# =============================================================================
# Usage: notify-whatsapp.sh "Your message here"
#
# Routes through V2's `whatsapp-send` Supabase Edge Function (which holds the
# registered Twilio Zyra credentials). This avoids:
#   - Twilio sandbox opt-in flow
#   - Storing Twilio creds on Railway
#   - Duplicating notification infrastructure
#
# Required env vars (set in Railway dashboard):
#   SUPABASE_V2_URL          - https://eywsfmixzrdfcywmdaaw.supabase.co
#   SUPABASE_V2_ANON_KEY     - V2 anon key
#   AGENT_WHATSAPP_TO        - your number, e.g. "+971562556592"
#
# Optional fallback (raw Twilio, used only if SUPABASE_V2_URL is empty):
#   TWILIO_ACCOUNT_SID
#   TWILIO_AUTH_TOKEN
#   TWILIO_WHATSAPP_FROM
#   TWILIO_WHATSAPP_TO
# =============================================================================

MESSAGE="${1:-(empty notification)}"

# -----------------------------------------------------------------------------
# Path A — V2 Edge Function (preferred — uses registered Zyra number)
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
    echo "[notify] WhatsApp sent via V2 edge function: $MESSAGE"
    exit 0
  else
    echo "[notify] V2 edge function failed (HTTP $HTTP_STATUS): $BODY" >&2
    # fall through to Twilio direct path
  fi
fi

# -----------------------------------------------------------------------------
# Path B — Twilio direct (fallback)
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
    echo "[notify] WhatsApp sent via Twilio direct: $MESSAGE"
    exit 0
  else
    echo "[notify] Twilio direct failed (HTTP $HTTP_STATUS): $BODY" >&2
    exit 1
  fi
fi

echo "[notify] No WhatsApp config found. Set SUPABASE_V2_URL+SUPABASE_V2_ANON_KEY+AGENT_WHATSAPP_TO (preferred) or TWILIO_* vars. Message was: $MESSAGE" >&2
exit 1
