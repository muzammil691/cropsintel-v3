#!/usr/bin/env bash
# Phase 1.3c end-to-end smoke test for V1.0-alpha.
#
# Validates the anonymous (pre-signup) signup path: guest-gate session start,
# deep-view count increment, and WhatsApp OTP send. Verifies edge functions
# accept calls without a JWT (verify_jwt=false after Phase 1.3c).
#
# Usage:
#   ./scripts/smoke-test-v1-alpha.sh                # run 3-step happy path
#   ./scripts/smoke-test-v1-alpha.sh verify <code>  # verify OTP received on WhatsApp
#
# Env vars:
#   VITE_SUPABASE_ANON_KEY  — Supabase anon key (required; loaded from .env if present)
#   TEST_PHONE              — phone number that will receive the OTP (default: Muzammil's WhatsApp)
set -euo pipefail

# Load .env if present (so we don't have to export vars manually)
if [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^VITE_SUPABASE_(URL|ANON_KEY)=' .env | xargs)
fi

SUPABASE_URL="${VITE_SUPABASE_URL:-https://hzrnohsxigrqlmzegwlb.supabase.co}"
ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}"
TEST_PHONE="${TEST_PHONE:-+971562556592}"

if [ -z "$ANON_KEY" ]; then
  echo "ERROR: VITE_SUPABASE_ANON_KEY is not set. Put it in .env or export it." >&2
  exit 1
fi

require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "ERROR: jq is required. Install with: apt-get install -y jq" >&2
    exit 1
  }
}

cmd="${1:-run}"

case "$cmd" in
  run)
    require_jq

    echo "1. Test guest-gate start (anonymous, no JWT)"
    START=$(curl -fsS -X POST "$SUPABASE_URL/functions/v1/guest-gate" \
      -H "Content-Type: application/json" \
      -H "apikey: $ANON_KEY" \
      -d '{"action":"start"}')
    echo "   start: $START"
    GUEST_ID=$(echo "$START" | jq -r '.guest_id')
    if [ -z "$GUEST_ID" ] || [ "$GUEST_ID" = "null" ]; then
      echo "ERROR: guest-gate did not return a guest_id" >&2
      exit 1
    fi
    echo "   ok (guest_id=$GUEST_ID)"

    echo "2. Test record-deep increments count"
    COUNT=$(curl -fsS -X POST "$SUPABASE_URL/functions/v1/guest-gate" \
      -H "Content-Type: application/json" \
      -H "apikey: $ANON_KEY" \
      -d "{\"action\":\"record-deep\",\"guest_id\":\"$GUEST_ID\"}")
    echo "   count: $COUNT"

    echo "3. Test whatsapp-send-otp to $TEST_PHONE"
    OTP=$(curl -fsS -X POST "$SUPABASE_URL/functions/v1/whatsapp-send-otp" \
      -H "Content-Type: application/json" \
      -H "apikey: $ANON_KEY" \
      -d "{\"phone\":\"$TEST_PHONE\"}")
    echo "   OTP send: $OTP"

    echo
    echo "4. Manual step: check WhatsApp on $TEST_PHONE for code from +19862022080"
    echo "   Then run: ./scripts/smoke-test-v1-alpha.sh verify <code>"
    ;;

  verify)
    require_jq
    CODE="${2:-}"
    if [ -z "$CODE" ]; then
      echo "Usage: $0 verify <code>" >&2
      exit 1
    fi
    echo "Verifying OTP $CODE for $TEST_PHONE"
    RESP=$(curl -fsS -X POST "$SUPABASE_URL/functions/v1/whatsapp-verify-otp" \
      -H "Content-Type: application/json" \
      -H "apikey: $ANON_KEY" \
      -d "{\"phone\":\"$TEST_PHONE\",\"code\":\"$CODE\"}")
    echo "$RESP" | jq .
    ;;

  *)
    echo "Usage: $0 [run|verify <code>]" >&2
    exit 1
    ;;
esac
