# Question — phase-1.10k

**Blocking:** NOT blocking — shipped. This file documents a security trade-off for human review.

**Context:**
The Atlas dashboard (`/atlas`) requires authenticating to the Atlas Railway service (`https://courteous-simplicity-production.up.railway.app`). The task spec explicitly asks for `VITE_ATLAS_API_TOKEN` in the Vite env vars so the token is baked into the client bundle.

This violates the master plan rule "AI keys server-side only" in spirit (it's not an AI key but it IS a bearer token that grants write access to Atlas including trust-mode changes and ADR approvals).

**The trade-off that was shipped:**
`VITE_ATLAS_TOKEN` is in the bundle. For v0.1, the audience is exactly one user (Muzammil) who controls the deployment. The token is only meaningful if someone has the GitHub Pages URL AND knows to look in the JS bundle. Acceptable short-term risk.

**Options to harden this:**
1. **Supabase Auth-gated proxy** (recommended) — Add a Supabase edge function `atlas-proxy` that:
   - Validates the caller's Supabase JWT (so only logged-in Muzammil can call it)
   - Forwards the request to Atlas with the real token from Supabase Secrets
   - Frontend calls `/functions/v1/atlas-proxy` instead of Railway directly
   - Token never touches the client bundle

2. **Magic-link one-time token** — Atlas issues a short-lived token per browser session via a magic-link email. Muzammil opens the link, gets a 24h token stored in localStorage. Tokens auto-expire. More complex to build.

3. **Keep as-is + IP allowlist** — Add an IP allowlist to the Atlas Railway service so it only accepts requests from known IPs. Works if Muzammil has a static IP.

**Recommendation:** Option 1 (Supabase proxy) aligns with V3's existing auth infrastructure and costs nothing extra. Schedule as a follow-up task `phase-1.10k-sec-hardening`.

**Master plan reference:** Section 10.2 (AI provider routing) and rule 4 in section 0 ("AI keys server-side only").
