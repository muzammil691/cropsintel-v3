// check-legacy-user — Phase 1.3f migration bridge
//
// Called by the frontend on every SIGNED_IN event. Checks if the authenticated
// user matches a V1/V2 record in legacy_users and, if so, copies their profile
// fields into V3. Idempotent: repeated calls after migration are instant no-ops.
//
// Auth model: accepts the user's own JWT — extracts identity server-side.
// All DB writes use service_role to bypass RLS.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Resolve caller identity from JWT
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Idempotency check: if already migrated, skip
  const { data: alreadyMigrated } = await supabase
    .from('legacy_users')
    .select('id')
    .eq('migrated_to_v3_user_id', user.id)
    .maybeSingle()

  if (alreadyMigrated) {
    return new Response(
      JSON.stringify({ migrated: false, reason: 'already_migrated' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // Look up matching legacy record by email (priority) or phone
  let legacy: Record<string, unknown> | null = null

  if (user.email) {
    const { data } = await supabase
      .from('legacy_users')
      .select('*')
      .is('migrated_to_v3_user_id', null)
      .eq('email', user.email)
      .maybeSingle()
    legacy = data
  } else if (user.phone) {
    const { data } = await supabase
      .from('legacy_users')
      .select('*')
      .is('migrated_to_v3_user_id', null)
      .eq('phone', user.phone)
      .maybeSingle()
    legacy = data
  }

  if (!legacy) {
    // No V1/V2 record — profile was already created by the DB trigger on sign-up.
    return new Response(
      JSON.stringify({ migrated: false, reason: 'no_legacy_record' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // Migrate: update the profile the DB trigger already created with richer legacy fields.
  // company_id intentionally skipped — V1/V2 company IDs are not V3 UUIDs.
  // Phase 2 adds a company-matching step once the V3 CRM is populated.
  await supabase
    .from('profiles')
    .update({
      tier: (legacy.tier as string) || 'registered',
      display_name: (legacy.display_name as string) || null,
      preferred_language: (legacy.preferred_language as string) || 'en',
    })
    .eq('id', user.id)

  // Mark the legacy record so future calls skip immediately
  await supabase
    .from('legacy_users')
    .update({
      migrated_to_v3_user_id: user.id,
      migrated_at: new Date().toISOString(),
    })
    .eq('id', legacy.id as string)

  return new Response(
    JSON.stringify({
      migrated: true,
      legacy_source: legacy.source,
      legacy_user_id: legacy.legacy_user_id,
      profile_imported: {
        tier: legacy.tier,
        display_name: legacy.display_name,
      },
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
