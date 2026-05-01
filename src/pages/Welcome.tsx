import { useEffect } from "react"
import { Helmet } from "react-helmet-async"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { drAtlas } from "@/lib/drAtlas"

export default function Welcome() {
  useEffect(() => {
    drAtlas.log("feature_mount", "ui", "welcome")
  }, [])
  return (
    <>
      <Helmet>
        <title>CropsIntel — Almond Market Intelligence</title>
        <meta
          name="description"
          content="Almond market intelligence platform — pricing, position reports, and trade signals for traders, brokers, and suppliers across the global almond chain."
        />
      </Helmet>

      <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="mb-8 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          V3 Phase 1 — agent infrastructure deploying. Full product after Phase 1.30+ ships.
        </div>

        <h1 className="text-5xl font-semibold tracking-tight mb-4">CropsIntel</h1>
        <p className="text-xl text-muted-foreground max-w-2xl mb-8">
          Almond market intelligence for the global trade. Pricing, position reports,
          shipment signals, and AI-powered prescriptions — built on a decade of MAXONS
          trading expertise.
        </p>
        <div className="flex gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Sign in</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/auth?mode=register">Create account</Link>
          </Button>
        </div>

        <p className="mt-12 text-xs text-muted-foreground">
          V3 — Phase 1 scaffold. Production launch follows master plan section 11.2.
        </p>
      </main>
    </>
  )
}
