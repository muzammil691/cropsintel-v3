// Phase 1.3a — V1/V2 user-migration bridge client.
//
// Client-side wrapper around the auth-bridge edge function. Lets the four login
// forms ask "is this email/phone a known V1/V2 user?" before showing a generic
// error. If the bridge says yes + set_password_required, the form routes the
// visitor to /set-password instead of leaving them at a dead end.

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export interface BridgeResult {
  found: boolean
  set_password_required: boolean
  hint_email?: string | null
  hint_phone?: string | null
  legacy_source?: 'v1' | 'v2' | null
}

export async function checkBridge(input: { email?: string; phone?: string }): Promise<BridgeResult> {
  const res = await fetch(`${FUNCTIONS_URL}/auth-bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    return { found: false, set_password_required: false }
  }
  return (await res.json()) as BridgeResult
}
