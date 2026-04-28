#!/bin/bash
# =============================================================================
# CropsIntel V3 Agent — WhatsApp notifier (Twilio)
# =============================================================================
# Usage: notify-whatsapp.sh "Your message here"
#
# Required env vars (set in Railway dashboard):
#   TWILIO_ACCOUNT_SID
#   TWILIO_AUTH_TOKEN
#   TWILIO_WHATSAPP_FROM   - e.g. "whatsapp:+14155238886" (Twilio sandbox or your verified number)
#   TWILIO_WHATSAPP_TO     - your WhatsApp number, e.g. "whatsapp:+9715XXXXXXXX"
#
# Silently no-ops if env vars are missing (so dev/test environments don't break).
# =============================================================================

MESSAGE="${1:-(empty notification)}"

if [ -z "$TWILIO_ACCOUNT_SID" ] || [ -z "$TWILIO_AUTH_TOKEN" ] || \
   [ -z "$TWILIO_WHATSAPP_FROM" ] || [ -z "$TWILIO_WHATSAPP_TO" ]; then
  echo "[notify] Twilio env vars not set; skipping WhatsApp send. Message: $MESSAGE"
  exit 0
fi

# Twilio API endpoint
URL="https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json"

curl -s -X POST "$URL" \
  --user "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  --data-urlencode "From=$TWILIO_WHATSAPP_FROM" \
  --data-urlencode "To=$TWILIO_WHATSAPP_TO" \
  --data-urlencode "Body=$MESSAGE" \
  > /dev/null

echo "[notify] WhatsApp sent: $MESSAGE"
