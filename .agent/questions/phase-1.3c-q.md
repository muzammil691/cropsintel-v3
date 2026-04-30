# Question — phase-1.3c

**Blocking:** Google OAuth code is shipped but inert until credentials are configured.

**Context:**
The Google OAuth login flow has been implemented. The code calls `supabase.auth.signInWithOAuth({ provider: 'google' })` and handles the callback at `/auth/callback`. However, the Google provider in Supabase must be manually enabled with real credentials before it will work.

**Action required by user (not an agent task):**

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application type)
3. Add authorized JavaScript origins: `https://muzammil691.github.io`
4. Add authorized redirect URIs: `https://hzrnohsxigrqlmzegwlb.supabase.co/auth/v1/callback`
5. Copy the Client ID and Client Secret
6. Go to Supabase Dashboard → Authentication → Providers → Google
7. Toggle ON, paste Client ID + Client Secret, save

**No architectural decision needed — this is purely an external credentials setup step.**
