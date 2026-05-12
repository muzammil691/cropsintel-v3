// 1.10bb-c Session 9A — Account page (placeholder shell).
//
// 9B fleshes this out: display name, WhatsApp number editor, theme toggle,
// active-sessions list (read from atlas_sessions), and a "Sign out everywhere"
// button. For now we surface the current WhatsApp number from atlas_user_state
// so the page isn't completely empty.

import { useEffect, useState } from 'react'
import { User2 } from 'lucide-react'
import { getUserState, type AtlasUserState } from '@/lib/atlas-client'

export function AccountPage() {
  const [state, setState] = useState<AtlasUserState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getUserState()
      .then(setState)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <div className="px-3 sm:px-5 py-4 max-w-3xl mx-auto w-full space-y-4">
      <header>
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <User2 className="size-4 text-emerald-600" aria-hidden /> Account
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
          Full account controls (display name, theme, active sessions, sign-out-everywhere) land in Session 9B.
        </p>
      </header>

      {error && (
        <p role="alert" className="text-xs text-rose-700 dark:text-rose-400">{error}</p>
      )}

      <dl className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 divide-y divide-slate-200 dark:divide-slate-800">
        <Row label="WhatsApp number" value={state?.whatsapp_number ?? '(loading…)'} />
        <Row label="Onboarding complete" value={state?.onboarding_complete ? 'yes' : 'no'} />
        <Row label="Last updated" value={state?.updated_at ? new Date(state.updated_at).toLocaleString() : '—'} />
      </dl>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-2 px-3 py-2 text-xs">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="col-span-2 text-slate-700 dark:text-slate-200 font-mono">{value}</dd>
    </div>
  )
}

export default AccountPage
