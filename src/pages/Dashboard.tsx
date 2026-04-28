// CropsIntel V3 — Dashboard — STUB for Phase 1.9
//
// Phase 1.9 in master plan: "Dashboard with Phase-1 widget set (~10 widgets,
// configuration-driven via V1's useWidgetConfig pattern)."
// This stub renders a placeholder + confirms auth context wiring works.

import { Helmet } from "react-helmet-async"
import { useAuth } from "@/hooks/useAuth"
import { Button } from "@/components/ui/button"

export default function Dashboard() {
  const { user, profile, tier, isTeam, isAdmin, signOut } = useAuth()

  return (
    <>
      <Helmet>
        <title>Dashboard — CropsIntel</title>
      </Helmet>

      <main className="min-h-screen p-6 max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </header>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border p-6 bg-card">
            <h2 className="text-sm text-muted-foreground mb-2">User</h2>
            <p className="text-lg font-medium">
              {profile?.display_name || profile?.full_name || user?.email}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{user?.email}</p>
          </div>

          <div className="rounded-lg border p-6 bg-card">
            <h2 className="text-sm text-muted-foreground mb-2">Tier</h2>
            <p className="text-lg font-medium capitalize">{tier.replace("_", " ")}</p>
          </div>

          <div className="rounded-lg border p-6 bg-card">
            <h2 className="text-sm text-muted-foreground mb-2">Roles</h2>
            <p className="text-lg font-medium">
              {isAdmin ? "Admin" : isTeam ? "Team" : "Authenticated user"}
            </p>
          </div>
        </section>

        <section className="mt-8 rounded-lg border p-6 bg-muted/30">
          <h2 className="text-lg font-semibold mb-2">Phase 1 dashboard placeholder</h2>
          <p className="text-sm text-muted-foreground">
            The real dashboard ships in Phase 1.9 of the master plan: ~10
            configuration-driven widgets covering position reports, supply/demand,
            destinations, pricing, forecasts, news, and Zyra prescriptions.
          </p>
        </section>
      </main>
    </>
  )
}
