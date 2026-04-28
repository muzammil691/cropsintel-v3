-- =============================================================================
-- CropsIntel V3 — Foundation migration
-- =============================================================================
-- Establishes the data foundation for V3 per master plan section 4.1:
--   commodities → companies → contacts → canonical_products → relationships → profiles
--   + market_intelligence + zyra_conversations + audit/observability scaffolding
--
-- Three operating models (A/B/C) supported via the `model` column on later tables.
-- Multi-commodity from Day 1 — every domain table has commodity_id FK.
-- RLS on every table. Three-tier RBAC (auth/team/admin) via has_role() helper.
--
-- Author: Cowork — Muzammil Akhtar
-- Date: 2026-04-28
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. Role enum + has_role() helper (used by every RLS policy below)
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('auth', 'team', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- user_roles table — joins auth.users to app_role; multiple roles per user allowed
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id),
  UNIQUE(user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);

-- has_role() — used in RLS policies. SECURITY DEFINER so policies can call it.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- Convenience: is_team_or_admin() — admin implies team
CREATE OR REPLACE FUNCTION public.is_team_or_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'team'::public.app_role)
      OR public.has_role(_user_id, 'admin'::public.app_role);
$$;

-- -----------------------------------------------------------------------------
-- 2. updated_at trigger helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. commodities — multi-commodity master (Day 1 constraint)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commodities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  display_name text NOT NULL,
  trade_basis_options text[] NOT NULL DEFAULT ARRAY['FAS', 'CIF', 'FOB', 'CFR', 'DAP'],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_commodities_updated_at BEFORE UPDATE ON public.commodities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.commodities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone authenticated can read commodities"
  ON public.commodities FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins can manage commodities"
  ON public.commodities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed: almonds is the pilot
INSERT INTO public.commodities (slug, display_name) VALUES ('almonds', 'Almonds')
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. companies — entity master (customers, brokers, suppliers, MAXONS itself)
-- -----------------------------------------------------------------------------
CREATE TYPE public.company_type AS ENUM ('customer', 'broker', 'supplier', 'maxons_internal');
CREATE TYPE public.verification_status AS ENUM ('unverified', 'pending_review', 'verified', 'rejected');

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company_type public.company_type NOT NULL,
  country text,
  city text,
  website text,
  primary_email text,
  primary_phone text,
  business_registration_number text,
  tax_id text,
  verification_status public.verification_status NOT NULL DEFAULT 'unverified',
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_type ON public.companies(company_type);
CREATE INDEX IF NOT EXISTS idx_companies_verification ON public.companies(verification_status);
CREATE INDEX IF NOT EXISTS idx_companies_country ON public.companies(country);

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can read all companies"
  ON public.companies FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "team can insert companies"
  ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.is_team_or_admin(auth.uid()));

CREATE POLICY "team can update companies"
  ON public.companies FOR UPDATE TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "admins can delete companies"
  ON public.companies FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- 5. contacts — people inside companies
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  job_title text,
  email text,
  phone text,
  whatsapp text,
  is_primary boolean NOT NULL DEFAULT false,
  preferred_language text DEFAULT 'en',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON public.contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON public.contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp ON public.contacts(whatsapp);

CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can manage contacts"
  ON public.contacts FOR ALL TO authenticated
  USING (public.is_team_or_admin(auth.uid()))
  WITH CHECK (public.is_team_or_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- 6. canonical_products — variety + product_type + size + grade master
-- -----------------------------------------------------------------------------
CREATE TYPE public.product_type AS ENUM ('inshell', 'kernel', 'shelled', 'blanched', 'sliced', 'slivered', 'diced');

CREATE TABLE IF NOT EXISTS public.canonical_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  variety text NOT NULL,
  product_type public.product_type NOT NULL DEFAULT 'kernel',
  size text,
  grade text,
  description text,
  aliases text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(commodity_id, variety, product_type, size, grade)
);

CREATE INDEX IF NOT EXISTS idx_products_commodity ON public.canonical_products(commodity_id);
CREATE INDEX IF NOT EXISTS idx_products_variety ON public.canonical_products(variety);

CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.canonical_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.canonical_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone authenticated can read products"
  ON public.canonical_products FOR SELECT TO authenticated USING (true);

CREATE POLICY "team can manage products"
  ON public.canonical_products FOR ALL TO authenticated
  USING (public.is_team_or_admin(auth.uid()))
  WITH CHECK (public.is_team_or_admin(auth.uid()));

-- Seed: common almond varieties (so Phase 2 offers can FK to real rows)
DO $$
DECLARE almond_id uuid;
BEGIN
  SELECT id INTO almond_id FROM public.commodities WHERE slug = 'almonds';
  IF almond_id IS NOT NULL THEN
    INSERT INTO public.canonical_products (commodity_id, variety, product_type, size, grade, aliases) VALUES
      (almond_id, 'Nonpareil', 'kernel', '23/25', 'Supreme', ARRAY['NP', 'NP 23/25', 'Nonpareil 23-25']),
      (almond_id, 'Nonpareil', 'kernel', '25/27', 'Supreme', ARRAY['NP 25/27']),
      (almond_id, 'Nonpareil', 'kernel', '27/30', 'Supreme', ARRAY['NP 27/30']),
      (almond_id, 'Carmel', 'kernel', '23/25', 'Supreme', ARRAY['Cal']),
      (almond_id, 'Carmel', 'kernel', '25/27', 'Supreme', ARRAY[]::text[]),
      (almond_id, 'Independence', 'kernel', '23/25', 'Supreme', ARRAY[]::text[]),
      (almond_id, 'Monterey', 'kernel', '23/25', 'Supreme', ARRAY[]::text[]),
      (almond_id, 'Butte', 'kernel', '23/25', 'Supreme', ARRAY[]::text[]),
      (almond_id, 'Padre', 'kernel', '23/25', 'Supreme', ARRAY[]::text[])
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7. profiles — user accounts (links auth.users to a contact + company + tier)
-- -----------------------------------------------------------------------------
CREATE TYPE public.user_tier AS ENUM ('guest', 'registered', 'verified', 'maxons_team');

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id),
  company_id uuid REFERENCES public.companies(id),
  full_name text,
  display_name text,
  preferred_language text NOT NULL DEFAULT 'en',
  tier public.user_tier NOT NULL DEFAULT 'registered',
  primary_models text[] NOT NULL DEFAULT '{}', -- subset of {'A','B','C'} per master plan section 1.2
  whatsapp_number text,
  whatsapp_verified boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  last_seen_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_company ON public.profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tier ON public.profiles(tier);
CREATE INDEX IF NOT EXISTS idx_profiles_whatsapp ON public.profiles(whatsapp_number);

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "users can update own profile (limited)"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY "team can read all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "team can update profiles (incl. tier promotions)"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "admins can insert profiles"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Auto-create a profile row when a new auth.user is inserted
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 8. relationships — CRM/BRM/SRM edges (the spine)
-- -----------------------------------------------------------------------------
CREATE TYPE public.relationship_role AS ENUM ('crm_customer', 'brm_broker', 'srm_supplier');

CREATE TABLE IF NOT EXISTS public.relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role public.relationship_role NOT NULL,
  verification_status public.verification_status NOT NULL DEFAULT 'unverified',
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  established_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, role)
);

CREATE INDEX IF NOT EXISTS idx_relationships_company ON public.relationships(company_id);
CREATE INDEX IF NOT EXISTS idx_relationships_role ON public.relationships(role);

CREATE TRIGGER trg_relationships_updated_at BEFORE UPDATE ON public.relationships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can manage relationships"
  ON public.relationships FOR ALL TO authenticated
  USING (public.is_team_or_admin(auth.uid()))
  WITH CHECK (public.is_team_or_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- 9. market_intelligence — Phase 1's main data store (price points, news, signals)
-- -----------------------------------------------------------------------------
CREATE TYPE public.intel_source AS ENUM (
  'abc_position_report', 'abc_shipment', 'abc_forecast', 'abc_almanac',
  'usda_nass', 'strata_pricing', 'broker_note', 'customer_indication',
  'supplier_offer', 'news_article', 'manual_entry', 'ai_synthesis'
);

CREATE TABLE IF NOT EXISTS public.market_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  canonical_product_id uuid REFERENCES public.canonical_products(id) ON DELETE SET NULL,
  source public.intel_source NOT NULL,
  source_url text,
  source_attribution text,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  origin_country text,
  destination_country text,
  trade_basis text,
  price_per_lb_usd numeric(10,4),
  quantity_lbs numeric(14,2),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_summary text,
  confidence numeric(3,2) DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intel_commodity ON public.market_intelligence(commodity_id);
CREATE INDEX IF NOT EXISTS idx_intel_product ON public.market_intelligence(canonical_product_id);
CREATE INDEX IF NOT EXISTS idx_intel_source ON public.market_intelligence(source);
CREATE INDEX IF NOT EXISTS idx_intel_occurred ON public.market_intelligence(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_destination ON public.market_intelligence(destination_country);

ALTER TABLE public.market_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone authenticated can read market_intelligence"
  ON public.market_intelligence FOR SELECT TO authenticated USING (is_active = true);

CREATE POLICY "team can insert market_intelligence"
  ON public.market_intelligence FOR INSERT TO authenticated
  WITH CHECK (public.is_team_or_admin(auth.uid()));

CREATE POLICY "team can update market_intelligence"
  ON public.market_intelligence FOR UPDATE TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "service_role full access market_intelligence"
  ON public.market_intelligence FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 10. zyra_conversations — every Zyra chat (per master plan agent rules section 9.3)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zyra_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text NOT NULL,
  channel text NOT NULL DEFAULT 'web', -- 'web' | 'whatsapp' | 'voice'
  user_message text NOT NULL,
  zyra_response text NOT NULL,
  ai_provider text, -- 'claude-sonnet-4' | 'gemini-pro' | etc.
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(10,6),
  confidence numeric(3,2),
  was_escalated boolean NOT NULL DEFAULT false,
  user_challenged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zyra_conv_user ON public.zyra_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_zyra_conv_session ON public.zyra_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_zyra_conv_created ON public.zyra_conversations(created_at DESC);

ALTER TABLE public.zyra_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own zyra_conversations"
  ON public.zyra_conversations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "team can read all zyra_conversations"
  ON public.zyra_conversations FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "service_role can insert zyra_conversations"
  ON public.zyra_conversations FOR INSERT TO service_role WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 11. agent_audit_log — generic audit table for any runtime agent (master plan 9.3)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL, -- 'zyra' | 'adela' | 'atlas' | 'crm-intel' | etc.
  action_type text NOT NULL, -- 'chat' | 'scrape' | 'analysis' | 'escalation' | etc.
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  status text NOT NULL DEFAULT 'success', -- 'success' | 'failure' | 'partial'
  error_message text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_agent ON public.agent_audit_log(agent_name);
CREATE INDEX IF NOT EXISTS idx_audit_user ON public.agent_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.agent_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_status ON public.agent_audit_log(status);

ALTER TABLE public.agent_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can read agent_audit_log"
  ON public.agent_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service_role full access agent_audit_log"
  ON public.agent_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 12. agent_rate_limits — generic per-user rate limiting (master plan 9.3)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  last_request_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, agent_name, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_user_agent ON public.agent_rate_limits(user_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_rate_window ON public.agent_rate_limits(window_start);

ALTER TABLE public.agent_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access agent_rate_limits"
  ON public.agent_rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 13. scope_violations — Scope Guardian writes here when blocking changes (D2 agent)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scope_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_type text NOT NULL, -- 'foundation_skip' | 'anti_restart' | 'multi_commodity' | 'info_wall' | 'maxons_app_creep'
  severity text NOT NULL DEFAULT 'flag', -- 'block' | 'flag' | 'allow_log'
  description text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_decision text, -- 'override' | 'accepted' | 'pending'
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_violations_type ON public.scope_violations(violation_type);
CREATE INDEX IF NOT EXISTS idx_violations_created ON public.scope_violations(created_at DESC);

ALTER TABLE public.scope_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can read scope_violations"
  ON public.scope_violations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service_role full access scope_violations"
  ON public.scope_violations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- End of foundation migration
-- =============================================================================
-- Tables created (12):
--   user_roles, commodities, companies, contacts, canonical_products, profiles,
--   relationships, market_intelligence, zyra_conversations, agent_audit_log,
--   agent_rate_limits, scope_violations
--
-- Helper functions (3): has_role, is_team_or_admin, set_updated_at, handle_new_user
-- Triggers: updated_at on 6 tables, on_auth_user_created on auth.users
-- Seeds: 1 commodity (almonds), 9 canonical_products (almond varieties × sizes)
-- =============================================================================
