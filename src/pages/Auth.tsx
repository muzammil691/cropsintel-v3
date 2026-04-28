// CropsIntel V3 — Auth page — STUB for Phase 1.3
//
// Phase 1.3 in master plan: "Auth: 4 methods (V2 pattern), V1+V2 user migration bridge."
// Four login methods to wire here: WhatsApp+Pass, WhatsApp OTP, Email+Pass, Email OTP.
// This stub renders a placeholder; real implementation lands in Phase 1.3.

import { Helmet } from "react-helmet-async"
import { Link, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"

export default function Auth() {
  const [params] = useSearchParams()
  const isRegister = params.get("mode") === "register"
  const redirectTo = params.get("redirect") || "/dashboard"

  return (
    <>
      <Helmet>
        <title>{isRegister ? "Create account" : "Sign in"} — CropsIntel</title>
      </Helmet>

      <main className="min-h-screen flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-6">
          <header className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              {isRegister ? "Create account" : "Sign in"}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              CropsIntel V3 — auth page placeholder
            </p>
          </header>

          <div className="rounded-lg border p-6 space-y-4 bg-card">
            <p className="text-sm text-muted-foreground">
              Phase 1.3 will wire 4 login methods here:
            </p>
            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
              <li>Email + password</li>
              <li>Email OTP</li>
              <li>WhatsApp + password</li>
              <li>WhatsApp OTP</li>
            </ul>
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Will redirect to <code>{redirectTo}</code> on success.
            </p>
          </div>

          <div className="text-center text-sm">
            <Button asChild variant="link">
              <Link to="/welcome">← Back to welcome</Link>
            </Button>
          </div>
        </div>
      </main>
    </>
  )
}
