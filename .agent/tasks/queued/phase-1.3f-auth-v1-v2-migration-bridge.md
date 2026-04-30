# Task: Phase 1.3f — V1 + V2 user migration bridge

**Master plan reference:** §11.2 Phase 1.3 — "V1+V2 user migration bridge"
**Context:** Existing V1 (almond-oracle) and V2 (CropsIntelV2) users need a path to V3 without re-registering. When a returning user signs in with their old email/phone, V3 detects them, copies their profile, and merges sessions.
**Estimated effort:** ~30 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

When a user signs in to V3 with credentials matching a V1 or V2 record, automatically copy their profile (display name, tier, company affiliation, language preference) into V3's `profiles` table and merge their history.

## Approach

### 1. Read-only V1+V2 reference

V1 and V2 each have their own Supabase projects:
- V1 project: `knicjcmgizovpsnmbwex` (almond-oracle)
- V2 project: `eywsfmixzrdfcywmdaaw` (CropsIntelV2)

We can't write into them — V3 should only READ from them via the anon key (saved in V3 env as `V1_SUPABASE_URL` / `V1_SUPABASE_ANON_KEY` and `V2_SUPABASE_URL` / `V2_SUPABASE_ANON_KEY`).

For the migration bridge, we read V1's `auth.users` and V2's `auth.users` (these are NOT directly readable via anon key — security). So instead, we maintain a SNAPSHOT of legacy users in a V3 read-only table populated via a one-time export.

### 2. Files to create

```
supabase/migrations/<timestamp>_legacy_users.sql
supabase/functions/check-legacy-user/index.ts  # called from frontend on login
src/lib/auth-migration.ts
src/contexts/AuthContext.tsx                   # MODIFIED — call migration check on first SIGNED_IN event
```

### 3. Schema migration

```sql
CREATE TABLE public.legacy_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('v1', 'v2')),
  legacy_user_id text NOT NULL,
  email text,
  phone text,
  display_name text,
  tier text DEFAULT 'registered',
  company_id text,
  preferred_language text DEFAULT 'en',
  legacy_created_at timestamptz,
  migrated_to_v3_user_id uuid REFERENCES auth.users(id),
  migrated_at timestamptz,
  raw_legacy_record jsonb,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legacy_users_email ON legacy_users (email) WHERE email IS NOT NULL;
CREATE INDEX idx_legacy_users_phone ON legacy_users (phone) WHERE phone IS NOT NULL;
ALTER TABLE legacy_users ENABLE ROW LEVEL SECURITY;
-- service_role only — clients call via edge function
```

### 4. One-time data import (manual, NOT in this task)

Document in `.agent/questions/phase-1.3f-q.md` that user must:
1. Export V1 auth.users + profiles via SQL on V1 Supabase
2. Export V2 auth.users + profiles via SQL on V2 Supabase
3. Transform to legacy_users format and INSERT into V3
4. This is a one-shot manual step; migration code only handles per-login matching

### 5. Edge function: check-legacy-user

```ts
// supabase/functions/check-legacy-user/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // Decode user from JWT in Authorization header
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 })

  // Check if profile already exists (already migrated)
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()
  if (existingProfile) {
    return new Response(JSON.stringify({ migrated: false, reason: 'already_has_profile' }))
  }

  // Find matching legacy user by email or phone
  let query = supabase.from('legacy_users').select('*').is('migrated_to_v3_user_id', null)
  if (user.email) query = query.eq('email', user.email)
  else if (user.phone) query = query.eq('phone', user.phone)

  const { data: legacy } = await query.maybeSingle()
  if (!legacy) {
    // No matching legacy → create empty profile
    await supabase.from('profiles').insert({
      id: user.id,
      tier: 'registered',
      display_name: user.email ?? user.phone ?? 'New User',
    })
    return new Response(JSON.stringify({ migrated: false, profile_created: true }))
  }

  // Migrate: copy legacy fields into profiles
  await supabase.from('profiles').insert({
    id: user.id,
    tier: legacy.tier,
    display_name: legacy.display_name,
    company_id: legacy.company_id,
    preferred_language: legacy.preferred_language,
  })

  // Mark legacy_user as migrated
  await supabase.from('legacy_users').update({
    migrated_to_v3_user_id: user.id,
    migrated_at: new Date().toISOString(),
  }).eq('id', legacy.id)

  return new Response(JSON.stringify({
    migrated: true,
    legacy_source: legacy.source,
    legacy_user_id: legacy.legacy_user_id,
    profile_imported: { tier: legacy.tier, display_name: legacy.display_name },
  }))
})
```

### 6. Frontend hook (auth-migration.ts)

```ts
import { supabase } from './supabase'

export async function checkLegacyMigration(): Promise<{ migrated: boolean; legacy_source?: 'v1' | 'v2' }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { migrated: false }

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-legacy-user`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) return { migrated: false }
  return await res.json()
}
```

### 7. Wire into AuthContext

In `src/contexts/AuthContext.tsx`, after `loadProfile`, add:

```tsx
const { migrated, legacy_source } = await checkLegacyMigration()
if (migrated) {
  console.log(`Welcome back! Imported your ${legacy_source} account.`)
  await loadProfile(sessionUser)  // re-load with imported fields
}
```

Show a one-time toast: "Welcome back from V1/V2 — your profile was migrated."

## Acceptance criteria

After this task ships:

1. `legacy_users` table exists with proper indexes
2. `check-legacy-user` edge function deployed
3. AuthContext calls migration check on each SIGNED_IN event
4. If profile already exists → no-op
5. If legacy match → profile created from legacy fields, legacy_users.migrated_to_v3_user_id set
6. If no match → empty profile created with sensible defaults
7. `.agent/questions/phase-1.3f-q.md` documents the manual export step

## Out of scope

- Actual data export from V1/V2 (manual, one-shot)
- Merging deals/inquiries/relationships from V1/V2 (Phase 2)
- User-initiated "import again" flow (just runs once on first login)

## Notes

- Match priority: email > phone (email is more unique)
- Sensitive: don't expose legacy email/phone via client. Edge function only.
- `migrated_to_v3_user_id` lets us audit who got migrated and when
- This is the ONLY way V1+V2 users get auto-imported — no other migration path
