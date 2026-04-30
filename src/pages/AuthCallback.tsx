import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { LoadingScreen } from '@/components/auth/LoadingScreen'

export default function AuthCallback() {
  const navigate = useNavigate()
  useEffect(() => {
    // Supabase Auth handles the URL hash automatically via detectSessionInUrl
    // We just need to wait for it and redirect
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        navigate('/', { replace: true })
      }
    })
    // Safety: redirect after 5s if nothing happens
    const t = setTimeout(() => navigate('/login?error=oauth_timeout'), 5000)
    return () => { subscription.unsubscribe(); clearTimeout(t) }
  }, [navigate])
  return <LoadingScreen />
}
