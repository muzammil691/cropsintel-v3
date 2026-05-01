-- Phase 1.4d: verification_requests table + approval trigger

CREATE TABLE public.verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','withdrawn')),
  company_name text,
  company_role text,
  company_website text,
  reason text NOT NULL,
  primary_models text[] DEFAULT '{}',
  evidence_urls text[] DEFAULT '{}',
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user reads own request"
  ON public.verification_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user inserts own request"
  ON public.verification_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "maxons reads all requests"
  ON public.verification_requests FOR SELECT
  USING (current_user_tier() = 'maxons');

CREATE POLICY "maxons reviews requests"
  ON public.verification_requests FOR UPDATE
  USING (current_user_tier() = 'maxons')
  WITH CHECK (current_user_tier() = 'maxons');

CREATE INDEX idx_verification_requests_pending
  ON public.verification_requests (created_at DESC)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.handle_verification_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    UPDATE public.profiles SET tier = 'verified' WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_verification_approval
  AFTER UPDATE ON public.verification_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_verification_approval();
