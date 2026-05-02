import { useEffect } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { ShieldCheck, Smartphone, ArrowRight, Hammer } from 'lucide-react'
import { drAtlas } from '@/lib/drAtlas'

export default function Auth() {
  useEffect(() => {
    drAtlas.log('feature_mount', 'ui', 'auth')
  }, [])

  return (
    <>
      <Helmet>
        <title>Sign in — CropsIntel</title>
      </Helmet>
      <main className="min-h-screen bg-linear-to-b from-emerald-50/40 to-white dark:from-emerald-950/20 dark:to-slate-950 px-4 py-10 sm:py-16">
        <div className="mx-auto max-w-2xl space-y-8">
          <header className="text-center space-y-2">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Sign in to CropsIntel
            </h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300">
              Pick the entry point that matches your role.
            </p>
          </header>

          <section className="grid gap-4 sm:grid-cols-2">
            <Link
              to="/atlas/login"
              className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 hover:border-emerald-400 dark:hover:border-emerald-700 hover:shadow-md transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
            >
              <div className="flex items-start gap-3">
                <span className="grid place-items-center size-10 shrink-0 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                  <Hammer className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold flex items-center gap-1">
                    Atlas operator
                    <ArrowRight
                      className="size-4 opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all duration-200"
                      aria-hidden
                    />
                  </h2>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Run the build, review audits, manage projects.
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    WhatsApp OTP · 4-role RBAC
                  </p>
                </div>
              </div>
            </Link>

            <div
              aria-disabled="true"
              className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-5"
            >
              <div className="flex items-start gap-3">
                <span className="grid place-items-center size-10 shrink-0 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500">
                  <Smartphone className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-slate-700 dark:text-slate-200">
                    Customer (coming in 1.30)
                  </h2>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Email + password, email OTP, and WhatsApp sign-in for end customers.
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Includes V1/V2 user-migration bridge.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <footer className="text-center text-[11px] text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-4 inline-flex flex-col gap-1 w-full">
            <span className="inline-flex items-center justify-center gap-1.5">
              <ShieldCheck className="size-3" aria-hidden />
              All authentication routes via the platform. AI keys never leave the server.
            </span>
            <Link to="/" className="underline hover:no-underline transition-all duration-150">
              ← Back to home
            </Link>
          </footer>
        </div>
      </main>
    </>
  )
}
