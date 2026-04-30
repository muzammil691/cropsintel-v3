# Task: Phase 1.4a — Database row-level security (RLS) policies

**Master plan reference:** §11.2 Phase 1.4 — "3-tier RBAC at route + DB + app, V1 pattern"
**Context:** Server-side RBAC enforcement. Even if frontend is bypassed, the database refuses unauthorized reads/writes. Foundation for all CropsIntel data access.
**Estimated effort:** ~30 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Create RLS policies on every business table so:
- `guest` (anonymous): can read public marketing data only (commodities, canonical_products, news)
- `registered` (any signed-in user): can read their own profile, write their own preferences
- `verified` (manually reviewed by Maxons team): can read full market data, position reports, deals
- `maxons` (admin): can read/write everything; manage other users

## Tier helper function

First, create a Postgres function that returns the current user's tier:

```sql
CREATE OR REPLACE FUNCTION public.current_user_tier()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT tier FROM public.profiles WHERE id = auth.uid()),
    'guest'
  );
$$;

CREATE OR REPLACE FUNCTION public.tier_at_least(min_tier text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE current_user_tier()
      WHEN 'maxons' THEN true
      WHEN 'verified' THEN min_tier IN ('guest','registered','verified')
      WHEN 'registered' THEN min_tier IN ('guest','registered')
      ELSE min_tier = 'guest'
    END;
$$;
```

## Tables and their policies

### profiles

```sql
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone reads own" ON public.profiles;
CREATE POLICY "anyone reads own"
  ON public.profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "maxons reads all" ON public.profiles;
CREATE POLICY "maxons reads all"
  ON public.profiles FOR SELECT USING (current_user_tier() = 'maxons');
DROP POLICY IF EXISTS "user updates own" ON public.profiles;
CREATE POLICY "user updates own"
  ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "maxons updates any" ON public.profiles;
CREATE POLICY "maxons updates any"
  ON public.profiles FOR UPDATE USING (current_user_tier() = 'maxons') WITH CHECK (true);
```

### commodities + canonical_products (PUBLIC reference)

```sql
ALTER TABLE public.commodities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone reads commodities" ON public.commodities;
CREATE POLICY "anyone reads commodities"
  ON public.commodities FOR SELECT USING (true);
-- only maxons can mutate
DROP POLICY IF EXISTS "maxons writes commodities" ON public.commodities;
CREATE POLICY "maxons writes commodities"
  ON public.commodities FOR INSERT WITH CHECK (current_user_tier() = 'maxons');
CREATE POLICY "maxons updates commodities"
  ON public.commodities FOR UPDATE USING (current_user_tier() = 'maxons');

ALTER TABLE public.canonical_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone reads products" ON public.canonical_products;
CREATE POLICY "anyone reads products"
  ON public.canonical_products FOR SELECT USING (true);
CREATE POLICY "maxons writes products"
  ON public.canonical_products FOR ALL USING (current_user_tier() = 'maxons') WITH CHECK (current_user_tier() = 'maxons');
```

### companies + contacts + relationships (CRM)

```sql
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
-- registered: can read companies they're affiliated with
CREATE POLICY "users read own company"
  ON public.companies FOR SELECT
  USING (
    auth.uid() IN (SELECT id FROM profiles WHERE company_id = companies.id::text)
    OR tier_at_least('verified')  -- verified users see all companies
  );
CREATE POLICY "maxons writes companies"
  ON public.companies FOR ALL
  USING (current_user_tier() = 'maxons')
  WITH CHECK (current_user_tier() = 'maxons');

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own contacts"
  ON public.contacts FOR SELECT
  USING (
    auth.uid() = user_id  -- if contacts table has user_id column
    OR tier_at_least('verified')
  );
CREATE POLICY "users write own contacts"
  ON public.contacts FOR INSERT WITH CHECK (auth.uid() = user_id OR current_user_tier() = 'maxons');

ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "verified read relationships"
  ON public.relationships FOR SELECT USING (tier_at_least('verified'));
CREATE POLICY "maxons writes relationships"
  ON public.relationships FOR ALL USING (current_user_tier() = 'maxons') WITH CHECK (current_user_tier() = 'maxons');
```

### Future tables (placeholder policies)

For tables that don't exist yet (e.g., `position_reports` from Phase 1.7, `deals` from Phase 2.10), add a comment in the migration:

```sql
-- Phase 1.7+: when position_reports table is created, apply:
-- CREATE POLICY "verified reads position reports" ON position_reports FOR SELECT USING (tier_at_least('verified'));
-- CREATE POLICY "maxons writes position reports" ON position_reports FOR ALL USING (current_user_tier() = 'maxons');
```

### Verifier_runs, atlas_*, council_*, memory_chunks (DEV-time tables)

These are dev-house tables, NOT user-facing. Apply restrictive policies:

```sql
-- Read-only for any authenticated user, write only for service_role (already default)
ALTER TABLE public.verifier_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads verifier_runs" ON public.verifier_runs FOR SELECT USING (true);
-- inserts/updates blocked except for service_role

ALTER TABLE public.atlas_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads atlas_snapshots" ON public.atlas_snapshots FOR SELECT USING (true);

ALTER TABLE public.atlas_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads atlas_conversations" ON public.atlas_conversations FOR SELECT USING (true);
-- Tighten to "auth.uid() = thread_owner" once we have user-thread mapping

ALTER TABLE public.memory_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "verified reads memory_chunks" ON public.memory_chunks FOR SELECT USING (tier_at_least('verified'));
```

## Migration file

```
supabase/migrations/<timestamp>_rbac_rls_policies.sql
```

Contains all the SQL above + the helper functions.

## Acceptance criteria

After this task ships:

1. Migration file exists and applies cleanly
2. `current_user_tier()` and `tier_at_least(min_tier text)` functions exist
3. All listed tables have RLS enabled
4. Anonymous client can SELECT from commodities, canonical_products
5. Anonymous client CANNOT SELECT from profiles, companies, etc.
6. Authenticated `registered` user can read own profile but NOT others
7. Authenticated `verified` user can read companies, position_reports
8. Authenticated `maxons` user can read/write everything
9. `npx supabase db push` runs cleanly

## Test queries (Builder runs these to verify)

```sql
-- As anonymous (no JWT)
SELECT count(*) FROM commodities;  -- should return > 0
SELECT count(*) FROM profiles;     -- should return 0

-- As authenticated user with tier='registered'
-- (set Supabase JWT context manually or use a test user)
SELECT * FROM profiles WHERE id = auth.uid();  -- returns own row
SELECT * FROM companies;  -- returns 0 unless user is affiliated with a company

-- As authenticated user with tier='maxons'
SELECT count(*) FROM profiles;  -- returns all users
```

## Out of scope

- Field-level encryption (Phase 3+)
- Cross-tenant isolation (V3 is single-tenant)
- Audit logging on every read (too expensive; use Supabase audit logs feature later)
- API throttling per tier (Phase 3 with abuse signals)

## Notes

- `SECURITY DEFINER` on tier functions means they run with the function owner's permissions, not caller's — required so non-privileged users can call them
- Always include `WITH CHECK` clauses for INSERT/UPDATE — without it, the policy is missing the write-side check
- Test EVERY policy with both an authenticated and anonymous JWT before considering this done
- After this ships, ALL future table migrations MUST include their own RLS policies — don't ship a public table without policies
