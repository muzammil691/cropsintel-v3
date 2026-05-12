// 1.10bb-c Session 9B — AddConnectionSheet.
//
// Slide-in panel from the right with two inner steps:
//   1. Catalog — provider cards grouped Required-for-Stack-Gate / Optional
//   2. Form — provider-specific fields, Test → Save
//
// Pre-scope: the OnboardingWizard passes `initialProvider` to skip step 1
// and open the form directly on that provider. ConnectionsPage opens with
// no initialProvider so the user lands on the catalog.
//
// Save is gated on a successful Test by default. The "Save anyway"
// override link is for offline-debug / restricted-network environments —
// it still POSTs to /atlas/connections with the secret but Test never ran.

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  X,
  Brain,
  GitBranch,
  Database,
  MessageSquare,
  Sparkles,
  Eye,
  EyeOff,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  TriangleAlert,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  createConnection,
  testConnectionDryRun,
  type ConnectionProvider,
  type DryRunTestResult,
} from '@/lib/atlas-client'

// ─── Provider catalog ───────────────────────────────────────────────────

interface FieldDef {
  name: string
  label: string
  placeholder?: string
  secret?: boolean
  optional?: boolean
  type?: 'text' | 'json'
  /** If this field's value is the credential's primary secret. Exactly one
   *  per provider — the one whose value goes into vaultEncrypt. The rest
   *  become meta_json on the row. */
  primary?: boolean
}

interface ProviderForm {
  provider: ConnectionProvider
  display: string
  tagline: string
  Icon: typeof Brain
  helpText: string
  helpUrl?: string
  fields: FieldDef[]
  /** Hint shown under the test result on 401/403. Provider-specific. */
  curatedHint?: Record<number, string>
}

const FORMS: ProviderForm[] = [
  {
    provider: 'anthropic',
    display: 'Anthropic',
    tagline: 'Claude Builder LLM',
    Icon: Brain,
    helpText: 'Create at console.anthropic.com/settings/keys',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    fields: [
      { name: 'label', label: 'Label', placeholder: 'e.g. "Production" or "Personal"' },
      { name: 'api_key', label: 'API Key', placeholder: 'sk-ant-api03-...', secret: true, primary: true },
    ],
    curatedHint: { 401: 'Key rejected — generate a new one at console.anthropic.com.' },
  },
  {
    provider: 'openai',
    display: 'OpenAI',
    tagline: 'Verifier (FRONTEND lens) + Builder fallback',
    Icon: Brain,
    helpText: 'Create at platform.openai.com/api-keys',
    helpUrl: 'https://platform.openai.com/api-keys',
    fields: [
      { name: 'label', label: 'Label', placeholder: 'e.g. "Production"' },
      { name: 'api_key', label: 'API Key', placeholder: 'sk-...', secret: true, primary: true },
    ],
    curatedHint: { 401: 'Invalid key — issue a new one at platform.openai.com/api-keys.' },
  },
  {
    provider: 'gemini',
    display: 'Gemini',
    tagline: 'Verifier (RESEARCH lens)',
    Icon: Brain,
    helpText: 'Create at aistudio.google.com/app/apikey',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    fields: [
      { name: 'label', label: 'Label', placeholder: 'e.g. "Default"' },
      { name: 'api_key', label: 'API Key', placeholder: 'AIza...', secret: true, primary: true },
    ],
    curatedHint: { 403: 'Key rejected — re-issue at aistudio.google.com/app/apikey.' },
  },
  {
    provider: 'github',
    display: 'GitHub',
    tagline: 'Code repo + Pages hosting',
    Icon: GitBranch,
    helpText: 'Create fine-grained PAT — scopes: repo, workflow, contents, pull_requests',
    helpUrl: 'https://github.com/settings/personal-access-tokens/new',
    fields: [
      { name: 'label', label: 'Label', placeholder: 'e.g. "muzammil691"' },
      { name: 'pat', label: 'Personal Access Token', placeholder: 'github_pat_...', secret: true, primary: true },
    ],
    curatedHint: { 401: 'PAT invalid or revoked. Re-issue at github.com/settings/tokens.' },
  },
  {
    provider: 'supabase',
    display: 'Supabase',
    tagline: 'Database + Storage',
    Icon: Database,
    helpText: 'Create at supabase.com/dashboard/account/tokens',
    helpUrl: 'https://supabase.com/dashboard/account/tokens',
    fields: [
      { name: 'label', label: 'Label', placeholder: 'e.g. "Production"' },
      { name: 'management_api_key', label: 'Management API Key', placeholder: 'sbp_...', secret: true, primary: true },
      { name: 'project_ref', label: 'Project ref (optional)', placeholder: 'hzrnohsxigrqlmzegwlb — narrows scope', optional: true },
    ],
    curatedHint: { 401: 'Token rejected or scoped to a different org.' },
  },
  {
    provider: 'twilio',
    display: 'Twilio',
    tagline: 'WhatsApp OTP + dispatch',
    Icon: MessageSquare,
    helpText: 'Find at console.twilio.com',
    helpUrl: 'https://console.twilio.com',
    fields: [
      { name: 'label', label: 'Label', placeholder: 'e.g. "Production"' },
      { name: 'account_sid', label: 'Account SID', placeholder: 'AC...' },
      { name: 'auth_token', label: 'Auth Token', placeholder: '(32-char hex)', secret: true, primary: true },
      { name: 'whatsapp_from', label: 'WhatsApp From (optional)', placeholder: '+14155238886', optional: true },
    ],
    curatedHint: { 401: 'SID + auth_token mismatch.' },
  },
  {
    provider: 'custom',
    display: 'Custom',
    tagline: 'Bring your own kv-pairs',
    Icon: Sparkles,
    helpText: 'Free-form encrypted bag. Use for unforeseen integrations.',
    fields: [
      { name: 'label', label: 'Label', placeholder: 'e.g. "GoogleDriveOAuthLater"' },
      { name: 'kv_pairs', label: 'Key/value pairs (JSON)', placeholder: '{\n  "API_KEY": "abc123",\n  "BASE_URL": "https://example.com/api"\n}', secret: true, primary: true, type: 'json' },
    ],
  },
]

const REQUIRED_PROVIDERS: ConnectionProvider[] = ['anthropic', 'openai', 'gemini', 'github', 'supabase']

function formFor(provider: ConnectionProvider): ProviderForm | undefined {
  return FORMS.find((f) => f.provider === provider)
}

// ─── Sheet shell ────────────────────────────────────────────────────────

interface AddConnectionSheetProps {
  open: boolean
  onClose: () => void
  /** Skip the catalog and open directly on this provider's form. */
  initialProvider?: ConnectionProvider
  /** Called after a successful Save so the parent can refetch. */
  onSaved?: (provider: ConnectionProvider) => void
}

export function AddConnectionSheet({ open, onClose, initialProvider, onSaved }: AddConnectionSheetProps) {
  const [selected, setSelected] = useState<ConnectionProvider | null>(initialProvider ?? null)

  // Reset selection whenever the sheet reopens with a different initialProvider.
  useEffect(() => {
    if (open) setSelected(initialProvider ?? null)
  }, [open, initialProvider])

  // ESC to close.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add connection"
      className="fixed inset-0 z-40 flex"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />
      <aside
        className="relative ml-auto h-full w-full bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
        style={{ maxWidth: '520px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {selected ? `Add ${formFor(selected)?.display ?? selected}` : 'Add connection'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close connection sheet"
            className="rounded p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 transition-colors duration-200"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <ProviderFormView
              form={formFor(selected)!}
              onBack={() => setSelected(null)}
              onSaved={() => {
                onSaved?.(selected)
                onClose()
              }}
              hideBack={Boolean(initialProvider)}
            />
          ) : (
            <CatalogView onPick={setSelected} />
          )}
        </div>
      </aside>
    </div>
  )
}

// ─── STEP 1: catalog ────────────────────────────────────────────────────

function CatalogView({ onPick }: { onPick: (p: ConnectionProvider) => void }) {
  const required = FORMS.filter((f) => REQUIRED_PROVIDERS.includes(f.provider))
  const optional = FORMS.filter((f) => !REQUIRED_PROVIDERS.includes(f.provider))
  return (
    <div className="p-4 space-y-5">
      <section>
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
          Required for Stack Gate
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {required.map((f) => (
            <CatalogCard key={f.provider} form={f} onPick={() => onPick(f.provider)} />
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
          Optional
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {optional.map((f) => (
            <CatalogCard key={f.provider} form={f} onPick={() => onPick(f.provider)} />
          ))}
        </div>
      </section>
    </div>
  )
}

function CatalogCard({ form, onPick }: { form: ProviderForm; onPick: () => void }) {
  const Icon = form.Icon
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Connect ${form.display}`}
      className="text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2.5 hover:border-emerald-300 dark:hover:border-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 transition-colors duration-200"
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="size-4 text-slate-700 dark:text-slate-300" aria-hidden />
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{form.display}</span>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{form.tagline}</p>
    </button>
  )
}

// ─── STEP 2: form ───────────────────────────────────────────────────────

interface ProviderFormViewProps {
  form: ProviderForm
  onBack: () => void
  onSaved: () => void
  hideBack: boolean
}

function ProviderFormView({ form, onBack, onSaved, hideBack }: ProviderFormViewProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of form.fields) init[f.name] = ''
    return init
  })
  const [secretsVisible, setSecretsVisible] = useState<Record<string, boolean>>({})
  const [testResult, setTestResult] = useState<DryRunTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [overrideEnabled, setOverrideEnabled] = useState(false)
  const firstInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { firstInputRef.current?.focus() }, [])

  // Form valid when label is non-empty AND every non-optional field is filled.
  const filled = useMemo(() => {
    return form.fields.every((f) => {
      if (f.optional) return true
      return values[f.name]?.trim().length > 0
    })
  }, [form.fields, values])

  // The primary field is the one whose value goes to vaultEncrypt.
  // Everything else gets bundled into meta_json.
  const primaryField = form.fields.find((f) => f.primary)
  const labelValue = values['label'] ?? ''

  function buildPayload(): { provider: ConnectionProvider; label: string; secret: string; meta_json: Record<string, unknown> } | null {
    if (!primaryField) return null
    const rawSecret = values[primaryField.name] ?? ''
    if (primaryField.type === 'json') {
      try {
        JSON.parse(rawSecret) // validation only
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : 'Invalid JSON')
        return null
      }
    }
    const meta: Record<string, unknown> = {}
    for (const f of form.fields) {
      if (f.name === 'label' || f.primary) continue
      const v = values[f.name]?.trim()
      if (v) meta[f.name] = v
    }
    return {
      provider: form.provider,
      label: labelValue.trim(),
      secret: rawSecret,
      meta_json: meta,
    }
  }

  async function handleTest() {
    const payload = buildPayload()
    if (!payload) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testConnectionDryRun({
        provider: payload.provider,
        secret: payload.secret,
        meta_json: payload.meta_json,
      })
      setTestResult(result)
      if (result.ok) {
        toast.success(`${form.display} verified${result.identity ? ` — ${result.identity}` : ''}`, { duration: 4000 })
      }
    } catch (err) {
      setTestResult({
        ok: false,
        dry_run: true,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    const payload = buildPayload()
    if (!payload) return
    setSaving(true)
    try {
      await createConnection({
        provider: payload.provider,
        label: payload.label,
        secret: payload.secret,
        meta_json: payload.meta_json,
      })
      toast.success(`${form.display} connection added`, { duration: 4000 })
      onSaved()
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`, { duration: 6000 })
    } finally {
      setSaving(false)
    }
  }

  const saveEnabled = filled && !saving && (testResult?.ok === true || overrideEnabled)

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        {!hideBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to provider catalog"
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 rounded"
          >
            <ArrowLeft className="size-3" aria-hidden /> Back to catalog
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          <form.Icon className="size-3" aria-hidden />
          {form.display}
        </span>
      </div>

      {form.helpText && (
        <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200">
          {form.helpText}
          {form.helpUrl && (
            <>
              {' '}
              <a
                href={form.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 underline hover:text-amber-700 dark:hover:text-amber-100 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 rounded"
              >
                Open <ExternalLink className="size-2.5" aria-hidden />
              </a>
            </>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        {form.fields.map((field, idx) => {
          const isSecret = field.secret === true
          const isJson = field.type === 'json'
          const value = values[field.name] ?? ''
          const visible = secretsVisible[field.name] === true
          return (
            <div key={field.name} className="space-y-1">
              <label htmlFor={`field-${field.name}`} className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-baseline gap-1">
                {field.label}
                {!field.optional && <span className="text-rose-600">*</span>}
              </label>
              <div className="relative">
                {isJson ? (
                  <textarea
                    id={`field-${field.name}`}
                    rows={6}
                    value={value}
                    onChange={(e) => { setValues((v) => ({ ...v, [field.name]: e.target.value })); setJsonError(null) }}
                    onBlur={() => {
                      if (value.trim().length === 0) return
                      try { JSON.parse(value); setJsonError(null) }
                      catch (err) { setJsonError(err instanceof Error ? err.message : 'Invalid JSON') }
                    }}
                    placeholder={field.placeholder}
                    className="w-full text-[11px] font-mono px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
                  />
                ) : (
                  <input
                    ref={idx === 0 ? firstInputRef : undefined}
                    id={`field-${field.name}`}
                    type={isSecret && !visible ? 'password' : 'text'}
                    value={value}
                    onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                    placeholder={field.placeholder}
                    autoComplete={isSecret ? 'new-password' : 'off'}
                    className={cn(
                      'w-full text-xs px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-500/40',
                      isSecret ? 'font-mono pr-9' : '',
                    )}
                  />
                )}
                {isSecret && !isJson && (
                  <button
                    type="button"
                    onClick={() => setSecretsVisible((v) => ({ ...v, [field.name]: !visible }))}
                    aria-label={visible ? 'Hide secret value' : 'Show secret value'}
                    className="absolute right-1.5 top-1.5 rounded p-0.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 transition-colors duration-200"
                  >
                    {visible ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {jsonError && (
          <p role="alert" className="text-[11px] text-rose-700 dark:text-rose-400">
            JSON invalid: {jsonError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleTest}
          disabled={!filled || testing}
          className="text-xs h-8"
        >
          {testing ? <><Loader2 className="size-3 mr-1 animate-spin" aria-hidden /> Testing…</> : 'Test connection'}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={!saveEnabled}
          className="text-xs h-8 bg-emerald-700 hover:bg-emerald-800 text-white transition-colors duration-200"
          title={!saveEnabled && !overrideEnabled ? 'Test connection first.' : undefined}
        >
          {saving ? <><Loader2 className="size-3 mr-1 animate-spin" aria-hidden /> Saving…</> : 'Save'}
        </Button>
        {!overrideEnabled && testResult?.ok !== true && (
          <button
            type="button"
            onClick={() => {
              setOverrideEnabled(true)
              toast.warning('Save-without-test enabled. The connection will be persisted but its status will read "unknown" until you test it.', { duration: 5000 })
            }}
            className="ml-auto text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 underline transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 rounded"
          >
            Save anyway without test (advanced)
          </button>
        )}
      </div>

      {testResult && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'rounded-md border px-3 py-2 text-xs',
            testResult.ok
              ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100'
              : 'border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30 text-rose-900 dark:text-rose-100',
          )}
        >
          {testResult.ok ? (
            <div className="flex items-start gap-1.5">
              <CheckCircle2 className="size-3.5 shrink-0 mt-0.5 text-emerald-700 dark:text-emerald-400" aria-hidden />
              <div>
                <p className="font-medium">Connected{testResult.identity ? ` as ${testResult.identity}` : ''}</p>
                {testResult.scopes && testResult.scopes.length > 0 && (
                  <p className="text-[10px] mt-0.5">Scopes: <code className="font-mono">{testResult.scopes.join(', ')}</code></p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-1.5">
              <TriangleAlert className="size-3.5 shrink-0 mt-0.5 text-rose-700 dark:text-rose-400" aria-hidden />
              <div className="space-y-0.5">
                <p className="font-medium">Test failed{testResult.status ? ` (${testResult.status})` : ''}</p>
                <p className="font-mono text-[11px] break-all">{testResult.error ?? 'unknown error'}</p>
                {testResult.status && form.curatedHint?.[testResult.status] && (
                  <p className="text-[11px] italic mt-1">{form.curatedHint[testResult.status]}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AddConnectionSheet
