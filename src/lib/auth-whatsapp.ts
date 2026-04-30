import { supabase } from './supabase'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export async function sendWhatsAppOtp(phone: string): Promise<void> {
  const res = await fetch(`${FUNCTIONS_URL}/whatsapp-otp-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Failed to send OTP')
}

export interface VerifyWhatsAppOtpResult {
  userId: string
  email: string
  hashedToken?: string
  actionLink?: string
}

export async function verifyWhatsAppOtp(
  phone: string,
  code: string
): Promise<VerifyWhatsAppOtpResult> {
  const res = await fetch(`${FUNCTIONS_URL}/whatsapp-otp-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Verification failed')

  // Use the hashed_token to exchange for a real session via Supabase client
  if (data.hashed_token && data.email) {
    const { error } = await supabase.auth.verifyOtp({
      email: data.email,
      token: data.hashed_token,
      type: 'magiclink',
    })
    if (error) throw new Error(error.message)
  }

  return {
    userId: data.user_id,
    email: data.email,
    hashedToken: data.hashed_token,
    actionLink: data.action_link,
  }
}
