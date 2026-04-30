-- =============================================================================
-- CropsIntel V3 — Phase 1.4a: Tier-based RLS policies
-- Master plan ref: §11.2 Phase 1.4 — "3-tier RBAC at route + DB + app"
-- =============================================================================
-- Adds current_user_tier() and tier_at_least() helper functions, then replaces
-- the foundation has_role()-based policies with tier-based policies aligned with
-- the four-tier model: guest → registered → verified → maxons_team
--
-- Tables updated: profiles, commodities, canonical_products, companies, contacts,
--   relationships, verifier_runs, atlas_snapshots, atlas_conversations, memory_chunks
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tier helper functions
-- current_user_tier(): returns the calling user's tier as text, or 'guest' for anon.
-- tier_at_least():     returns true if the calling user's tier >= the required tier.
-- Both are SECURITY DEFINER so they can read profiles even when RLS is active.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_tier()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT tier::text FROM public.profiles WHERE id = auth.uid()),
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
      WHEN 'maxons_team' THEN true
      WHEN 'verified'    THEN min_tier IN ('guest', 'registered', 'verified')
      WHEN 'registered'  THEN min_tier IN ('guest', 'registered')
      ELSE min_tier = 'guest'
    END;
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- Replace has_role()-based policies with tier-based equivalents.
-- Anon users can't see any profiles. Registered users see their own. Maxons see all.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "users can read own profile"                        ON public.profiles;
DROP POLICY IF EXISTS "users can update own profile (limited)"            ON public.profiles;
DROP POLICY IF EXISTS "team can read all profiles"                        ON public.profiles;
DROP POLICY IF EXISTS "team can update profiles (incl. tier promotions)"  ON public.profiles;
DROP POLICY IF EXISTS "admins can insert profiles"                        ON public.profiles;
-- Drop new policy names (idempotent re-run guard)
DROP POLICY IF EXISTS "anyone reads own"    ON public.profiles;
DROP POLICY IF EXISTS "maxons reads all"    ON public.profiles;
DROP POLICY IF EXISTS "user updates own"    ON public.profiles;
DROP POLICY IF EXISTS "maxons updates any"  ON public.profiles;
DROP POLICY IF EXISTS "maxons inserts profiles" ON public.profiles;

CREATE POLICY "anyone reads own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "maxons reads all"
  ON public.profiles FOR SELECT
  USING (current_user_tier() = 'maxons_team');

CREATE POLICY "user updates own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "maxons updates any"
  ON public.profiles FOR UPDATE
  USING (current_user_tier() = 'maxons_team')
  WITH CHECK (true);

CREATE POLICY "maxons inserts profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (current_user_tier() = 'maxons_team');

-- handle_new_user() trigger is SECURITY DEFINER and runs as postgres, bypassing
-- RLS — so new auth.users automatically get a profile row regardless of the above.

-- -----------------------------------------------------------------------------
-- commodities — PUBLIC reference data; anonymous read allowed
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "anyone authenticated can read commodities"  ON public.commodities;
DROP POLICY IF EXISTS "admins can manage commodities"              ON public.commodities;
DROP POLICY IF EXISTS "anyone reads commodities"                   ON public.commodities;
DROP POLICY IF EXISTS "maxons writes commodities"                  ON public.commodities;
DROP POLICY IF EXISTS "maxons updates commodities"                 ON public.commodities;
DROP POLICY IF EXISTS "maxons deletes commodities"                 ON public.commodities;

CREATE POLICY "anyone reads commodities"
  ON public.commodities FOR SELECT
  USING (true);

CREATE POLICY "maxons writes commodities"
  ON public.commodities FOR INSERT
  WITH CHECK (current_user_tier() = 'maxons_team');

CREATE POLICY "maxons updates commodities"
  ON public.commodities FOR UPDATE
  USING (current_user_tier() = 'maxons_team');

CREATE POLICY "maxons deletes commodities"
  ON public.commodities FOR DELETE
  USING (current_user_tier() = 'maxons_team');

-- -----------------------------------------------------------------------------
-- canonical_products — PUBLIC reference data; anonymous read allowed
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "anyone authenticated can read products"  ON public.canonical_products;
DROP POLICY IF EXISTS "team can manage products"               ON public.canonical_products;
DROP POLICY IF EXISTS "anyone reads products"                  ON public.canonical_products;
DROP POLICY IF EXISTS "maxons writes products"                 ON public.canonical_products;

CREATE POLICY "anyone reads products"
  ON public.canonical_products FOR SELECT
  USING (true);

CREATE POLICY "maxons writes products"
  ON public.canonical_products FOR ALL
  USING (current_user_tier() = 'maxons_team')
  WITH CHECK (current_user_tier() = 'maxons_team');

-- -----------------------------------------------------------------------------
-- companies — CRM entity
-- Registered users see their affiliated company (via profiles.company_id).
-- Verified+ users see all companies. Maxons can write.
-- Note: profiles.company_id is uuid; companies.id is uuid — no cast needed.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "team can read all companies"  ON public.companies;
DROP POLICY IF EXISTS "team can insert companies"    ON public.companies;
DROP POLICY IF EXISTS "team can update companies"    ON public.companies;
DROP POLICY IF EXISTS "admins can delete companies"  ON public.companies;
DROP POLICY IF EXISTS "users read own company"       ON public.companies;
DROP POLICY IF EXISTS "maxons writes companies"      ON public.companies;

CREATE POLICY "users read own company"
  ON public.companies FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM public.profiles WHERE company_id = companies.id
    )
    OR tier_at_least('verified')
  );

CREATE POLICY "maxons writes companies"
  ON public.companies FOR ALL
  USING (current_user_tier() = 'maxons_team')
  WITH CHECK (current_user_tier() = 'maxons_team');

-- -----------------------------------------------------------------------------
-- contacts — CRM people inside companies
-- contacts has no user_id column, so we gate purely on tier.
-- Verified+ can read; maxons can write.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "team can manage contacts"  ON public.contacts;
DROP POLICY IF EXISTS "users read own contacts"   ON public.contacts;
DROP POLICY IF EXISTS "users write own contacts"  ON public.contacts;
DROP POLICY IF EXISTS "maxons writes contacts"    ON public.contacts;

CREATE POLICY "users read own contacts"
  ON public.contacts FOR SELECT
  USING (tier_at_least('verified'));

CREATE POLICY "maxons writes contacts"
  ON public.contacts FOR ALL
  USING (current_user_tier() = 'maxons_team')
  WITH CHECK (current_user_tier() = 'maxons_team');

-- -----------------------------------------------------------------------------
-- relationships — CRM/BRM/SRM spine
-- Verified+ can read; maxons can write.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "team can manage relationships"  ON public.relationships;
DROP POLICY IF EXISTS "verified read relationships"    ON public.relationships;
DROP POLICY IF EXISTS "maxons writes relationships"    ON public.relationships;

CREATE POLICY "verified read relationships"
  ON public.relationships FOR SELECT
  USING (tier_at_least('verified'));

CREATE POLICY "maxons writes relationships"
  ON public.relationships FOR ALL
  USING (current_user_tier() = 'maxons_team')
  WITH CHECK (current_user_tier() = 'maxons_team');

-- -----------------------------------------------------------------------------
-- verifier_runs — dev-house audit table; open read, service_role writes only
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Team can read verifier runs"      ON public.verifier_runs;
DROP POLICY IF EXISTS "Service can insert verifier runs" ON public.verifier_runs;
DROP POLICY IF EXISTS "anyone reads verifier_runs"       ON public.verifier_runs;

CREATE POLICY "anyone reads verifier_runs"
  ON public.verifier_runs FOR SELECT
  USING (true);
-- INSERT/UPDATE blocked for anon/authenticated; service_role bypasses RLS

-- -----------------------------------------------------------------------------
-- atlas_snapshots — open read (rename policy for naming consistency)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read snapshots"    ON public.atlas_snapshots;
DROP POLICY IF EXISTS "anyone reads atlas_snapshots" ON public.atlas_snapshots;

CREATE POLICY "anyone reads atlas_snapshots"
  ON public.atlas_snapshots FOR SELECT
  USING (true);

-- -----------------------------------------------------------------------------
-- atlas_conversations — open read (rename policy for naming consistency)
-- Tighten to "auth.uid() = thread_owner" once user-thread mapping exists.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read conversations"      ON public.atlas_conversations;
DROP POLICY IF EXISTS "anyone reads atlas_conversations"   ON public.atlas_conversations;

CREATE POLICY "anyone reads atlas_conversations"
  ON public.atlas_conversations FOR SELECT
  USING (true);

-- -----------------------------------------------------------------------------
-- memory_chunks — tighten from open-read to verified+
-- search_memory_chunks() is SECURITY DEFINER and bypasses RLS for vector search.
-- Direct table reads now require verified tier.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read memory chunks" ON public.memory_chunks;
DROP POLICY IF EXISTS "verified reads memory_chunks"  ON public.memory_chunks;

CREATE POLICY "verified reads memory_chunks"
  ON public.memory_chunks FOR SELECT
  USING (tier_at_least('verified'));

-- -----------------------------------------------------------------------------
-- Future table policy placeholders (applied when tables are created)
-- -----------------------------------------------------------------------------
-- Phase 1.7+: position_reports (currently "Anyone can read position reports")
-- When tighter control is needed:
--   DROP POLICY IF EXISTS "Anyone can read position reports" ON public.position_reports;
--   CREATE POLICY "verified reads position reports"
--     ON public.position_reports FOR SELECT USING (tier_at_least('verified'));
--   CREATE POLICY "maxons writes position reports"
--     ON public.position_reports FOR ALL
--     USING (current_user_tier() = 'maxons_team')
--     WITH CHECK (current_user_tier() = 'maxons_team');

-- Phase 2.10+: deals/offers table (does not exist yet)
--   CREATE POLICY "verified reads deals" ON deals FOR SELECT USING (tier_at_least('verified'));
--   CREATE POLICY "maxons writes deals" ON deals FOR ALL
--     USING (current_user_tier() = 'maxons_team')
--     WITH CHECK (current_user_tier() = 'maxons_team');
