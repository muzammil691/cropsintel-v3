import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import type { UserTier } from '@/lib/types'

const TIER_LABELS: Record<UserTier, string> = {
  guest: 'Guest',
  registered: 'Registered',
  verified: 'Verified',
  maxons_team: 'Maxons Team',
}

const TIER_COLORS: Record<UserTier, string> = {
  guest: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
  registered: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400',
  verified: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300',
  maxons_team: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300',
}

export default function Upgrade() {
  const { tier } = useAuth()
  const currentTier: UserTier = tier ?? 'guest'

  useEffect(() => {
    document.title = 'Upgrade Access — CropsIntel'
  }, [])

  return (
    <AuthLayout
      title="Upgrade your access"
      subtitle="Verified access unlocks the full CropsIntel platform"
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">Your current access level</p>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${TIER_COLORS[currentTier]}`}
          >
            {TIER_LABELS[currentTier]}
          </span>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Verified access includes:
          </p>
          <ul className="space-y-2">
            {[
              'Real-time almond market pricing & benchmarks',
              'Shipment intelligence & ETA tracking',
              'Zyra — your AI market analyst',
              'Priority deal flow & supplier contacts',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
                <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <Button className="w-full h-11" type="button">
          Request verification
        </Button>

        <p className="text-sm text-center text-slate-500 dark:text-slate-400">
          Questions?{' '}
          <Link
            to="/about"
            className="text-emerald-700 dark:text-emerald-500 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 rounded-sm"
          >
            Contact us
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}
