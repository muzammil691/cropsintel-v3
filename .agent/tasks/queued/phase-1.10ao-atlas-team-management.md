---
priority: 1
depends-on: [phase-1.10aj-atlas-auth-and-live-sync]
---

# Task: Phase 1.10ao — Atlas team management (invite / revoke / role-modify)

**Master plan reference:** §1.10 Atlas as nerve centre + §3 information walls.

**Context:** 1.10aj shipped WhatsApp-OTP auth restricted to a single phone via the `ATLAS_ALLOWED_PHONES` env var. The user now needs to invite collaborators (other team members) with **scoped roles** so multiple people can use Atlas without sharing one login. The single-phone env approach doesn't scale to that. This spec replaces the env-var allowlist with a DB-backed members table, adds an invitation flow, and gates write tools by role.

**Estimated effort:** ~75 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Members table + role model

Migration `supabase/migrations/20260501170000_atlas_members.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.atlas_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text UNIQUE NOT NULL,
  display_name text,
  role text NOT NULL CHECK (role IN ('owner','admin','operator','viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  invited_by uuid REFERENCES public.atlas_members(id),
  invited_at timestamptz NOT NULL DEFAULT now(),
  first_login_at timestamptz,
  last_seen_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_members_phone_active
  ON public.atlas_members (phone) WHERE status = 'active';

-- Seed the owner so the system isn't empty on first deploy.
INSERT INTO public.atlas_members (phone, display_name, role, status, invited_at, first_login_at)
VALUES ('+971562556592', 'Muzammil', 'owner', 'active', now(), now())
ON CONFLICT (phone) DO UPDATE SET role = 'owner', status = 'active';

ALTER TABLE public.atlas_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "atlas_members_service" ON public.atlas_members
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Pending invites: a separate row scheme so a phone can be invited before
-- it has ever logged in (no atlas_members row yet).
CREATE TABLE IF NOT EXISTS public.atlas_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','operator','viewer')),
  display_name text,
  invited_by uuid NOT NULL REFERENCES public.atlas_members(id),
  invite_token text UNIQUE NOT NULL,   -- one-time link suffix shared via WhatsApp
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_invites_phone
  ON public.atlas_invites (phone) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_atlas_invites_token
  ON public.atlas_invites (invite_token) WHERE consumed_at IS NULL AND revoked_at IS NULL;
ALTER TABLE public.atlas_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "atlas_invites_service" ON public.atlas_invites
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
```

**Role semantics:**

| Role | Login | Read status | Read chat | Send chat | Queue specs | Set priority/deps | Restart agents | Flip trust mode | Manage team |
|---|---|---|---|---|---|---|---|---|---|
| owner | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| operator | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| viewer | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

There is exactly one `owner` (the user). The owner cannot be demoted or revoked through the UI (would need a manual SQL update — guardrail against accidental lockout).

### Part B — Replace env-var allowlist with DB lookup

In `atlas/src/lib/auth.ts`:

1. Remove `ATLAS_ALLOWED_PHONES` env-var read.
2. New helper `isPhoneAllowed(phone): Promise<{allowed: boolean; role?: Role; memberId?: string}>`:
   - Query `atlas_members` for `phone = $1 AND status = 'active'`. If found → allowed with `role` and `id`.
   - Else query `atlas_invites` for an unrevoked, unconsumed, unexpired row. If found, **don't** allow login yet — but mark them as "invited" so the OTP request flow can prompt them to consume the invite (returns `{allowed: false, reason: 'pending_invite', inviteId}`).
   - Else `{allowed: false, reason: 'not_invited'}`.
3. On successful OTP verify, if `atlas_members` row doesn't exist but a valid invite does → atomically consume the invite + create the member row + create the session. This is the "first login" path.
4. Update `atlas_members.last_seen_at` and `atlas_members.first_login_at` on every successful auth.
5. Session token now embeds the member's role at issue-time (cached in `atlas_sessions.role` column — add via migration). On revoke or role change, **revoke all sessions** for that member to force re-auth.

### Part C — Server routes

All routes in this section require `role >= 'admin'` for read, `role === 'owner'` for write (except the `/auth/me` route which any authed member can call).

1. **GET `/atlas/team/members`** — list members + computed last-seen + active session count.
2. **GET `/atlas/team/invites`** — pending invites (not yet consumed).
3. **POST `/atlas/team/invite`** (owner only)
   - Body: `{ phone: string, role: 'admin'|'operator'|'viewer', display_name?: string }`
   - Generates a 32-byte URL-safe `invite_token`, inserts `atlas_invites` row with 7-day expiry.
   - WhatsApp message to invitee: `"You've been invited to Atlas (CropsIntel) by Muzammil with role <role>. Open https://muzammil691.github.io/atlas/login?invite=<token> and request a code with this number."`
   - Idempotent: if an unconsumed invite for the same phone already exists, regenerate token + extend expiry instead of duplicating.
4. **POST `/atlas/team/invites/:id/revoke`** (owner only) — sets `revoked_at`, sends a "Your invite was revoked" WhatsApp.
5. **PATCH `/atlas/team/members/:id`** (owner only)
   - Body: `{ role?, display_name?, status?, notes? }`
   - On role change OR `status='suspended'|'revoked'`: revoke ALL active sessions for that member.
   - Owner cannot change their own role/status.
6. **POST `/atlas/team/members/:id/sessions/revoke-all`** (owner only) — log them out everywhere immediately.
7. **GET `/atlas/team/audit-log`** (owner only) — last 100 team-management actions (member added/removed/role-changed). Logs are written by the routes above to a new `atlas_team_audit` table.

### Part D — Tool-level role enforcement

In `atlas/src/lib/dispatch.ts`, every tool dispatch already runs through a permission check (READ_ONLY_TOOLS + trustMode gate). Extend it with role checks:

```typescript
const TOOL_ROLE_REQUIREMENTS: Record<ToolName, Role> = {
  'memory.search': 'viewer',
  'builder.list_queue': 'viewer',
  'builder.list_done': 'viewer',
  'verifier.recent_runs': 'viewer',
  'designer.review_spec': 'viewer',
  'designer.audit_commit': 'viewer',
  'status.snapshot': 'viewer',
  'memory.ingest': 'operator',
  'builder.queue_spec': 'operator',
  'builder.set_priority': 'operator',
  'builder.set_dependencies': 'operator',
  'verifier.audit': 'operator',
  'council.write_spec': 'operator',
  'adela.trigger_scrape': 'admin',
  'whatsapp.send': 'admin',
  'builder.cancel_task': 'admin',
  'atlas.draft_spec': 'admin',
  'atlas.propose_and_queue': 'admin',
}

function roleAtLeast(actual: Role, required: Role): boolean {
  const ranks: Record<Role, number> = { viewer: 1, operator: 2, admin: 3, owner: 4 }
  return ranks[actual] >= ranks[required]
}
```

Dispatch returns `{status: 'blocked', error: 'role <X> insufficient; <tool> requires <Y>'}` on mismatch. The block is rendered in the chat as an artifact card with `[Request elevation from owner]` button (sends a WhatsApp ping to owner).

### Part E — Team UI tab

New tab in the unified cockpit (1.10an): **`/atlas?tab=team`** — visible to admin+, fully editable by owner only.

**Page sections:**

1. **Members table** with columns: Avatar (initials) | Display name | Phone | Role (dropdown for owner) | Status pill | Last seen | Active sessions | Actions (revoke-all-sessions, edit, suspend)
2. **Pending invites table** with columns: Phone | Role | Invited by | Expires in | Actions (resend, revoke, copy invite link)
3. **Invite new member** card: phone input + role dropdown + display name + "Send invite" button
4. **Audit log** drawer (owner only): last 50 team actions, paginated

**Frontend files:**
- `src/components/atlas/tabs/AtlasTeamTab.tsx` (NEW)
- `src/components/atlas/team/MemberRow.tsx` (NEW)
- `src/components/atlas/team/InviteRow.tsx` (NEW)
- `src/components/atlas/team/InviteForm.tsx` (NEW)
- `src/components/atlas/team/RoleBadge.tsx` (NEW — colour-coded pill: owner=emerald, admin=sky, operator=amber, viewer=slate)

### Part F — UX guardrails

1. **Owner cannot be demoted** via UI. Attempting it shows a toast "Owner role can only be transferred via direct database operation".
2. **Last admin cannot be demoted/revoked** if they're the only non-owner with admin permissions on team-critical tools — show a confirmation dialog.
3. **Suspended members** keep their member row + history but can't authenticate. Useful for offboarding without losing audit trail.
4. **Revoked members** are soft-deleted: their member row stays but `status='revoked'` blocks all access. Their session tokens are revoked immediately. Display name is preserved for historical attribution in `atlas_conversations` etc.
5. **Phone number changes** must go through "create new member, transfer role, revoke old". No direct phone-edit on existing members (audit hygiene).

## Files

- `supabase/migrations/20260501170000_atlas_members.sql` (NEW — members + invites + audit + sessions.role column)
- `atlas/src/lib/auth.ts` (extend — replace env allowlist with DB lookup, role-aware sessions)
- `atlas/src/lib/dispatch.ts` (extend — TOOL_ROLE_REQUIREMENTS + roleAtLeast check)
- `atlas/src/lib/team.ts` (NEW — invite/revoke/role-change helpers)
- `atlas/src/server.ts` (extend — 7 new routes under `/atlas/team/*`)
- `src/components/atlas/tabs/AtlasTeamTab.tsx` (NEW)
- `src/components/atlas/team/*.tsx` (NEW × 4)
- `src/lib/atlas-client.ts` (extend — team API helpers)
- `src/pages/atlas/AtlasInviteAccept.tsx` (NEW — landing page for invite tokens)

## Success criteria

- `npm run build` clean
- Database has `atlas_members` row for `+971562556592` with `role='owner'` after migration runs
- Old `ATLAS_ALLOWED_PHONES` env-var no longer consulted (verified by grep on Atlas src — zero references)
- Owner can invite a new phone → invitee receives WhatsApp with the invite URL → invitee opens URL → enters their phone → receives OTP → first-login completes → member row created with the invited role
- Inviting a duplicate phone re-generates the token (no duplicate rows)
- Owner can change a member's role → all that member's sessions are revoked → next API call returns 401
- Owner can suspend a member → member can't request a new OTP (gets "account suspended" message)
- A `viewer`-role member calling `/atlas/chat` to invoke `builder.queue_spec` gets a blocked artifact card with `[Request elevation]` button
- Tapping `[Request elevation]` sends a WhatsApp to owner with the request details
- Owner cannot demote themselves via the UI (button disabled + tooltip explains)
- Audit log shows every invite/revoke/role-change with `(actor, action, target, timestamp)`

## Risks + mitigations

- **Risk:** Owner accidentally revokes their only session, then their phone breaks. **Mitigation:** Existing `ATLAS_RECOVERY_TOKEN` env var (from 1.10aj) still mints a recovery session; owner row in DB cannot be `revoked` via UI.
- **Risk:** Invite tokens leak via WhatsApp message screenshot. **Mitigation:** 7-day expiry + one-time consume + the invitee still needs the OTP sent to their actual phone. Token alone is useless without the phone.
- **Risk:** Sessions cache role at issue-time → revoking role doesn't immediately bite if the cache isn't invalidated. **Mitigation:** Role-change handler explicitly revokes all sessions for that member; new tokens carry new role on next login.
- **Risk:** Migration with seeded owner conflicts if user manually inserted a row earlier. **Mitigation:** `ON CONFLICT (phone) DO UPDATE SET role='owner'` upsert pattern.

## NEVER list

- **Never** allow the owner to demote/revoke themselves via the UI (DB-only operation, intentional friction).
- **Never** delete a member row (audit hygiene); use `status='revoked'` instead.
- **Never** log invite tokens or session tokens in service logs.
- **Never** allow `viewer` role to invoke any write tool — even with explicit chat phrasing. Dispatch enforces.
- **Never** ship `ATLAS_ALLOWED_PHONES` references after this spec — env-var path is fully removed.
