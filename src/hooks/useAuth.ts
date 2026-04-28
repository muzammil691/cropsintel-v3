// CropsIntel V3 — useAuth hook
// Returns the auth context. Throws if used outside <AuthProvider>.

import { useContext } from "react"
import { AuthContext } from "@/contexts/AuthContext"

export function useAuth() {
  return useContext(AuthContext)
}
