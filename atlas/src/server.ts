import { createServer, IncomingMessage, ServerResponse } from 'http'
import { validateEnv } from './lib/env'

const PORT = parseInt(process.env.PORT ?? '8080', 10)
const ATLAS_API_TOKEN = process.env.ATLAS_API_TOKEN

function authenticate(req: IncomingMessage): boolean {
  if (!ATLAS_API_TOKEN) return true
  const auth = req.headers['authorization'] ?? ''
  return auth === `Bearer ${ATLAS_API_TOKEN}`
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

export function startServer(): void {
  validateEnv()

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    if (url === '/health' && method === 'GET') {
      json(res, 200, {
        status: 'ok',
        service: 'cropsintel-atlas',
        version: '0.1.0',
        trust_mode: process.env.ATLAS_TRUST_MODE ?? 'passive',
        ts: new Date().toISOString(),
      })
      return
    }

    if (!authenticate(req)) {
      json(res, 401, { error: 'Unauthorized' })
      return
    }

    json(res, 404, { error: 'Not found — endpoint will be added in subsequent tasks' })
  })

  server.listen(PORT, () => {
    console.log(`[atlas-server] Listening on :${PORT}`)
  })
}
