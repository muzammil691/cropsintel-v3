// CropsIntel V3 — NotFound (404)

import { Helmet } from "react-helmet-async"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <>
      <Helmet>
        <title>Page not found — CropsIntel</title>
      </Helmet>

      <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 text-center">
        <h1 className="text-6xl font-semibold tracking-tight mb-4">404</h1>
        <p className="text-xl text-muted-foreground mb-8">
          Page not found.
        </p>
        <Button asChild>
          <Link to="/welcome">Back to welcome</Link>
        </Button>
      </main>
    </>
  )
}
