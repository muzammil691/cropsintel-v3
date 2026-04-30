-- Migration: whatsapp_otp_logs audit table for custom WhatsApp OTP flow
-- Phase 1.3d — WhatsApp OTP login

CREATE TABLE public.whatsapp_otp_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  attempts int DEFAULT 0,
  max_attempts int DEFAULT 5,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet
);

CREATE INDEX idx_whatsapp_otp_phone_pending
  ON whatsapp_otp_logs (phone, expires_at)
  WHERE used_at IS NULL;

ALTER TABLE whatsapp_otp_logs ENABLE ROW LEVEL SECURITY;
-- service_role only — no client-accessible policies
