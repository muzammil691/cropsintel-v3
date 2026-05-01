#!/bin/bash
# =============================================================================
# CropsIntel V3 — Research-driven remediation helper
# =============================================================================
# When Verifier blocks a push, agent-loop.sh calls this script BEFORE writing a
# remediation spec. We:
#   1. POST /verifier/research with the failing task's gaps + AI judgment
#   2. Receive { root_cause, recommended_fix, related_specs_to_check, confidence }
#   3. Emit a markdown block on stdout that agent-loop.sh appends to the
#      remediation spec body so Builder retries with research baked in.
#
# Usage:
#   research-remediate.sh <task_id> <head_before> <head_after> <verifier_response_json_path>
#
# Output format (stdout):
#   <markdown sections — Root cause analysis, Related specs, Confidence footer>
#
# Exits 0 on success (research ran or fell open). Exits non-zero only on usage
# error. Bash callers must NOT treat non-zero confidence as a script failure;
# read the "Research confidence:" footer line to decide whether to escalate.
# =============================================================================

set -e

TASK_ID="$1"
HEAD_BEFORE="$2"
HEAD_AFTER="$3"
VERIFIER_RESPONSE_PATH="$4"

if [ -z "$TASK_ID" ] || [ -z "$VERIFIER_RESPONSE_PATH" ]; then
  echo "Usage: $0 <task_id> <head_before> <head_after> <verifier_response_json_path>" >&2
  exit 2
fi

if [ ! -f "$VERIFIER_RESPONSE_PATH" ]; then
  echo "ERROR: verifier response file not found: $VERIFIER_RESPONSE_PATH" >&2
  exit 2
fi

VERIFIER_URL="${VERIFIER_URL:-https://rare-happiness-production.up.railway.app}"
VERIFIER_API_TOKEN="${VERIFIER_API_TOKEN:-}"
VERIFIER_RESEARCH_TIMEOUT="${VERIFIER_RESEARCH_TIMEOUT:-90}"

# Build research request payload from the verifier response: extract gaps + ai_judgment + confidence.
# jq is assumed present (already used elsewhere in agent-loop.sh).
GAPS=$(jq -c '.gaps // []' < "$VERIFIER_RESPONSE_PATH" 2>/dev/null || echo '[]')
AI_JUDGMENT=$(jq -r '.ai_judgment // ""' < "$VERIFIER_RESPONSE_PATH" 2>/dev/null || echo '')
VERIFIER_CONFIDENCE=$(jq -r '.confidence // 0.5' < "$VERIFIER_RESPONSE_PATH" 2>/dev/null || echo '0.5')

REQUEST_PAYLOAD=$(jq -n \
  --arg task_id "$TASK_ID" \
  --arg head_before "$HEAD_BEFORE" \
  --arg head_after "$HEAD_AFTER" \
  --argjson gaps "$GAPS" \
  --arg ai_judgment "$AI_JUDGMENT" \
  --argjson verifier_confidence "$VERIFIER_CONFIDENCE" \
  '{task_id: $task_id, head_before: $head_before, head_after: $head_after, gaps: $gaps, ai_judgment: $ai_judgment, verifier_confidence: $verifier_confidence}')

RESPONSE=$(curl -sS -m "$VERIFIER_RESEARCH_TIMEOUT" \
  -X POST "$VERIFIER_URL/verifier/research" \
  -H "Authorization: Bearer $VERIFIER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_PAYLOAD" 2>&1) || {
  # Research service unreachable: emit a degraded-mode block and exit 0 so
  # agent-loop.sh continues with the legacy remediation flow.
  cat <<EOF

## Root cause analysis (research unavailable)

Verifier research service was unreachable (\`$VERIFIER_URL/verifier/research\`). Builder should retry with the original gap list above and treat this as a low-confidence retry.

## Related specs to check

(none — research unavailable)

## Research confidence: 0.0 (unavailable)

EOF
  exit 0
}

# Validate JSON; if malformed, emit degraded-mode block.
if ! echo "$RESPONSE" | jq -e . >/dev/null 2>&1; then
  cat <<EOF

## Root cause analysis (research returned malformed response)

Raw response was not valid JSON. Builder should retry with original gap list.

\`\`\`
$(echo "$RESPONSE" | head -c 500)
\`\`\`

## Research confidence: 0.0 (malformed)

EOF
  exit 0
fi

ROOT_CAUSE=$(echo "$RESPONSE" | jq -r '.root_cause // "no root_cause in response"')
RECOMMENDED_FIX=$(echo "$RESPONSE" | jq -r '.recommended_fix // "no recommended_fix in response"')
CONFIDENCE=$(echo "$RESPONSE" | jq -r '.confidence // 0')
SKIPPED_DEBATE=$(echo "$RESPONSE" | jq -r '.skipped_debate // false')
SKIPPED_REASON=$(echo "$RESPONSE" | jq -r '.skipped_reason // ""')
RELATED_SPECS=$(echo "$RESPONSE" | jq -r '.related_specs_to_check // [] | .[]' 2>/dev/null || echo '')
SIMILAR_FAILURES=$(echo "$RESPONSE" | jq -r '.similar_failures // [] | .[] | "- " + .task_id + " (" + (.ran_at // "?") + ", similarity " + ((.similarity_score // 0) | tostring) + ")"' 2>/dev/null || echo '')
BRAINS=$(echo "$RESPONSE" | jq -r '.brains // [] | .[] | "- **" + .provider + "**: " + (.verdict // "no verdict")' 2>/dev/null || echo '')

# Compose the augmentation block.
cat <<EOF

## Root cause analysis (research-driven)

**Diagnosis:** $ROOT_CAUSE

**Recommended fix:** $RECOMMENDED_FIX

EOF

if [ "$SKIPPED_DEBATE" = "true" ]; then
  cat <<EOF
> ℹ️ Multi-Brain debate was skipped: $SKIPPED_REASON. Diagnosis above is based on the original Verifier output only.

EOF
else
  cat <<EOF
**Multi-Brain votes:**

$BRAINS

EOF
fi

if [ -n "$SIMILAR_FAILURES" ]; then
  cat <<EOF
## Similar past failures (from memory)

$SIMILAR_FAILURES

Builder: read the resolutions of these prior failures (where present) before re-attempting.

EOF
fi

if [ -n "$RELATED_SPECS" ]; then
  cat <<EOF
## Related specs to verify

Builder: read these specs from \`.agent/tasks/done/\` (or queued/) and consider whether they constrain or inform the fix:

EOF
  for spec in $RELATED_SPECS; do
    echo "- \`$spec\`"
  done
  echo ""
fi

# Footer: confidence line. agent-loop.sh greps this to decide whether to escalate.
cat <<EOF
## Research confidence: $CONFIDENCE

EOF

if awk -v c="$CONFIDENCE" 'BEGIN { exit !(c < 0.4) }'; then
  cat <<EOF
> ⚠️ **HUMAN REVIEW NEEDED** — research confidence ($CONFIDENCE) is below the 0.4 threshold. The auto-research could not converge on a clear root cause. This remediation has been flagged: Builder should NOT blindly retry — instead, leave a question file in \`.agent/questions/\` describing what's blocked.

EOF
fi

exit 0
