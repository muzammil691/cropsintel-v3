-- =============================================================================
-- Phase 1.3a — Auth foundation
-- =============================================================================
-- Master plan §11.2 Phase 1.3: 4 login methods + V1/V2 user bridge + 3-tier RBAC.
--
-- Anti-restart compliance: this migration EXTENDS existing tables in place
-- (profiles, verification_requests). It does NOT recreate them. The earlier
-- 20260501050000_verification_requests.sql already shipped a thin queue table;
-- this adds the structured background-check columns + multi-reviewer assignment
-- so the admin queue can run real background checks.
--
-- Foundation-first: profiles, user_roles, has_role(), is_team_or_admin() all
-- come from 20260428000001_v3_foundation.sql. Nothing new at the foundation
-- layer — this migration sits one level above.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend profiles — verification state + onboarding metadata
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_state text NOT NULL DEFAULT 'unverified'
    CHECK (verification_state IN (
      'unverified',
      'pending_review',
      'verified_buyer',
      'verified_broker',
      'verified_supplier'
    )),
  ADD COLUMN IF NOT EXISTS verification_state_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_assigned_to uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS geography_country text,
  ADD COLUMN IF NOT EXISTS geography_city text,
  ADD COLUMN IF NOT EXISTS business_type text,
  ADD COLUMN IF NOT EXISTS annual_volume text,
  ADD COLUMN IF NOT EXISTS referral_source text;

CREATE INDEX IF NOT EXISTS idx_profiles_verification_state
  ON public.profiles(verification_state)
  WHERE verification_state <> 'unverified';

-- -----------------------------------------------------------------------------
-- 2. Extend verification_requests — multi-reviewer queue + structured checks
-- The base table was created in 20260501050000_verification_requests.sql with
-- (user_id, status, company_name, ...). We add the structured background-check
-- fields and assignment columns here.
-- -----------------------------------------------------------------------------
ALTER TABLE public.verification_requests
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS business_registration_verified boolean,
  ADD COLUMN IF NOT EXISTS business_registration_notes text,
  ADD COLUMN IF NOT EXISTS business_registration_url text,
  ADD COLUMN IF NOT EXISTS linkedin_verified boolean,
  ADD COLUMN IF NOT EXISTS linkedin_notes text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS website_verified boolean,
  ADD COLUMN IF NOT EXISTS website_notes text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS references_checked_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS references_notes text,
  ADD COLUMN IF NOT EXISTS trade_history_reviewed boolean,
  ADD COLUMN IF NOT EXISTS trade_history_notes text,
  ADD COLUMN IF NOT EXISTS whatsapp_confirmation_done boolean,
  ADD COLUMN IF NOT EXISTS whatsapp_confirmation_date timestamptz,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS decided_to_state text
    CHECK (decided_to_state IN ('verified_buyer', 'verified_broker', 'verified_supplier', 'rejected')),
  ADD COLUMN IF NOT EXISTS final_decision_notes text;

-- New status value 'in_review' (existing CHECK only allows pending/approved/rejected/withdrawn)
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.verification_requests'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.verification_requests DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.verification_requests
  ADD CONSTRAINT verification_requests_status_check
  CHECK (status IN ('pending', 'open', 'in_review', 'approved', 'rejected', 'withdrawn'));

CREATE INDEX IF NOT EXISTS idx_verification_requests_status_created
  ON public.verification_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_verification_requests_assigned
  ON public.verification_requests(assigned_to)
  WHERE status IN ('pending', 'open', 'in_review');

-- Update the approval trigger to also propagate verification_state
CREATE OR REPLACE FUNCTION public.handle_verification_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    UPDATE public.profiles
    SET tier = 'verified',
        verification_state = COALESCE(NEW.decided_to_state, 'verified_buyer'),
        verification_state_changed_at = now()
    WHERE id = NEW.user_id;
  ELSIF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
    UPDATE public.profiles
    SET verification_state = 'unverified',
        verification_state_changed_at = now()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. guest_sessions — anonymous-tier conversation gating (Phase 1.3b uses this)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_fingerprint text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  deep_outputs_count int NOT NULL DEFAULT 0,
  basic_chat_count int NOT NULL DEFAULT 0,
  role_inferred text,
  geography_country_inferred text,
  conversation_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  converted_to_user uuid REFERENCES auth.users(id),
  converted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_recent
  ON public.guest_sessions(last_seen_at DESC)
  WHERE converted_to_user IS NULL;

CREATE INDEX IF NOT EXISTS idx_guest_sessions_fingerprint
  ON public.guest_sessions(client_fingerprint)
  WHERE client_fingerprint IS NOT NULL;

ALTER TABLE public.guest_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role only on guest_sessions"
  ON public.guest_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 4. auth_bridge_log — V1/V2 user-migration audit trail
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_bridge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  v1_match_email text,
  v1_match_phone text,
  v2_match_email text,
  v2_match_phone text,
  bridge_method text NOT NULL CHECK (
    bridge_method IN ('email_match', 'phone_match', 'whatsapp_match', 'manual')
  ),
  set_password_required boolean NOT NULL DEFAULT false,
  set_password_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_bridge_log_user
  ON public.auth_bridge_log(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_bridge_log_email
  ON public.auth_bridge_log(v1_match_email)
  WHERE v1_match_email IS NOT NULL;

ALTER TABLE public.auth_bridge_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team/admin read auth_bridge_log"
  ON public.auth_bridge_log FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "service_role full access auth_bridge_log"
  ON public.auth_bridge_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- End of Phase 1.3a auth foundation migration
-- =============================================================================
