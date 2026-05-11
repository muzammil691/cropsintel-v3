// 1.10bb-c Session 7 — dedicated error boundary for the Workshop tab.
//
// Replaces the generic ErrorBoundary fallback with a Workshop-aware diagnosis
// surface: shows the actual error message + stack, a "Reload page" button
// (full reload, not just a state reset — chunk-load errors need a fresh
// index.html), and a "Report issue" link that pre-fills a GitHub issue with
// the captured stack so the user doesn't have to re-type it.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCcw, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { drAtlas } from '@/lib/drAtlas'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string | null
}

const REPO_ISSUES_URL = 'https://github.com/muzammil691/cropsintel-v3/issues/new'

export class WorkshopErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, componentStack: info.componentStack ?? null })
    console.error('[WorkshopErrorBoundary]', error, info.componentStack)
    drAtlas.log('error', 'ui', `Workshop tab crashed: ${error.message}`, {
      severity: 'error',
      metadata: {
        stack: error.stack ?? null,
        componentStack: info.componentStack ?? null,
        chunkLoadError: isChunkLoadError(error),
      },
    })
  }

  handleReload = () => {
    // Hard reload so a stale index.html or chunk-hash mismatch resolves.
    if (typeof window !== 'undefined') window.location.reload()
  }

  buildIssueUrl(): string {
    const { error, componentStack } = this.state
    if (!error) return REPO_ISSUES_URL
    const title = encodeURIComponent(`Workshop tab error: ${error.message.slice(0, 120)}`)
    const bodyLines = [
      '## What happened',
      '',
      'The Workshop tab failed to load / crashed mid-render.',
      '',
      '## Error',
      '',
      '```',
      error.message,
      '```',
      '',
      '## Stack',
      '',
      '```',
      (error.stack ?? '').slice(0, 4000),
      '```',
    ]
    if (componentStack) {
      bodyLines.push('', '## Component stack', '', '```', componentStack.slice(0, 4000), '```')
    }
    bodyLines.push('', '## Browser', '', navigator.userAgent || '(unknown)')
    const body = encodeURIComponent(bodyLines.join('\n'))
    return `${REPO_ISSUES_URL}?title=${title}&body=${body}&labels=bug,workshop`
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    const isChunkErr = isChunkLoadError(error)

    return (
      <div className="h-full min-h-[60vh] flex items-center justify-center p-4 sm:p-6 bg-amber-50/40 dark:bg-amber-950/10">
        <section
          role="alert"
          aria-live="assertive"
          className="max-w-2xl w-full rounded-lg border border-amber-300/80 dark:border-amber-800/80 bg-white/95 dark:bg-amber-950/40 shadow-md overflow-hidden"
        >
          <header className="flex items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3 border-b border-amber-200/60 dark:border-amber-900/40 bg-amber-100/60 dark:bg-amber-950/50">
            <AlertTriangle className="size-4 text-amber-700 dark:text-amber-300 shrink-0" aria-hidden />
            <h2 className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200">
              Workshop tab failed to load
            </h2>
          </header>

          <div className="px-3 py-3 sm:px-4 sm:py-4 space-y-3">
            <p className="text-[12px] sm:text-sm text-slate-700 dark:text-slate-200 leading-snug">
              {isChunkErr
                ? 'The browser couldn’t fetch the Workshop bundle — usually because a new deploy invalidated cached chunk hashes. Reload to pick up the current assets.'
                : 'The Workshop tab threw an error while rendering. The details below are sent to drAtlas; you can also file an issue with one click.'}
            </p>

            <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30 px-2.5 py-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-rose-900 dark:text-rose-200 mb-1">
                Error message
              </h3>
              <p className="text-[11px] sm:text-xs text-rose-900 dark:text-rose-100 font-mono break-all">
                {error.message || '(no message)'}
              </p>
            </div>

            {error.stack && (
              <details className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60">
                <summary className="cursor-pointer px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Stack trace
                </summary>
                <pre className="px-2.5 py-2 text-[10px] sm:text-[11px] text-slate-700 dark:text-slate-300 overflow-x-auto max-h-64 whitespace-pre-wrap break-words">
                  {error.stack.slice(0, 4000)}
                </pre>
              </details>
            )}

            {componentStack && (
              <details className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60">
                <summary className="cursor-pointer px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Component stack
                </summary>
                <pre className="px-2.5 py-2 text-[10px] sm:text-[11px] text-slate-700 dark:text-slate-300 overflow-x-auto max-h-48 whitespace-pre-wrap break-words">
                  {componentStack.slice(0, 4000)}
                </pre>
              </details>
            )}
          </div>

          <footer className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 px-3 py-2 sm:px-4 sm:py-3 border-t border-amber-200/60 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/30">
            <a
              href={this.buildIssueUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50"
            >
              <ExternalLink className="size-3" aria-hidden />
              Report issue
            </a>
            <Button
              type="button"
              size="sm"
              onClick={this.handleReload}
              className="h-7 px-3 text-[11px] sm:text-xs bg-amber-700 text-white hover:bg-amber-800"
            >
              <RefreshCcw className="size-3 mr-1.5" aria-hidden />
              Reload page
            </Button>
          </footer>
        </section>
      </div>
    )
  }
}

function isChunkLoadError(err: Error): boolean {
  const msg = err.message || ''
  return (
    err.name === 'ChunkLoadError' ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Unable to preload CSS for/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  )
}

export default WorkshopErrorBoundary
