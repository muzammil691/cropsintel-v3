// CropsIntel V3 — Auth context
//
// Provides current Supabase session + profile + role tier to the whole app.
// Phase 1.3 expands this to handle the 4-method login flows (per master plan).

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { checkLegacyMigration } from "@/lib/auth-migration"
import type { AppRole, Profile, UserTier } from "@/lib/types"

export type AuthContextValue = {
  isLoading: boolean
  session: Session | null
  user: User | null
  profile: Profile | null
  roles: AppRole[]
  tier: UserTier
  /** Phase 1.3a — verification state from profiles.verification_state */
  verificationState: string
  isAuthenticated: boolean
  isTeam: boolean
  isAdmin: boolean
  /** Non-null after a successful V1/V2 migration; cleared by clearMigrationNotice. */
  migrationNotice: string | null
  clearMigrationNotice: () => void
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  /** Phase 1.3a helpers */
  hasTier: (t: UserTier) => boolean
  hasRole: (r: AppRole) => boolean
  isTeamOrAdmin: () => boolean
}

const defaultContext: AuthContextValue = {
  isLoading: true,
  session: null,
  user: null,
  profile: null,
  roles: [],
  tier: "guest",
  verificationState: "unverified",
  isAuthenticated: false,
  isTeam: false,
  isAdmin: false,
  migrationNotice: null,
  clearMigrationNotice: () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
  hasTier: () => false,
  hasRole: () => false,
  isTeamOrAdmin: () => false,
}

export const AuthContext = createContext<AuthContextValue>(defaultContext)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<AppRole[]>([])
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null)

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
      async (event, newSession) => {
        if (cancelled) return
        setSession(newSession)
        if (newSession?.user) {
          await loadProfileAndRoles(newSession.user.id)
          // On fresh sign-in, check for a V1/V2 legacy record and migrate if found
          if (event === 'SIGNED_IN') {
            const { migrated, legacy_source } = await checkLegacyMigration()
            if (migrated) {
              // Reload profile so the migrated tier/display_name are reflected
              await loadProfileAndRoles(newSession.user.id)
              setMigrationNotice(
                `Welcome back! Your ${legacy_source?.toUpperCase() ?? 'legacy'} account was imported.`
              )
            }
          }
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

  const clearMigrationNotice = useCallback(() => setMigrationNotice(null), [])

  const user = session?.user ?? null
  const isAuthenticated = !!session
  const isAdmin = roles.includes("admin")
  const isTeam = isAdmin || roles.includes("team")
  const tier = profile?.tier ?? "guest"
  const verificationState =
    (profile as { verification_state?: string } | null)?.verification_state ?? "unverified"

  const TIER_RANK: Record<UserTier, number> = {
    guest: 0,
    registered: 1,
    verified: 2,
    maxons_team: 3,
  }
  const hasTier = (t: UserTier) => (TIER_RANK[tier] ?? 0) >= (TIER_RANK[t] ?? 0)
  const hasRole = (r: AppRole) => roles.includes(r)
  const isTeamOrAdmin = () => isTeam

  return (
    <AuthContext.Provider
      value={{
        isLoading,
        session,
        user,
        profile,
        roles,
        tier,
        verificationState,
        isAuthenticated,
        isTeam,
        isAdmin,
        migrationNotice,
        clearMigrationNotice,
        signOut,
        refreshProfile,
        hasTier,
        hasRole,
        isTeamOrAdmin,
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
