import { supabase } from './supabase'

export interface VerificationRequest {
  id?: string
  company_name: string
  company_role: string
  company_website?: string
  reason: string
  primary_models: ('A' | 'B' | 'C')[]
  evidence_urls?: string[]
}

export async function submitVerificationRequest(req: VerificationRequest) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Must be signed in')

  const { data, error } = await supabase
    .from('verification_requests')
    .insert({
      user_id: user.id,
      company_name: req.company_name,
      company_role: req.company_role,
      company_website: req.company_website,
      reason: req.reason,
      primary_models: req.primary_models,
      evidence_urls: req.evidence_urls ?? [],
      status: 'pending',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getMyVerificationRequest() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('verification_requests')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data
}
