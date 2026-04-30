export const AUTH_STORAGE_KEY = 'cropsintel-v3-auth'

export function clearAuthStorage(): void {
  try {
    // Remove the session token Supabase stores
    localStorage.removeItem(AUTH_STORAGE_KEY)
    // Also clear code verifier used in PKCE OAuth flows
    localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`)
  } catch {
    // localStorage unavailable (SSR / private browsing edge case)
  }
}

export function hasStoredSession(): boolean {
  try {
    return !!localStorage.getItem(AUTH_STORAGE_KEY)
  } catch {
    return false
  }
}
