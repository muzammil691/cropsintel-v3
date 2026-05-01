import { useState, type FormEvent } from 'react'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AtlasRole } from '@/lib/atlas-client'

interface InviteFormProps {
  onSubmit: (params: { phone: string; role: 'admin' | 'operator' | 'viewer'; display_name: string }) => Promise<void>
  busy?: boolean
  error?: string | null
  info?: string | null
}

const ASSIGNABLE_ROLES: AtlasRole[] = ['admin', 'operator', 'viewer']

export function InviteForm({ onSubmit, busy, error, info }: InviteFormProps) {
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<'admin' | 'operator' | 'viewer'>('viewer')
  const [displayName, setDisplayName] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!phone.trim()) return
    await onSubmit({ phone: phone.trim(), role, display_name: displayName.trim() })
    setPhone('')
    setDisplayName('')
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 space-y-3"
    >
      <div className="flex items-center gap-2">
        <UserPlus className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
          Invite a collaborator
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-2">
        <div>
          <Label htmlFor="invite-phone" className="text-[11px]">Phone (E.164)</Label>
          <Input
            id="invite-phone"
            type="tel"
            placeholder="+971501234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            className="mt-1"
            required
          />
        </div>
        <div>
          <Label htmlFor="invite-name" className="text-[11px]">Display name</Label>
          <Input
            id="invite-name"
            type="text"
            placeholder="(optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={busy}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="invite-role" className="text-[11px]">Role</Label>
          <select
            id="invite-role"
            className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'operator' | 'viewer')}
            disabled={busy}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500">
          They'll get a WhatsApp with a 7-day link. They still need an OTP to sign in.
        </p>
        <Button type="submit" size="sm" disabled={busy || !phone.trim()}>
          {busy ? 'Sending…' : 'Send invite'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {info && !error && (
        <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
          {info}
        </p>
      )}
    </form>
  )
}
