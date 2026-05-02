import express, { NextFunction, Request, Response } from 'express'
import { council } from '../council'
import { CouncilInput, CouncilDepth, CouncilMode } from '../types'

const PORT = parseInt(process.env.PORT ?? '8080', 10)

export function createServer(): express.Application {
  const app = express()
  app.use(express.json({ limit: '1mb' }))

  // Auth middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') return next()
    const token = process.env.COUNCIL_API_TOKEN
    if (!token) return next() // No token set — open (dev only)
    const auth = req.headers.authorization
    if (!auth || auth !== `Bearer ${token}`) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    next()
  })

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'council', version: '1.0.0' })
  })

  app.post('/council', async (req: Request, res: Response) => {
    const { question, context, depth = 'quick' } = req.body as {
      question?: string
      context?: Record<string, unknown>
      depth?: CouncilDepth
    }

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.status(400).json({ error: 'question is required' })
      return
    }

    const input: CouncilInput = {
      question: question.trim(),
      context,
      mode: 'runtime' as CouncilMode,
      depth: depth === 'deep' ? 'deep' : 'quick',
      invokedBy: req.headers['x-invoked-by']?.toString() ?? 'http',
    }

    try {
      const output = await council(input)
      res.json({
        runId: output.runId,
        finalDecision: output.finalDecision,
        confidence: output.confidence,
        costUsd: output.costUsd,
        durationMs: output.durationMs,
        depth: output.depth,
        adrMarkdown: output.adrMarkdown,
      })
    } catch (err) {
      console.error('[Council:server] Error:', err instanceof Error ? err.message : err)
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
    }
  })

  // POST /write-spec — Atlas spec-draft.ts contract.
  //
  // Atlas's draftSpec() pipeline calls this endpoint with `{ phase, context }`
  // and expects `{ spec_markdown, cost_usd }` back. Previously this route
  // didn't exist; spec-draft hit 404 every time, fell back to Claude-direct
  // drafting, and the multi-brain debate lost its primary draft input. The
  // entire propose_and_queue path silently degraded.
  //
  // Internally we wrap council() with a write-spec question template and
  // surface output.adrMarkdown as spec_markdown. The shape mirrors the
  // older councilWriteSpec() helper in atlas/src/lib/tools.ts so both Atlas
  // call sites converge on this route.
  app.post('/write-spec', async (req: Request, res: Response) => {
    const { phase, context } = req.body as {
      phase?: string
      context?: string | Record<string, unknown>
    }

    if (!phase || typeof phase !== 'string' || phase.trim().length === 0) {
      res.status(400).json({ error: 'phase is required' })
      return
    }

    const contextStr = typeof context === 'string'
      ? context
      : context !== undefined
        ? JSON.stringify(context)
        : ''

    const question = [
      `Draft a CropsIntel V3 task spec for Phase ${phase.trim()}.`,
      ``,
      contextStr ? `Goal / additional context (from caller):\n${contextStr}` : '',
      ``,
      `Output the full spec body as adrMarkdown. The spec MUST contain (case-insensitive):`,
      `  - "# Task: Phase <X.Y> — <name>" heading`,
      `  - "**Master plan reference:**" line`,
      `  - "**Estimated effort:**" line`,
      `  - "**Model:**" line`,
      `  - "model:" frontmatter line`,
      `  - "## Goal" section`,
      `  - "## Files" or "## Architecture" section`,
      `  - "## Success criteria" section (these become Verifier check inputs)`,
      `  - "## Risks + mitigations" section`,
      `  - "## NEVER list" section (Builder hard constraints)`,
      ``,
      `Foundation-first rule: do not propose a feature whose dependencies aren't`,
      `already shipped. If a dependency is missing, name it in Risks + mitigations`,
      `and recommend the dependency phase first.`,
    ].filter(Boolean).join('\n')

    const input: CouncilInput = {
      question,
      context: typeof context === 'object' && context !== null
        ? context
        : contextStr ? { goal: contextStr } : undefined,
      mode: 'runtime' as CouncilMode,
      depth: 'quick',
      invokedBy: req.headers['x-invoked-by']?.toString() ?? 'atlas-spec-draft',
    }

    try {
      const output = await council(input)
      res.json({
        spec_markdown: output.adrMarkdown,
        cost_usd: output.costUsd,
        run_id: output.runId,
        confidence: output.confidence,
        duration_ms: output.durationMs,
      })
    } catch (err) {
      console.error('[Council:server] /write-spec error:', err instanceof Error ? err.message : err)
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
    }
  })

  return app
}

export function runServer(): void {
  const app = createServer()
  app.listen(PORT, () => {
    console.log(`[Council:server] Listening on port ${PORT}`)
  })
}
