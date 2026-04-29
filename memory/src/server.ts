import { createServer, IncomingMessage, ServerResponse } from 'http'
import { search } from './search'
import { ingestSource } from './index'
import { SearchRequest, SourceName } from './types'

const PORT = parseInt(process.env.PORT ?? '8080', 10)
const MEMORY_API_TOKEN = process.env.MEMORY_API_TOKEN

function authenticate(req: IncomingMessage): boolean {
  if (!MEMORY_API_TOKEN) return true // No token configured → open (dev mode)
  const auth = req.headers['authorization'] ?? ''
  return auth === `Bearer ${MEMORY_API_TOKEN}`
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

export function startServer(): void {
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    // Health check — no auth required
    if (url === '/health' && method === 'GET') {
      json(res, 200, { status: 'ok', service: 'cropsintel-memory', ts: new Date().toISOString() })
      return
    }

    // All other endpoints require auth
    if (!authenticate(req)) {
      json(res, 401, { error: 'Unauthorized' })
      return
    }

    try {
      if (url === '/search' && method === 'POST') {
        const body = await readBody(req)
        let payload: SearchRequest
        try {
          payload = JSON.parse(body) as SearchRequest
        } catch {
          json(res, 400, { error: 'Invalid JSON body' })
          return
        }

        if (!payload.query || typeof payload.query !== 'string') {
          json(res, 400, { error: 'query field is required' })
          return
        }

        const result = await search(payload)
        json(res, 200, result)
        return
      }

      if (url === '/ingest' && method === 'POST') {
        const body = await readBody(req)
        let payload: { source: string }
        try {
          payload = JSON.parse(body) as { source: string }
        } catch {
          json(res, 400, { error: 'Invalid JSON body' })
          return
        }

        // Fire-and-forget; return immediately with 202
        json(res, 202, { status: 'accepted', source: payload.source })
        ingestSource(payload.source as SourceName | 'all').catch(err =>
          console.error('[server] ingest error:', err),
        )
        return
      }

      json(res, 404, { error: 'Not found' })
    } catch (err) {
      console.error('[server] Unhandled error:', err)
      json(res, 500, { error: String(err) })
    }
  })

  server.listen(PORT, () => {
    console.log(`[memory-server] Listening on :${PORT}`)
  })
}
