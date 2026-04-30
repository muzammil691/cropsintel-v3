import type { Session, User } from '@supabase/supabase-js'

// Matches the DB enum public.user_tier
export type Tier = 'guest' | 'registered' | 'verified' | 'maxons_team'

export interface AuthUser extends User {
  tier?: Tier
  display_name?: string
  primary_models?: ('A' | 'B' | 'C')[]
  company_id?: string | null
  preferred_language?: string
}

export interface AuthState {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  error: string | null
  tier: Tier
}

export type LoginMethod = 'email' | 'google' | 'whatsapp_otp' | 'phone_otp'
