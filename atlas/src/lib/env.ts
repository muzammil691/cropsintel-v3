const REQUIRED_ON_STARTUP = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']

export function validateEnv(): void {
  const missing: string[] = []
  for (const v of REQUIRED_ON_STARTUP) {
    if (!process.env[v]) missing.push(v)
  }
  if (missing.length > 0) {
    console.warn(`[atlas-env] WARN: missing env vars (Atlas will boot but degraded): ${missing.join(', ')}`)
  }

  const hasUrl = process.env.V3_SUPABASE_URL || process.env.SUPABASE_URL
  const hasKey = process.env.V3_SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!hasUrl || !hasKey) {
    console.warn('[atlas-env] WARN: no Supabase credentials — persistence disabled')
  }
}
