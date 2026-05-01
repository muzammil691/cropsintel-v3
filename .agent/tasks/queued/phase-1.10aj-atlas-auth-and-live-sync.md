---
priority: 1
depends-on: []
---

# Task: Phase 1.10aj — Atlas WhatsApp-OTP auth + persistent session + live multi-device chat sync

**Context:** Atlas dashboard at `muzammil691.github.io/atlas` is currently **open to the world** — anyone with the URL can use the chat, queue specs, flip trust mode, etc. The frontend uses `ATLAS_API_TOKEN` from the Vite env, which gets baked into the static bundle published to GitHub Pages — anyone viewing source can extract it.

The user (`+971562556592`) needs:
1. **WhatsApp OTP login** — only this phone number can authenticate
2. **Persistent session** — stay logged in until explicit logout (no auto-expiry)
3. **Live multi-device sync** — same chat visible simultaneously on web + phone (single thread per user)

**Estimated effort:** ~75 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Database tables (Supabase migration)

Create `supabase/migrations/20260501130000_atlas_auth.sql`:

```sql
-- One-time codes for WhatsApp login
CREATE TABLE IF NOT EXISTS public.atlas_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,           -- bcrypt(otp), never store the plain code
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_otp_phone_active
  ON public.atlas_otp_codes (phone, expires_at DESC) WHERE used_at IS NULL;

-- Long-lived sessions (no auto-expiry; revoked only on explicit logout)
CREATE TABLE IF NOT EXISTS public.atlas_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  token_hash text NOT NULL UNIQUE,   -- sha256(opaque session token)
  device_label text,                 -- 'web' / 'phone' / 'tablet' (best-effort UA parse)
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_atlas_sessions_token_active
  ON public.atlas_sessions (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_atlas_sessions_phone
  ON public.atlas_sessions (phone, created_at DESC);

ALTER TABLE public.atlas_otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_sessions ENABLE ROW LEVEL SECURITY;

-- Service-role only (no client RLS — all access goes through Atlas server)
CREATE POLICY "atlas_otp_service" ON public.atlas_otp_codes
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "atlas_sessions_service" ON public.atlas_sessions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
```

### Part B — Atlas server auth endpoints

Add to `atlas/src/server.ts` (alongside existing `/atlas/mode` etc.):

**Allowlist via env:**
```
ATLAS_ALLOWED_PHONES=+971562556592
```
(comma-separated; reject any phone not on the list)

**Routes:**

1. **POST `/atlas/auth/request-otp`** — public (no auth header)
   - Body: `{ phone: string }`
   - Reject if phone not in `ATLAS_ALLOWED_PHONES`
   - Rate-limit: max 5 OTP requests per phone per 15 min (query `atlas_otp_codes` count)
   - Generate 6-digit numeric OTP, bcrypt-hash, insert row with `expires_at = now() + 5min`
   - Send via existing V2 WhatsApp Edge Function (`https://eywsfmixzrdfcywmdaaw.supabase.co/functions/v1/whatsapp-send`) with payload `{to: phone, body: "Atlas login code: 123456 (5 min)"}`
   - Return `{ ok: true, expires_in: 300 }`. **Never** return the OTP itself.

2. **POST `/atlas/auth/verify-otp`** — public
   - Body: `{ phone: string, code: string }`
   - Find latest non-used, non-expired `atlas_otp_codes` row for this phone
   - If row missing OR `attempts >= 5` → 401 (also mark all OTPs for this phone used)
   - Bcrypt-compare the code; on mismatch increment `attempts`, return 401
   - On match: mark OTP `used_at`, generate opaque session token (`crypto.randomBytes(32).toString('hex')`), insert `atlas_sessions` row with `token_hash = sha256(token)`, parse UA for `device_label`, return `{ ok: true, token, session_id }`
   - **Token has no expiry** (no `exp` field). Session lasts until `revoked_at` is set.

3. **POST `/atlas/auth/logout`** — auth required
   - Header: `Authorization: Bearer <session_token>`
   - Sets `revoked_at = now()` on the matching session row
   - Returns `{ ok: true }`

4. **GET `/atlas/auth/me`** — auth required
   - Returns `{ phone, session_id, device_label, created_at, last_seen_at }`

5. **GET `/atlas/auth/sessions`** — auth required
   - Returns all non-revoked sessions for the current phone (lets user see "logged in on phone, web" and revoke individuals)

6. **POST `/atlas/auth/sessions/:id/revoke`** — auth required
   - Revoke a specific session (e.g., "log out my web tab from my phone")

**Auth middleware** for ALL existing routes (`/atlas/chat`, `/atlas/mode`, `/atlas/conversations/*`, etc.):

```typescript
async function authenticate(req): Promise<{ phone: string; sessionId: string } | null> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7)
  const tokenHash = sha256(token)

  // Legacy bearer (ATLAS_API_TOKEN) still accepted for service-to-service
  // calls (Builder, conductor cron) — but ONLY this exact value, not user-issued.
  if (token === process.env.ATLAS_API_TOKEN) {
    return { phone: 'service', sessionId: 'service' }
  }

  // User session token
  const sb = getSupabaseClient()
  const { data } = await sb.from('atlas_sessions')
    .select('id, phone, revoked_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle()
  if (!data) return null

  // Update last_seen_at (fire-and-forget)
  sb.from('atlas_sessions').update({ last_seen_at: new Date().toISOString() })
    .eq('id', data.id).then(() => {})

  return { phone: data.phone, sessionId: data.id }
}
```

Replace the existing `authenticate(req)` calls everywhere; on null, return 401.

### Part C — Frontend login flow

**New page `src/pages/atlas/AtlasLogin.tsx`:**

- Phone input (pre-filled with `+971562556592`)
- "Send code via WhatsApp" button → POSTs to `/atlas/auth/request-otp`
- 6-digit OTP input (auto-advance per digit, paste-friendly)
- "Verify" button → POSTs to `/atlas/auth/verify-otp`
- On success: store token in `localStorage` under key `atlas_session_token`, navigate to `/atlas`
- shadcn `Card` + `Input` + `Button` + `InputOTP` (already a shadcn component)

**Auth guard wrapper `src/components/atlas/AtlasAuthGuard.tsx`:**

```typescript
const token = localStorage.getItem('atlas_session_token')
if (!token) return <Navigate to="/atlas/login" replace />

// Validate on mount via GET /atlas/auth/me
const { data, error } = useQuery(['atlas-me'], () => fetchMe(token))
if (error?.status === 401) {
  localStorage.removeItem('atlas_session_token')
  return <Navigate to="/atlas/login" replace />
}
if (!data) return <LoadingSpinner />
return <>{children}</>
```

Wrap all `/atlas/*` routes in `<AtlasAuthGuard>`.

**Update `src/lib/atlas-client.ts`** — `authHeaders()` now reads from `localStorage.atlas_session_token` instead of `import.meta.env.VITE_ATLAS_API_TOKEN`. Remove the Vite env read entirely (no more bundle-leaked token).

**Logout button** in `src/components/atlas/AtlasShell.tsx` topbar:
- Calls POST `/atlas/auth/logout`
- Clears `localStorage`
- Redirects to `/atlas/login`

### Part D — Live multi-device chat sync

Use Supabase Realtime subscriptions on `atlas_conversations`.

**In `src/hooks/useAtlasChat.ts`:**

After the initial `fetchChatHistory(threadId)` call, subscribe:

```typescript
useEffect(() => {
  const channel = supabase
    .channel(`atlas-chat:${threadId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'atlas_conversations', filter: `thread_id=eq.${threadId}` },
      (payload) => {
        const newRow = payload.new as ChatMessage
        setMessages((prev) => {
          if (prev.some((m) => m.id === newRow.id)) return prev  // dedup if it's our own optimistic insert
          return [...prev, normaliseMessage(newRow)]
        })
      }
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [threadId])
```

This ensures: when the user sends a chat from their phone (via WhatsApp or future mobile UI), the open web tab sees it appear in real time. And vice versa.

**Migration follow-up:** enable Realtime on `atlas_conversations`:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.atlas_conversations;
```
Add this to the same auth migration file (Part A).

**Single thread for single user:** since this is a 1-user system, hardcode `thread_id = 'web-default'` everywhere. WhatsApp inbound messages should also write to `thread_id = 'web-default'` instead of the current per-conversation thread (find this in `atlas/src/server.ts` near `[whatsapp-inbound]`). Then phone WhatsApp ↔ web dashboard ↔ live mode all share one timeline.

### Part E — Acceptance smoke test

After deploy:

1. Open the Atlas dashboard URL in an incognito window. Should redirect to `/atlas/login`.
2. Enter `+971562556592`, click "Send code". Phone should receive WhatsApp message with 6-digit code within 10s.
3. Enter wrong code 5 times → 6th attempt should 401 even with the right code (rate-limit hit).
4. Wait, get a fresh code, enter correct → land on Atlas dashboard.
5. Refresh the page → still logged in (no re-auth prompt).
6. Open `https://atlas.../atlas/conversations/web-default` in another tab from a different browser (e.g., Safari + Chrome). Send a message in one tab — the other tab should display it within 2s without manual refresh.
7. Click "Logout" → redirected to login. localStorage cleared.
8. Try the OLD session token in curl → 401.
9. Send WhatsApp `status` to Atlas's number. Reply should appear in web dashboard chat in real time.
10. Reject phone `+919999999999` from `request-otp` (not on allowlist).

## Files

- `supabase/migrations/20260501130000_atlas_auth.sql` (NEW)
- `atlas/src/lib/auth.ts` (NEW — bcrypt, sha256, OTP gen, allowlist check)
- `atlas/src/server.ts` (extend — 6 new routes, replace auth middleware)
- `src/pages/atlas/AtlasLogin.tsx` (NEW)
- `src/components/atlas/AtlasAuthGuard.tsx` (NEW)
- `src/components/atlas/AtlasShell.tsx` (extend — logout button + session indicator)
- `src/lib/atlas-client.ts` (extend — token from localStorage, new auth fns)
- `src/hooks/useAtlasChat.ts` (extend — Realtime subscription)
- `src/App.tsx` (extend — `/atlas/login` route, wrap `/atlas/*` in AuthGuard)
- `atlas/package.json` (add `bcrypt`)

## Success criteria

- `npm run build` clean (atlas + web)
- All 10 acceptance tests pass
- `ATLAS_ALLOWED_PHONES=+971562556592` is the only phone that can request OTP
- Bundle audit: `grep VITE_ATLAS_API_TOKEN dist/` → zero matches (token no longer leaks)
- WhatsApp OTP delivers in under 10s
- Realtime: message latency phone → web tab < 2s end-to-end
- Logout button works; session token rejected after revoke
- No expiry on sessions — verified by curling `/atlas/auth/me` with a 7-day-old token (test by manually setting `created_at` back) and getting 200

## Risks + mitigations

- **Risk:** Realtime subscription requires anon-key access at the row level; with RLS service-only, the client subscribe will get nothing. **Mitigation:** Either (a) add a permissive RLS policy `auth.uid() IS NULL` for `SELECT` on `atlas_conversations` filtered by thread (single-user system, low risk), or (b) proxy realtime through Atlas server with WebSockets. Recommend (a) for v1.
- **Risk:** Lost phone = locked out forever. **Mitigation:** Add `ATLAS_RECOVERY_TOKEN` env var (a one-time admin token) that can mint a new session via curl. Document in SECRETS.md.
- **Risk:** Twilio WhatsApp message delivery delays (>10s) cause poor UX. **Mitigation:** Show "We sent the code; arrives in 5-30s" copy + manual "Resend" button after 30s.
- **Risk:** Realtime subscription leaks (channel not unsubscribed on unmount) cause memory growth. **Mitigation:** `removeChannel` in useEffect cleanup (already in spec).

## NEVER list

- **Never** store the plain OTP — only bcrypt hash.
- **Never** issue session tokens with `exp` claims — sessions are server-revoked only.
- **Never** ship `ATLAS_API_TOKEN` to the client bundle. Remove all `VITE_ATLAS_API_TOKEN` references.
- **Never** allow OTP requests for a phone not in the allowlist — even to test (use a test allowlist via a separate env var if needed).
- **Never** log the session token value or OTP plaintext in service logs.
