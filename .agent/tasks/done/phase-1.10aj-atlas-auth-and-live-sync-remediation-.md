---
priority: 1
depends-on: [phase-1.10aj-atlas-auth-and-live-sync]
remediation-of: phase-1.10aj-atlas-auth-and-live-sync
remediation-pass: 3
---

# Task: Phase 1.10aj — Atlas auth + live sync remediation /3 (verifier-queued)

The verifier queued this remediation pass at commit `3dbd2d2` with conf=0.85,
research=0.725 but committed an empty spec body. On execution the agent found
the prior remediation (commit `bd04697`) had already shipped the full phase-1.10aj
spec and the working tree was clean and green.

## Verification performed (no code changes needed)

1. **Root web build** — `npm run build` clean (TypeScript + Vite both pass,
   2814 modules transformed in 3.83s).
2. **Atlas server build** — `cd atlas && npm install && npm run build` clean
   (tsc exits 0; 75 packages installed; bcryptjs/openai/anthropic deps resolve).
3. **Bundle audit** — `grep -r VITE_ATLAS_API_TOKEN dist/` returns no matches.
   Token no longer leaks to the GitHub Pages bundle.
4. **Source audit** — `src/lib/atlas-client.ts` reads tokens from
   `localStorage.atlas_session_token`; the only remaining mention of
   `VITE_ATLAS_API_TOKEN` is a comment explaining why it was removed.
5. **Files in place** —
   - `supabase/migrations/20260501130000_atlas_auth.sql` (atlas_otp_codes,
     atlas_sessions, Realtime publication, permissive SELECT policy on
     atlas_conversations)
   - `atlas/src/lib/auth.ts` (bcrypt OTP hash, sha256 token hash, allowlist,
     rate-limit, session lifecycle)
   - `atlas/src/server.ts` (6 auth routes; authenticate middleware accepts
     both user session tokens and the legacy ATLAS_API_TOKEN service caller)
   - `src/pages/atlas/AtlasLogin.tsx` (phone → OTP two-step, paste-friendly
     6-digit input, 30s resend cooldown)
   - `src/components/atlas/AtlasAuthGuard.tsx` (validates token via
     `/atlas/auth/me` on mount; redirects on 401)
   - `src/hooks/useAtlasChat.ts` (Supabase Realtime subscription on
     `atlas_conversations` filtered by thread_id)
   - `src/App.tsx` wires `/atlas/login` and wraps `/atlas`, `/atlas-brain`,
     `/atlas-pd` in `<AtlasAuthGuard>`

## Outcome

No code changes required. Empty verifier spec → no actionable diff. Closing
the remediation pass to unblock the queue.
