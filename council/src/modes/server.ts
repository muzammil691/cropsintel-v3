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

  return app
}

export function runServer(): void {
  const app = createServer()
  app.listen(PORT, () => {
    console.log(`[Council:server] Listening on port ${PORT}`)
  })
}
