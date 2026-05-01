import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Lock } from 'lucide-react'
import { tierLabel } from '@/lib/tier-utils'
import type { UserTier } from '@/lib/types'

interface Props {
  requiredTier: UserTier
  feature?: string
}

export function UpgradePrompt({ requiredTier, feature }: Props) {
  return (
    <Card className="p-6 bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-slate-900 dark:to-slate-800 border-emerald-200/50">
      <div className="flex items-start gap-4">
        <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 p-2">
          <Lock className="h-5 w-5 text-emerald-700 dark:text-emerald-500" aria-hidden="true" />
        </div>
        <div className="flex-1 space-y-2">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50">
            {tierLabel(requiredTier)} access required
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {feature
              ? `${feature} is available to ${tierLabel(requiredTier)} members.`
              : `This feature is available to ${tierLabel(requiredTier)} members.`}
            {' '}
            {requiredTier === 'verified' &&
              'Verification is reviewed manually by our team — usually within 48 hours.'}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/upgrade">Request upgrade</Link>
          </Button>
        </div>
      </div>
    </Card>
  )
}
