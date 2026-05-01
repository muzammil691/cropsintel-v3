import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { submitVerificationRequest } from '@/lib/verification'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const ROLES = [
  { value: 'trader', label: 'Trader' },
  { value: 'broker', label: 'Broker' },
  { value: 'importer', label: 'Importer' },
  { value: 'exporter', label: 'Exporter' },
  { value: 'processor', label: 'Processor' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'other', label: 'Other' },
]

const MODELS = [
  { value: 'A', label: 'Model A', description: 'Direct supply/procurement' },
  { value: 'B', label: 'Model B', description: 'Brokerage & intermediary' },
  { value: 'C', label: 'Model C', description: 'Processing & value-add' },
] as const

const schema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  company_role: z.string().min(1, 'Role is required'),
  company_website: z.string().optional(),
  reason: z
    .string()
    .min(100, 'Please provide at least 100 characters')
    .max(1000, 'Maximum 1000 characters'),
  primary_models: z.array(z.enum(['A', 'B', 'C'])),
})

type FormValues = z.infer<typeof schema>

interface Props {
  onSubmitted: () => void
}

export function VerificationRequestForm({ onSubmitted }: Props) {
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([''])
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { primary_models: [] as ('A' | 'B' | 'C')[] },
  })

  const selectedModels = watch('primary_models') ?? []

  function toggleModel(model: 'A' | 'B' | 'C') {
    const next = selectedModels.includes(model)
      ? selectedModels.filter((m) => m !== model)
      : [...selectedModels, model]
    setValue('primary_models', next as ('A' | 'B' | 'C')[])
  }

  function addEvidenceUrl() {
    setEvidenceUrls((prev) => [...prev, ''])
  }

  function updateEvidenceUrl(index: number, value: string) {
    setEvidenceUrls((prev) => prev.map((u, i) => (i === index ? value : u)))
  }

  function removeEvidenceUrl(index: number) {
    setEvidenceUrls((prev) => prev.filter((_, i) => i !== index))
  }

  async function onSubmit(values: FormValues) {
    setSubmitError(null)
    try {
      const cleanUrls = evidenceUrls.filter((u) => u.trim() !== '')
      await submitVerificationRequest({
        ...values,
        evidence_urls: cleanUrls,
      })
      onSubmitted()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed. Please try again.')
    }
  }

  const reasonValue = watch('reason') ?? ''

  return (
    <Card className="p-6">
      <h2 className="font-semibold text-lg mb-6">Your details</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="company_name">Company name *</Label>
          <Input
            id="company_name"
            placeholder="Acme Nut Trading Co."
            aria-invalid={!!errors.company_name}
            {...register('company_name')}
          />
          {errors.company_name && (
            <p className="text-xs text-destructive">{errors.company_name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="company_role">Your role *</Label>
          <Select
            id="company_role"
            aria-invalid={!!errors.company_role}
            {...register('company_role')}
          >
            <option value="">Select role…</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          {errors.company_role && (
            <p className="text-xs text-destructive">{errors.company_role.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="company_website">Company website</Label>
          <Input
            id="company_website"
            type="url"
            placeholder="https://acmetrading.com"
            {...register('company_website')}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reason">
            Why do you need verified access? *
          </Label>
          <Textarea
            id="reason"
            rows={6}
            placeholder="Describe your business and how you plan to use CropsIntel (100–1000 characters)…"
            aria-invalid={!!errors.reason}
            {...register('reason')}
          />
          <div className="flex justify-between items-start">
            <div>
              {errors.reason && (
                <p className="text-xs text-destructive">{errors.reason.message}</p>
              )}
            </div>
            <p className="text-xs text-slate-400 shrink-0">
              {reasonValue.length}/1000
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Primary trading models (optional)</Label>
          <div className="flex flex-wrap gap-4">
            {MODELS.map((m) => (
              <label key={m.value} className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={selectedModels.includes(m.value)}
                  onChange={() => toggleModel(m.value)}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium">{m.label}</p>
                  <p className="text-xs text-slate-500">{m.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Evidence URLs (optional)</Label>
          <p className="text-xs text-slate-500">
            LinkedIn profile, company registration, or other verification links.
          </p>
          <div className="space-y-2">
            {evidenceUrls.map((url, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  type="url"
                  placeholder="https://linkedin.com/in/…"
                  value={url}
                  onChange={(e) => updateEvidenceUrl(i, e.target.value)}
                />
                {evidenceUrls.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeEvidenceUrl(i)}
                    className="shrink-0 text-xs text-slate-500 hover:text-destructive px-2"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addEvidenceUrl}
            className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            + Add another URL
          </button>
        </div>

        {submitError && (
          <p className="text-sm text-destructive">{submitError}</p>
        )}

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isSubmitting} className="min-w-32">
            {isSubmitting ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
