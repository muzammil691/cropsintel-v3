# Task: Phase 1.4d — User-side verification request flow

**Master plan reference:** §11.2 Phase 1.4 — completing the RBAC loop
**Context:** Registered users need a way to REQUEST verification. They submit a request → goes to admin queue → maxons reviews → tier updated. This task ships the user-facing form. The admin-side queue is Phase 1.11b (separate).
**Estimated effort:** ~20 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

A `/upgrade` page where any registered user can request verification. Form captures: company affiliation, role, why they need verified access. Stored in a `verification_requests` table for admin review.

## Files to create

```
supabase/migrations/<timestamp>_verification_requests.sql
src/pages/Upgrade.tsx                          # MODIFIED — replace placeholder
src/components/upgrade/VerificationRequestForm.tsx
src/lib/verification.ts
```

## Schema

```sql
CREATE TABLE public.verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','withdrawn')),
  company_name text,
  company_role text,
  company_website text,
  reason text NOT NULL,
  primary_models text[] DEFAULT '{}',  -- which trading models user runs
  evidence_urls text[] DEFAULT '{}',   -- LinkedIn, business reg etc.
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;

-- User reads own requests
CREATE POLICY "user reads own request"
  ON public.verification_requests FOR SELECT
  USING (auth.uid() = user_id);

-- User inserts own request
CREATE POLICY "user inserts own request"
  ON public.verification_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Maxons reads all
CREATE POLICY "maxons reads all requests"
  ON public.verification_requests FOR SELECT
  USING (current_user_tier() = 'maxons');

-- Maxons updates (review)
CREATE POLICY "maxons reviews requests"
  ON public.verification_requests FOR UPDATE
  USING (current_user_tier() = 'maxons')
  WITH CHECK (current_user_tier() = 'maxons');

CREATE INDEX idx_verification_requests_pending ON public.verification_requests (created_at DESC) WHERE status = 'pending';

-- Trigger to update profiles.tier when request approved
CREATE OR REPLACE FUNCTION public.handle_verification_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    UPDATE public.profiles SET tier = 'verified' WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_verification_approval
  AFTER UPDATE ON public.verification_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_verification_approval();
```

## src/lib/verification.ts

```ts
import { supabase } from './supabase'

export interface VerificationRequest {
  id?: string
  company_name: string
  company_role: string
  company_website?: string
  reason: string
  primary_models: ('A' | 'B' | 'C')[]
  evidence_urls?: string[]
}

export async function submitVerificationRequest(req: VerificationRequest) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Must be signed in')

  const { data, error } = await supabase
    .from('verification_requests')
    .insert({
      user_id: user.id,
      company_name: req.company_name,
      company_role: req.company_role,
      company_website: req.company_website,
      reason: req.reason,
      primary_models: req.primary_models,
      evidence_urls: req.evidence_urls ?? [],
      status: 'pending',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getMyVerificationRequest() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('verification_requests')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data
}
```

## src/pages/Upgrade.tsx

```tsx
import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getMyVerificationRequest } from '@/lib/verification'
import { VerificationRequestForm } from '@/components/upgrade/VerificationRequestForm'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { tierLabel } from '@/lib/tier-utils'

export default function Upgrade() {
  const { tier, user, refreshProfile } = useAuth()
  const [existingRequest, setExistingRequest] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMyVerificationRequest().then((req) => {
      setExistingRequest(req)
      setLoading(false)
    })
  }, [])

  if (loading) return null

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Request verified access</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            Verified members get full access to position reports, deal-tracking, and the Maxons CRM intelligence agent.
            Verification is reviewed manually by our team — usually within 48 hours.
          </p>
        </div>

        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Current tier</p>
              <p className="font-semibold">{tierLabel(tier)}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Requesting</p>
              <Badge variant="default" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                Verified
              </Badge>
            </div>
          </div>
        </Card>

        {existingRequest ? (
          <Card className="p-6">
            <h2 className="font-semibold mb-2">Your request</h2>
            <p className="text-sm text-slate-600">
              Status: <Badge variant={existingRequest.status === 'approved' ? 'default' : 'secondary'}>
                {existingRequest.status}
              </Badge>
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Submitted {new Date(existingRequest.created_at).toLocaleString()}
            </p>
            {existingRequest.status === 'pending' && (
              <p className="text-sm text-slate-600 mt-4">
                We're reviewing your request. We'll email you when there's an update.
              </p>
            )}
            {existingRequest.status === 'rejected' && existingRequest.reviewer_notes && (
              <p className="text-sm text-slate-700 mt-4">
                <strong>Reviewer note:</strong> {existingRequest.reviewer_notes}
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
```

## VerificationRequestForm.tsx

Standard form with:
- Company name (required)
- Role (required, dropdown: trader, broker, importer, exporter, processor, analyst, other)
- Company website (optional)
- Reason — textarea (required, 100-1000 chars)
- Primary models — checkbox group (A/B/C, optional, multi-select)
- Evidence URLs — repeatable input (LinkedIn, etc., optional)

Use shadcn/ui Input, Textarea, Select, Checkbox, Button, Label.

On submit, call `submitVerificationRequest()`, show success state, call `onSubmitted()`.

## Acceptance criteria

After this task ships:

1. Migration applied — `verification_requests` table + trigger exists
2. `/upgrade` page renders with current tier display
3. If user has no existing request → show form
4. If user has existing pending request → show status with timestamp
5. If approved → tier auto-updates via trigger; user can refresh and see new tier
6. If rejected → show reviewer note (if provided)
7. RLS policies prevent users from reading other users' requests
8. `npm run build` succeeds

## Design (Designer audit)

- Form inside Card, p-6 spacing
- Submit button: primary variant, w-full or w-auto right-aligned
- Status badge: appropriate color (pending=secondary, approved=default emerald, rejected=destructive)
- Reason textarea: min-height 6 lines
- Primary models checkboxes in flex row with explanations underneath

## Out of scope

- Admin-side review queue UI (Phase 1.11b builds that)
- Email notifications on status change (Phase 2)
- Re-applying after rejection (allowed but no special UX yet)
- Withdrawing a pending request (allowed via direct DB delete only — UX in Phase 2)

## Notes

- The DB trigger `handle_verification_approval` automatically promotes tier when status flips to 'approved'
- This means admins ONLY have to update status — no need to remember to update profiles.tier separately
- Single source of truth for tier: profiles.tier (set by trigger or by admin manually)
- Verification is a one-way flow for v0.1 — once verified, doesn't auto-revert
