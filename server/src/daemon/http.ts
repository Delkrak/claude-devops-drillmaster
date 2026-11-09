// The Drillmaster server over HTTP on 127.0.0.1. It is the only thing that stores anything:
// the stdio shim forwards MCP tool calls here, and the hooks and the CLI use the REST endpoints.

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { UserError, type Drillmaster } from '../app.js'
import { VERSION } from '../version.js'

const MAX_BODY = 5 * 1024 * 1024

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new UserError('Request body too large', 413)
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new UserError('The body must be a JSON object')
  }
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function requireProject(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') throw new UserError('`project` (the project directory) is required')
  return value
}

export function createHandler(app: Drillmaster) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const route = `${req.method} ${url.pathname}`
      const hook = /^POST \/hooks\/([A-Za-z]+)$/.exec(route)
      if (hook) {
        const body = await readJson(req)
        return send(res, 200, await app.hook(requireProject(body.project), hook[1]!, body.payload))
      }
      switch (route) {
        case 'GET /health':
          return send(res, 200, { ok: true, name: 'drillmaster', version: VERSION, pid: process.pid })
        case 'GET /state': {
          const project = requireProject(url.searchParams.get('project'))
          const events = await app.events(project)
          return send(res, 200, { project, events, state: await app.state(project) })
        }
        case 'POST /projects/init': {
          const body = await readJson(req)
          const workflow = await app.init(requireProject(body.project), body.objective)
          return send(res, 201, { workflow })
        }
        case 'GET /tools':
          return send(res, 200, { tools: app.tools() })
        case 'POST /tools/call': {
          const body = await readJson(req)
          if (typeof body.name !== 'string') throw new UserError('`name` (the tool name) is required')
          return send(res, 200, await app.callTool(requireProject(body.project), body.name, body.arguments))
        }
        default:
          return send(res, 404, { error: `No route for ${route}` })
      }
    } catch (error) {
      if (error instanceof UserError) return send(res, error.status, { error: error.message })
      console.error(error)
      return send(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export interface RunningServer {
  port: number
  url: string
  close(): Promise<void>
}

/** Listens on 127.0.0.1. Port 0 picks a free port, which is what tests and the daemon use. */
export async function listen(app: Drillmaster, port = 0): Promise<RunningServer> {
  const server = http.createServer(createHandler(app))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  const actual = (server.address() as AddressInfo).port
  return {
    port: actual,
    url: `http://127.0.0.1:${actual}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
