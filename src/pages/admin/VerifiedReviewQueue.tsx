// Phase 1.3a — Maxons admin verified-review queue.
//
// Lists verification_requests with multi-reviewer assignment, structured
// background-check checklist, and final approve/reject actions. Gated to
// team-or-admin via the AdminLayout wrapper above; we add a defensive check
// inside the page too.

import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  BackgroundCheckChecklist,
  type ChecklistDraft,
} from '@/components/admin/BackgroundCheckChecklist'

type Row = {
  id: string
  user_id: string
  status: string
  company_name: string | null
  company_role: string | null
  company_website: string | null
  reason: string
  created_at: string
  assigned_to: string | null
  assigned_at: string | null
  business_registration_verified: boolean | null
  business_registration_notes: string | null
  business_registration_url: string | null
  linkedin_verified: boolean | null
  linkedin_notes: string | null
  linkedin_url: string | null
  website_verified: boolean | null
  website_notes: string | null
  website_url: string | null
  references_checked_count: number
  references_notes: string | null
  trade_history_reviewed: boolean | null
  trade_history_notes: string | null
  whatsapp_confirmation_done: boolean | null
  decided_at: string | null
  decided_by: string | null
  decided_to_state: string | null
  final_decision_notes: string | null
  // joined profile fields
  profile_full_name?: string | null
  profile_country?: string | null
  profile_business_type?: string | null
}

type Filter = 'mine' | 'unassigned' | 'all_open' | 'all_closed'

export default function VerifiedReviewQueue() {
  const { user, isTeam, isAdmin } = useAuth()
  const [filter, setFilter] = useState<Filter>('all_open')
  const [rows, setRows] = useState<Row[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const allowed = isTeam || isAdmin

  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const closed = filter === 'all_closed'
      const statusList = closed ? ['approved', 'rejected'] : ['pending', 'open', 'in_review']
      let q = supabase
        .from('verification_requests')
        .select('*')
        .in('status', statusList)
        .order('created_at', { ascending: false })
        .limit(200)

      if (filter === 'mine' && user) q = q.eq('assigned_to', user.id)
      if (filter === 'unassigned') q = q.is('assigned_to', null)

      const { data, error: qErr } = await q
      if (cancelled) return
      if (qErr) {
        setError(qErr.message)
        setRows([])
      } else {
        const ids = (data ?? []).map((r) => r.user_id)
        const profileMap = new Map<string, { full_name: string | null; country: string | null; business_type: string | null }>()
        if (ids.length > 0) {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, full_name, geography_country, business_type')
            .in('id', ids)
          for (const p of profs ?? []) {
            profileMap.set(p.id, {
              full_name: p.full_name,
              country: p.geography_country,
              business_type: p.business_type,
            })
          }
        }
        const enriched = (data ?? []).map((r) => ({
          ...(r as Row),
          profile_full_name: profileMap.get(r.user_id)?.full_name ?? null,
          profile_country: profileMap.get(r.user_id)?.country ?? null,
          profile_business_type: profileMap.get(r.user_id)?.business_type ?? null,
        }))
        setRows(enriched)
      }
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [filter, user, allowed])

  if (!allowed) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Team or admin role required.</AlertDescription>
      </Alert>
    )
  }

  return (
    <>
      <Helmet>
        <title>Verified review queue — CropsIntel admin</title>
      </Helmet>
      <div className="space-y-3 sm:space-y-4">
        <header className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold">Verified review queue</h1>
            <p className="text-xs sm:text-sm text-slate-500">
              Run background checks on registered users and promote them to verified.
            </p>
          </div>
          <FilterPills value={filter} onChange={setFilter} />
        </header>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-slate-500">No requests match this filter.</div>
        ) : (
          <ul className="space-y-2 sm:space-y-3">
            {rows.map((row) => (
              <li key={row.id}>
                <RequestCard
                  row={row}
                  expanded={expanded === row.id}
                  onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                  currentUserId={user?.id ?? null}
                  onChanged={async () => {
                    const { data } = await supabase
                      .from('verification_requests')
                      .select('*')
                      .eq('id', row.id)
                      .maybeSingle()
                    if (data) {
                      setRows((rs) =>
                        rs.map((r) =>
                          r.id === row.id
                            ? {
                                ...(data as Row),
                                profile_full_name: r.profile_full_name,
                                profile_country: r.profile_country,
                                profile_business_type: r.profile_business_type,
                              }
                            : r,
                        ),
                      )
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function FilterPills({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const options: Array<{ id: Filter; label: string }> = [
    { id: 'mine', label: 'My queue' },
    { id: 'unassigned', label: 'Unassigned' },
    { id: 'all_open', label: 'All open' },
    { id: 'all_closed', label: 'All closed' },
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            data-testid={`queue-filter-${o.id}`}
            className={
              'rounded-full px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium border transition-colors duration-200 min-h-[36px] sm:min-h-[40px] ' +
              (active
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800')
            }
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function RequestCard({
  row,
  expanded,
  onToggle,
  currentUserId,
  onChanged,
}: {
  row: Row
  expanded: boolean
  onToggle: () => void
  currentUserId: string | null
  onChanged: () => void
}) {
  const isClosed = row.status === 'approved' || row.status === 'rejected'
  const checklist = useMemo<ChecklistDraft>(
    () => ({
      business_registration_verified: row.business_registration_verified ?? undefined,
      business_registration_notes: row.business_registration_notes ?? undefined,
      business_registration_url: row.business_registration_url ?? undefined,
      linkedin_verified: row.linkedin_verified ?? undefined,
      linkedin_notes: row.linkedin_notes ?? undefined,
      linkedin_url: row.linkedin_url ?? undefined,
      website_verified: row.website_verified ?? undefined,
      website_notes: row.website_notes ?? undefined,
      website_url: row.website_url ?? undefined,
      references_checked_count: row.references_checked_count ?? 0,
      references_notes: row.references_notes ?? undefined,
      trade_history_reviewed: row.trade_history_reviewed ?? undefined,
      trade_history_notes: row.trade_history_notes ?? undefined,
      whatsapp_confirmation_done: row.whatsapp_confirmation_done ?? undefined,
    }),
    [row],
  )

  const [decisionNotes, setDecisionNotes] = useState(row.final_decision_notes ?? '')
  const [working, setWorking] = useState(false)

  async function assignToMe() {
    if (!currentUserId) return
    setWorking(true)
    await supabase
      .from('verification_requests')
      .update({
        assigned_to: currentUserId,
        assigned_at: new Date().toISOString(),
        status: 'in_review',
      })
      .eq('id', row.id)
    setWorking(false)
    onChanged()
  }

  async function approveAs(state: 'verified_buyer' | 'verified_broker' | 'verified_supplier') {
    if (!decisionNotes.trim()) {
      alert('Final decision notes are required')
      return
    }
    setWorking(true)
    await supabase
      .from('verification_requests')
      .update({
        status: 'approved',
        decided_at: new Date().toISOString(),
        decided_by: currentUserId,
        decided_to_state: state,
        final_decision_notes: decisionNotes,
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    setWorking(false)
    onChanged()
  }

  async function reject() {
    if (!decisionNotes.trim()) {
      alert('Final decision notes are required')
      return
    }
    setWorking(true)
    await supabase
      .from('verification_requests')
      .update({
        status: 'rejected',
        decided_at: new Date().toISOString(),
        decided_by: currentUserId,
        decided_to_state: 'rejected',
        final_decision_notes: decisionNotes,
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    setWorking(false)
    onChanged()
  }

  return (
    <Card data-testid={`request-card-${row.id}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 cursor-pointer" onClick={onToggle}>
        <div className="min-w-0 flex-1">
          <CardTitle className="text-base font-medium">
            {row.profile_full_name ?? row.company_name ?? 'Unnamed user'}
          </CardTitle>
          <p className="text-xs text-slate-500 mt-0.5">
            {row.company_name ?? '—'} · {row.profile_country ?? '—'} ·{' '}
            {row.profile_business_type ?? row.company_role ?? '—'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Requested {new Date(row.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Badge variant={isClosed ? 'secondary' : 'default'}>{row.status}</Badge>
          {row.assigned_to && (
            <Badge variant="outline" className="text-[10px]">
              {row.assigned_to === currentUserId ? 'Assigned to me' : 'Assigned'}
            </Badge>
          )}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3 sm:space-y-4 border-t border-slate-200 dark:border-slate-800 pt-4">
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300">
            <strong>Reason for verification:</strong> {row.reason}
          </p>

          {!row.assigned_to && !isClosed && (
            <Button
              size="sm"
              variant="outline"
              onClick={assignToMe}
              disabled={working}
              data-testid={`assign-to-me-${row.id}`}
              className="w-full sm:w-auto min-h-[44px] text-sm sm:text-base px-4 py-2 sm:px-6 sm:py-3 transition-colors duration-200"
            >
              Assign to me
            </Button>
          )}

          <BackgroundCheckChecklist
            requestId={row.id}
            initial={checklist}
            readOnly={isClosed}
            onSaved={onChanged}
          />

          {!isClosed && (
            <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-4">
              <label htmlFor={`decision-notes-${row.id}`} className="text-sm sm:text-base font-medium block">
                Final decision notes (required)
              </label>
              <Textarea
                id={`decision-notes-${row.id}`}
                value={decisionNotes}
                onChange={(e) => setDecisionNotes(e.target.value)}
                placeholder="Why are you approving / rejecting this request?"
                className="w-full text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={() => approveAs('verified_buyer')}
                  disabled={working}
                  data-testid={`approve-buyer-${row.id}`}
                  className="w-full sm:w-auto min-h-[44px] text-sm sm:text-base px-4 py-2 sm:px-6 sm:py-3 transition-colors duration-200"
                >
                  Approve as buyer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => approveAs('verified_broker')}
                  disabled={working}
                  className="w-full sm:w-auto min-h-[44px] text-sm sm:text-base px-4 py-2 sm:px-6 sm:py-3 transition-colors duration-200"
                >
                  Approve as broker
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => approveAs('verified_supplier')}
                  disabled={working}
                  className="w-full sm:w-auto min-h-[44px] text-sm sm:text-base px-4 py-2 sm:px-6 sm:py-3 transition-colors duration-200"
                >
                  Approve as supplier
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={reject}
                  disabled={working}
                  data-testid={`reject-${row.id}`}
                  className="w-full sm:w-auto min-h-[44px] text-sm sm:text-base px-4 py-2 sm:px-6 sm:py-3 transition-colors duration-200"
                >
                  Reject
                </Button>
              </div>
            </div>
          )}

          {isClosed && row.final_decision_notes && (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-xs sm:text-sm">
              <strong>Decision notes:</strong> {row.final_decision_notes}
              {row.decided_to_state && (
                <p className="mt-1 text-slate-500">Outcome: {row.decided_to_state}</p>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
