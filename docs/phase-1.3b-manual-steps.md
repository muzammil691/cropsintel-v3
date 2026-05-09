# Phase 1.3b — Manual deployment steps

After the Phase 1.3b PR lands on `main`, Muzammil runs the following on his
workstation against the V3 Supabase project (`hzrnohsxigrqlmzegwlb`).

## 1. Apply the migration

Adds `public.chat_sessions` for registered/verified users. RLS is enabled and
service-role-only writes happen through the edge functions.

```bash
npx supabase db push
```

Verify with:

```bash
psql "$SUPABASE_DB_URL" -c "\dt+ public.chat_sessions"
psql "$SUPABASE_DB_URL" -c "\d+ public.chat_sessions"
```

## 2. Deploy the edge functions

`zyra-chat` is the customer-facing chat brain (placeholder for Phase 1.10).
`guest-gate` enforces the 10-deep-output gate server-side.

```bash
npx supabase functions deploy zyra-chat
npx supabase functions deploy guest-gate
```

Both functions read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the
edge-runtime env (already set on the project).

## 3. Regenerate types

The `chat_sessions` table needs to land in `src/lib/database.types.ts` so
downstream code (Phase 1.10) can use the typed client.

```bash
npx supabase gen types typescript --project-id hzrnohsxigrqlmzegwlb \
  > src/lib/database.types.ts
```

Commit the regenerated `database.types.ts` as a follow-up.

## 4. Verify on localhost

```bash
npm run dev
open http://localhost:5173/
```

Manual checklist:

- [ ] Brand mark + tagline visible on the left rail (desktop)
- [ ] Greeting message appears at top of the chat panel
- [ ] 4 starter chips clickable
- [ ] Free-input box accepts text and submits
- [ ] Counter shows `0 / 10 deep insights used` for anonymous visitors
- [ ] After clicking a starter, the assistant replies and the counter advances when the prompt contains a deep keyword
- [ ] On a fresh anonymous session, send 11 deep queries — the 11th renders the upgrade pitch with Email + WhatsApp buttons
- [ ] Email button URL: `/auth?mode=register&method=email&from=landing`
- [ ] After signing up, the counter disappears (tier > guest) and the conversation continues
- [ ] As a registered user, asking for "real-time prices" / "supplier names" / "position report" triggers the verified-tier pitch
- [ ] As a verified user, the same query no longer triggers an upgrade pitch

## 5. Run the e2e suite

```bash
E2E_NO_WEBSERVER=1 npx playwright test e2e/phase-1.3b-landing.spec.ts
```

(Or omit `E2E_NO_WEBSERVER` to let Playwright spawn its own dev server.)

## Out of scope for this phase

- Real Claude-powered Zyra (Phase 1.10 — 13 modules)
- Real-time price data (Phase 1.6 — Adela data spine)
- Multi-language landing (Phase 1.12)
- Voice input/output (deferred)
- Saved chat history UI for registered users — data persists, page lands in Phase 1.9
