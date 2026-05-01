import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getMyVerificationRequest } from '@/lib/verification'
import { VerificationRequestForm } from '@/components/upgrade/VerificationRequestForm'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { tierLabel } from '@/lib/tier-utils'

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'approved') return 'default'
  if (status === 'rejected') return 'destructive'
  return 'secondary'
}

export default function Upgrade() {
  const { tier, refreshProfile } = useAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [existingRequest, setExistingRequest] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'Request Verified Access — CropsIntel'
    getMyVerificationRequest().then((req) => {
      setExistingRequest(req)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (existingRequest?.status === 'approved') {
      refreshProfile()
    }
  }, [existingRequest, refreshProfile])

  if (loading) return null

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Request verified access</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            Verified members get full access to position reports, deal-tracking, and the Maxons CRM
            intelligence agent. Verification is reviewed manually by our team — usually within 48 hours.
          </p>
        </div>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Current tier</p>
              <p className="font-semibold">{tierLabel(tier)}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-500">Requesting</p>
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                Verified
              </Badge>
            </div>
          </div>
        </Card>

        {existingRequest ? (
          <Card className="p-6 space-y-3">
            <h2 className="font-semibold">Your request</h2>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>Status:</span>
              <Badge variant={statusVariant(existingRequest.status as string)}>
                {existingRequest.status as string}
              </Badge>
            </div>
            <p className="text-xs text-slate-500">
              Submitted {new Date(existingRequest.created_at as string).toLocaleString()}
            </p>
            {existingRequest.status === 'pending' && (
              <p className="text-sm text-slate-600">
                We're reviewing your request. We'll email you when there's an update.
              </p>
            )}
            {existingRequest.status === 'rejected' && existingRequest.reviewer_notes && (
              <p className="text-sm text-slate-700">
                <strong>Reviewer note:</strong> {existingRequest.reviewer_notes as string}
              </p>
            )}
          </Card>
        ) : (
          <VerificationRequestForm onSubmitted={() => window.location.reload()} />
        )}
      </div>
    </div>
  )
}
