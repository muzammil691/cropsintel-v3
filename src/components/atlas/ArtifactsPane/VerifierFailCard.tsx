import { useState } from 'react'
import { ShieldAlert, ChevronDown, ChevronRight, X, Stethoscope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { diagnoseArtifact, type DiagnosisBucket } from '@/lib/atlas-client'
import { DiagnosisResult } from '../DiagnosisResult'

export interface VerifierGap {
  check?: string
  expected?: string
  actual?: string
  severity?: 'high' | 'medium' | 'low' | string
  description?: string
}

export interface VerifierRun {
  id: string
  task_id: string
  task_spec_path: string
  commit_sha: string
  mode: 'audit-only' | 'gate' | string
  passed: boolean
  gaps: VerifierGap[]
  remediation_task_id: string | null
  duration_ms: number | null
  ran_at: string
}

interface VerifierFailCardProps {
  run: VerifierRun
  onDismiss?: (id: string) => void
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function severityClass(severity?: VerifierGap['severity']): string {
  if (severity === 'high') return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900'
  if (severity === 'medium') return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900'
  return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
}

export function VerifierFailCard({ run, onDismiss }: VerifierFailCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnosis, setDiagnosis] = useState<DiagnosisBucket | null>(null)
  const [diagError, setDiagError] = useState<string | null>(null)
  const gaps = run.gaps ?? []

  async function handleDiagnose() {
    setDiagnosing(true)
    setDiagError(null)
    try {
      const result = await diagnoseArtifact({
        kind: 'verifier_run',
        ref: run.id,
        payload: {
          task_id: run.task_id,
          commit_sha: run.commit_sha,
          mode: run.mode,
          passed: run.passed,
          gaps,
        },
      })
      setDiagnosis(result)
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : String(err))
    } finally {
      setDiagnosing(false)
    }
  }

  return (
    <article className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20 p-3 shadow-sm hover:shadow-md transition-shadow duration-150">
      <header className="flex items-start gap-2 mb-2">
        <span className="grid place-items-center size-7 rounded-md bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 shrink-0">
          <ShieldAlert className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-red-800 dark:text-red-300">
              Verifier · failed
            </span>
            <span className="text-[10px] text-slate-500 tabular-nums">{relativeTime(run.ran_at)}</span>
          </div>
          <p className="font-mono text-xs font-medium truncate">{run.task_id}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {run.mode} · {gaps.length} gap{gaps.length === 1 ? '' : 's'} · {run.commit_sha.slice(0, 8)}
          </p>
        </div>
      </header>

      {gaps.length > 0 && (
        <div className="mb-2">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors duration-150"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {expanded ? 'Hide gaps' : 'Show gaps'}
          </button>

          {expanded && (
            <ul className="mt-2 space-y-1.5">
              {gaps.map((gap, i) => (
                <li
                  key={i}
                  className={`rounded-md border px-2.5 py-1.5 text-xs ${severityClass(gap.severity)}`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] uppercase font-semibold tracking-wider">
                      {gap.severity ?? 'info'}
                    </span>
                    {gap.check && (
                      <span className="text-[10px] font-mono opacity-70">{gap.check}</span>
                    )}
                  </div>
                  {gap.description && <p className="mt-0.5">{gap.description}</p>}
                  {gap.expected && (
                    <p className="mt-1 text-[11px] opacity-80">
                      <span className="font-semibold">Expected:</span> {gap.expected}
                    </p>
                  )}
                  {gap.actual && (
                    <p className="mt-0.5 text-[11px] opacity-80 font-mono">
                      <span className="font-semibold">Actual:</span> {gap.actual.slice(0, 200)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs px-2.5"
          onClick={() => void handleDiagnose()}
          disabled={diagnosing}
        >
          <Stethoscope className="size-3 mr-1" />
          {diagnosing ? 'Diagnosing…' : 'Diagnose'}
        </Button>
        {onDismiss && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs px-2.5 text-slate-500 hover:text-slate-900"
            onClick={() => onDismiss(run.id)}
          >
            <X className="size-3 mr-1" />
            Dismiss
          </Button>
        )}
      </div>

      {diagnosing && (
        <div className="mt-2 h-12 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" />
      )}
      {diagError && (
        <p className="mt-2 text-[11px] text-red-700 dark:text-red-400">{diagError}</p>
      )}
      {diagnosis && (
        <DiagnosisResult result={diagnosis} onClose={() => setDiagnosis(null)} />
      )}
    </article>
  )
}
