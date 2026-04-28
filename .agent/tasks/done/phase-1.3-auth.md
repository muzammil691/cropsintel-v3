# Task: Phase 1.3 — Auth (4 login methods + V1/V2 user migration bridge)

**Master plan reference:** section 11.2, sub-task 1.3
**V3-CODING-INSTRUCTIONS reference:** section 2, Task 5
**Estimated effort:** ~1 week of work compressed into a single task; agent should iterate.

---

## Goal

Implement authentication for V3 with four login methods, plus a migration bridge so V2's 65 existing users can sign in to V3 with their old credentials.

## In scope

### Four login methods
1. **Email + password** — standard Supabase Auth
2. **Email OTP** — magic-link / passwordless email
3. **WhatsApp + password** — phone-based auth using `whatsapp_number` column on `profiles`
4. **WhatsApp OTP** — passwordless via Twilio WhatsApp

### Pages to build/replace
- `src/pages/Auth.tsx` — replace stub with tabbed UI (4 tabs, one per method)
- `src/pages/SetPassword.tsx` — new — for V1/V2 migrated users completing first login
- `src/pages/admin/VerifiedReviewQueue.tsx` — new — Maxons team UI for tier promotions (per master plan 1.11b)

### Components
- `src/components/auth/EmailPasswordForm.tsx`
- `src/components/auth/EmailOTPForm.tsx`
- `src/components/auth/WhatsAppPasswordForm.tsx`
- `src/components/auth/WhatsAppOTPForm.tsx`

### Library
- `src/lib/auth-bridge.ts` — V1/V2 user detection + SetPassword flow trigger

### Edge functions
- `supabase/functions/whatsapp-send-otp/index.ts` — send OTP via Twilio WhatsApp
- `supabase/functions/whatsapp-verify-otp/index.ts` — verify code + sign user in

### Schema additions (if needed — write a new migration)
- An `whatsapp_otps` table for tracking sent OTPs (with TTL + RLS)
- Possibly `migration_pending` flag on `profiles` for V1/V2 users

## Out of scope

- The Verified-Review queue beyond a basic working UI (deeper tier-promotion workflow lives in Phase 2)
- Complete UI polish (functional > pretty for now; shadcn defaults are fine)
- 2FA / MFA (Phase 4)
- SSO with social providers (not in master plan)

## Acceptance criteria

1. All 4 login methods work end-to-end on the deployed preview URL.
2. A test V2-style user (we'll seed one for testing — see step 0 below) can log in with email/password using the bridge, and is prompted to set a new password if needed.
3. A new user signs up via any method → a `profiles` row is auto-created with `tier: 'registered'`.
4. Maxons team can view the verified-review queue and promote a user to `tier: 'verified'` (this writes to `profiles.tier` and adds a row to `user_roles` if appropriate).
5. All 4 flows have at least one Playwright e2e test.
6. AI provider keys are NOT involved (auth is not AI).
7. Information walls respected: a non-team user trying to access `/admin/verified-review` redirects to `/`.
8. `npm run build` passes.
9. Conventional commits, one per logical chunk (e.g., `feat: email+password login`, `feat: WhatsApp OTP edge functions`, etc.).

## Foundation check (do this BEFORE starting)

Verify these exist in `supabase/migrations/`:
- ✅ `profiles` table with `tier`, `whatsapp_number`, `whatsapp_verified` columns
- ✅ `user_roles` table with `app_role` enum
- ✅ `handle_new_user()` trigger that creates a profile row on signup
- ✅ RLS on all tables

If any of these are missing, STOP and write `.agent/questions/phase-1.3-auth-q.md` with the gap.

## Step 0 — Seed a V2-style test user

Before implementing the bridge, manually create a row in V3 Supabase that mimics V2's migrated-user state:

```sql
-- Run via supabase db push of a temporary test migration, OR via supabase Studio SQL editor:
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at)
VALUES (
  gen_random_uuid(),
  'v2test@example.com',
  -- crypt() with a known password — for testing only
  crypt('OldV2Password!', gen_salt('bf')),
  now(),
  now() - interval '60 days'  -- simulate "old user"
);
-- The handle_new_user trigger will auto-create a profiles row.
-- Then mark this user as needing password reset:
UPDATE public.profiles
SET tier = 'registered', display_name = 'V2 Test User'
WHERE id = (SELECT id FROM auth.users WHERE email = 'v2test@example.com');
```

Run this once via `supabase db push` (or Studio). DELETE this seed before final commit if you put it in a migration.

## Twilio prerequisites

Twilio WhatsApp sandbox credentials should already be in Supabase edge function secrets:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`

If they're missing in the Supabase function secrets, write a question. Don't put them in `VITE_*` env vars (security rule #4).

## Suggested order of implementation

1. Foundation check (above)
2. Build email+password form (simplest, no edge function needed)
3. Build email OTP form (uses Supabase's built-in magic link)
4. Write `whatsapp-send-otp` + `whatsapp-verify-otp` edge functions
5. Deploy edge functions: `npx supabase functions deploy whatsapp-send-otp whatsapp-verify-otp`
6. Build WhatsApp OTP form
7. Build WhatsApp + password form (requires phone auth enabled in Supabase Auth settings — write a question if it's not)
8. Build the bridge logic in `src/lib/auth-bridge.ts`
9. Replace `src/pages/Auth.tsx` with tabbed UI
10. Build `SetPassword.tsx`
11. Build `admin/VerifiedReviewQueue.tsx` (basic table + promote button)
12. Add 4 Playwright e2e tests (one per method, happy path)
13. `npm run build` + verify
14. Commit each chunk separately, push at the end

## Notes for the agent

- shadcn `form` component is missing from the initial scaffold. Try `npx shadcn@latest add form` first; if that fails, hand-roll the form using react-hook-form + zod directly without the shadcn wrapper.
- The `lib/types.ts` file has TypeScript aliases for all the tables — use those instead of repeating `Database['public']['Tables']['profiles']['Row']` everywhere.
- DO NOT push to V3 if `npm run build` fails. Iterate locally until green.
- If you hit Anthropic rate limits or run out of context window, write a partial-progress question file describing where you are.

---

**Done condition:** all 4 acceptance criteria met, build green, commit message references this task ID (`phase-1.3-auth`).
