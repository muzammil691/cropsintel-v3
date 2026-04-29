import { Helmet } from "react-helmet-async"
import { Link } from "react-router-dom"

export default function NotImplemented({ phase, what }: { phase: string; what?: string }) {
  return (
    <>
      <Helmet><title>Coming soon — CropsIntel</title></Helmet>
      <main className="min-h-screen flex items-center justify-center px-6 py-12 text-center">
        <div className="max-w-md space-y-4">
          <h1 className="text-2xl font-semibold">Build pending</h1>
          <p className="text-muted-foreground">
            This page is scheduled for build in <code>{phase}</code>.
            {what && <> It will include: {what}</>}
          </p>
          <p className="text-xs text-muted-foreground border-t pt-3">
            CropsIntel V3 is built by an autonomous agent following the master plan.
            Production-house agents (Verifier, Memory, Council, Adela) ship first;
            this surface follows.
          </p>
          <Link to="/" className="text-sm underline">← Back to home</Link>
        </div>
      </main>
    </>
  )
}
