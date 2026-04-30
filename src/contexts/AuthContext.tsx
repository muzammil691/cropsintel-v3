// CropsIntel V3 — Auth context
//
// Provides current Supabase session + profile + role tier to the whole app.
// Phase 1.3 expands this to handle the 4-method login flows (per master plan).

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import type { AppRole, Profile, UserTier } from "@/lib/types"

export type AuthContextValue = {
  isLoading: boolean
  session: Session | null
  user: User | null
  profile: Profile | null
  roles: AppRole[]
  tier: UserTier
  isAuthenticated: boolean
  isTeam: boolean
  isAdmin: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const defaultContext: AuthContextValue = {
  isLoading: true,
  session: null,
  user: null,
  profile: null,
  roles: [],
  tier: "guest",
  isAuthenticated: false,
  isTeam: false,
  isAdmin: false,
  signOut: async () => {},
  refreshProfile: async () => {},
}

export const AuthContext = createContext<AuthContextValue>(defaultContext)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<AppRole[]>([])

  const loadProfileAndRoles = useCallback(async (userId: string) => {
    const [profileRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ])
    setProfile(profileRes.data ?? null)
    setRoles((rolesRes.data ?? []).map((r) => r.role as AppRole))
    setIsLoading(false)
  }, [])

  // Initial load + auth state changes
  useEffect(() => {
    let cancelled = false

    async function loadInitialSession() {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      setSession(data.session)
      if (data.session?.user) {
        await loadProfileAndRoles(data.session.user.id)
      } else {
        setIsLoading(false)
      }
    }

    loadInitialSession()

    const { data: subscription } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (cancelled) return
        setSession(newSession)
        if (newSession?.user) {
          await loadProfileAndRoles(newSession.user.id)
        } else {
          setProfile(null)
          setRoles([])
          setIsLoading(false)
        }
      },
    )

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [loadProfileAndRoles])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const refreshProfile = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession()
    if (s?.user) await loadProfileAndRoles(s.user.id)
  }, [loadProfileAndRoles])

  const user = session?.user ?? null
  const isAuthenticated = !!session
  const isAdmin = roles.includes("admin")
  const isTeam = isAdmin || roles.includes("team")
  const tier = profile?.tier ?? "guest"

  return (
    <AuthContext.Provider
      value={{
        isLoading,
        session,
        user,
        profile,
        roles,
        tier,
        isAuthenticated,
        isTeam,
        isAdmin,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
