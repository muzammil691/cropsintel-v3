-- =============================================================================
-- CropsIntel V3 — Phase 1.4: Three relationship graphs (the spine)
-- Master plan ref: §1.4 — CRM/BRM/SRM as separately-permissioned graphs with
-- load-bearing information walls.
-- =============================================================================
-- The foundation migration (20260428000001) already created:
--   • relationships table with role enum {crm_customer, brm_broker, srm_supplier}
--   • RLS gating: maxons writes; verified+ reads (20260430210000)
--
-- This migration adds the spine helpers and the information-wall metadata that
-- the three graphs need before Phase 2 starts shipping CRUD on top:
--
--   1. user_company_role(uuid)        → relationship_role | NULL
--      Resolves a user → their profile.company_id → the relationship row.
--      Used by RLS, by the customer/broker/supplier portals (Phase 3), and by
--      Zyra's zyraDataBoundary module for context-aware enforcement.
--
--   2. current_user_relationship_role() — convenience wrapper for auth.uid().
--
--   3. is_in_graph(uuid, role)        → boolean
--      "Is this user a member of the named graph?"
--
--   4. graph_for_company_type(type)   → relationship_role | NULL
--      Maps the company_type enum to its relationship_role counterpart.
--      Helpful for backfills and admin UI.
--
--   5. v_user_graph view              — joins profile → company → relationship.
--      Read-only, RLS-respecting (no SECURITY DEFINER).
--
--   6. information_walls table        — codifies the three load-bearing walls
--      from master plan §1.4. Single source of truth that the runtime agents
--      (Zyra R1, CRM Intelligence Agent R4, Quote Drafting R5, etc.) will read
--      to know what each graph is *not* allowed to see.
--
-- All helpers are STABLE + SECURITY DEFINER where they need to bypass RLS to
-- look up the caller's profile/company. Search path is locked.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. graph_for_company_type — pure mapping, no DB lookups
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.graph_for_company_type(_type public.company_type)
RETURNS public.relationship_role
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _type
    WHEN 'customer'         THEN 'crm_customer'::public.relationship_role
    WHEN 'broker'           THEN 'brm_broker'::public.relationship_role
    WHEN 'supplier'         THEN 'srm_supplier'::public.relationship_role
    WHEN 'maxons_internal'  THEN NULL
  END;
$$;

-- -----------------------------------------------------------------------------
-- 2. user_company_role — given a user_id, what graph is their company in?
-- Resolution: profiles.company_id → relationships.role (active only).
-- Falls back to companies.company_type → graph_for_company_type() if no
-- relationship row exists yet (a registered user whose company hasn't been
-- promoted into the spine).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_company_role(_user_id uuid)
RETURNS public.relationship_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH p AS (
    SELECT company_id FROM public.profiles WHERE id = _user_id
  )
  SELECT COALESCE(
    (
      SELECT r.role
      FROM public.relationships r
      JOIN p ON r.company_id = p.company_id
      WHERE r.is_active = true
      LIMIT 1
    ),
    (
      SELECT public.graph_for_company_type(c.company_type)
      FROM public.companies c
      JOIN p ON c.id = p.company_id
      LIMIT 1
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- 3. current_user_relationship_role — convenience for RLS / app code
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_relationship_role()
RETURNS public.relationship_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_company_role(auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- 4. is_in_graph — boolean membership check
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_in_graph(_user_id uuid, _role public.relationship_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_company_role(_user_id) = _role;
$$;

-- -----------------------------------------------------------------------------
-- 5. v_user_graph — read-only joined view
-- Maxons sees all rows; non-maxons see only their own row (via underlying RLS
-- on profiles + companies + relationships). The view itself does no extra
-- gating — it inherits from the base tables.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_user_graph;
CREATE VIEW public.v_user_graph AS
SELECT
  p.id            AS user_id,
  p.full_name     AS user_full_name,
  p.tier          AS user_tier,
  c.id            AS company_id,
  c.name          AS company_name,
  c.company_type  AS company_type,
  c.country       AS company_country,
  r.id            AS relationship_id,
  r.role          AS graph_role,
  r.verification_status AS graph_verification_status,
  r.is_active     AS graph_is_active
FROM public.profiles p
LEFT JOIN public.companies c ON c.id = p.company_id
LEFT JOIN public.relationships r
  ON r.company_id = c.id
  AND r.is_active = true;

COMMENT ON VIEW public.v_user_graph IS
  'Phase 1.4 spine: profiles → companies → relationships. Inherits RLS from base tables.';

-- -----------------------------------------------------------------------------
-- 6. information_walls — load-bearing wall metadata (master plan §1.4)
-- -----------------------------------------------------------------------------
-- The three walls describe what each graph is NOT allowed to see. Runtime
-- agents (Zyra, CRM Intelligence, Quote Drafting) read this table at startup
-- and use it to filter context, redact prompts, and reject queries that would
-- breach the wall.
--
-- Wall semantics:
--   • viewer_role         — the graph member doing the looking
--   • forbidden_category  — symbolic field/concept they cannot see
--   • description         — human-readable rationale
--   • severity            — 'block' (refuse) | 'redact' (replace with [redacted])
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.information_walls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_role public.relationship_role NOT NULL,
  forbidden_category text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'block' CHECK (severity IN ('block', 'redact')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(viewer_role, forbidden_category)
);

CREATE INDEX IF NOT EXISTS idx_walls_viewer ON public.information_walls(viewer_role);
CREATE INDEX IF NOT EXISTS idx_walls_active ON public.information_walls(is_active);

CREATE TRIGGER trg_walls_updated_at BEFORE UPDATE ON public.information_walls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.information_walls ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user can read the wall registry (so Zyra etc. can
-- query their own constraints). The walls themselves are not secret —
-- enforcing them is.
CREATE POLICY "anyone authenticated reads information_walls"
  ON public.information_walls FOR SELECT
  TO authenticated
  USING (true);

-- Write: maxons_team only. Walls are policy.
CREATE POLICY "maxons writes information_walls"
  ON public.information_walls FOR ALL
  TO authenticated
  USING (current_user_tier() = 'maxons_team')
  WITH CHECK (current_user_tier() = 'maxons_team');

-- Service role: full access (edge functions need this).
CREATE POLICY "service_role full access information_walls"
  ON public.information_walls FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Seed: the three load-bearing walls from master plan §1.4
-- -----------------------------------------------------------------------------
INSERT INTO public.information_walls (viewer_role, forbidden_category, description, severity) VALUES
  -- Customers (CRM): see ONLY their own pricing. Never source, never margin.
  ('crm_customer', 'supplier_identity',
   'Customers must never see which supplier sourced their product.', 'block'),
  ('crm_customer', 'broker_identity',
   'Customers must never see which broker intermediated the deal.', 'block'),
  ('crm_customer', 'margin_structure',
   'Customers must never see Maxons margin, landed cost, or cost basis.', 'block'),
  ('crm_customer', 'other_customer_pricing',
   'Customers must never see pricing offered to any other customer.', 'block'),
  ('crm_customer', 'supplier_offer_price',
   'Customers must never see raw supplier offer prices — only their own quoted price.', 'block'),

  -- Brokers (BRM): see market intelligence + commission opportunities.
  ('brm_broker', 'customer_identity_unless_shared',
   'Brokers see customer identity only on deals they themselves intermediated.', 'redact'),
  ('brm_broker', 'maxons_internal_margin',
   'Brokers must never see Maxons internal margin structure.', 'block'),
  ('brm_broker', 'other_broker_commissions',
   'Brokers must never see commission terms granted to other brokers.', 'block'),

  -- Suppliers (SRM): see pricing/demand to maximize their profit.
  ('srm_supplier', 'customer_identity',
   'Suppliers must never see end-customer identity for non-direct deals.', 'block'),
  ('srm_supplier', 'maxons_resale_price',
   'Suppliers must never see Maxons resale price downstream.', 'block'),
  ('srm_supplier', 'broker_identity',
   'Suppliers must never see which broker is involved in the downstream sale.', 'redact'),
  ('srm_supplier', 'other_supplier_offers',
   'Suppliers must never see competing supplier offers.', 'block')
ON CONFLICT (viewer_role, forbidden_category) DO NOTHING;

-- =============================================================================
-- End of Phase 1.4 spine migration
-- =============================================================================
-- Created:
--   • 4 functions: graph_for_company_type, user_company_role,
--                  current_user_relationship_role, is_in_graph
--   • 1 view:     v_user_graph
--   • 1 table:    information_walls (with 12 seed rows: 5 + 3 + 4)
-- =============================================================================
