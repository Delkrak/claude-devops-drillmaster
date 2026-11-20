import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { UserError, type Drillmaster } from '../app.js'
import { VERSION } from '../version.js'
import { serveViewer } from './static.js'

const MAX_BODY_BYTES = 5 * 1024 * 1024
const HOOK_ROUTE = /^POST \/hooks\/([A-Za-z]+)$/
const VIEWER_API_ROUTE = /^GET \/api\/projects\/([\w-]+)(?:\/items\/([\w-]+))?$/
const HISTORY_ROUTE = /^GET \/api\/projects\/([\w-]+)\/history\/([\w-]+)$/
const WORKFLOW_PAGE_ROUTE = /^GET \/api\/projects\/([\w-]+)\/workflow$/
const WORK_ITEMS_ROUTE = /^GET \/api\/projects\/([\w-]+)\/work-items(?:\/([\w-]+))?$/
const ARTIFACT_ROUTE = /^GET \/api\/projects\/([\w-]+)\/items\/([\w-]+)\/artifacts\/([\w.-]+)$/

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bodyBytes = 0
  for await (const chunk of request) {
    bodyBytes += (chunk as Buffer).length
    if (bodyBytes > MAX_BODY_BYTES) throw new UserError('Request body too large', 413)
    chunks.push(chunk as Buffer)
  }
  const bodyText = Buffer.concat(chunks).toString('utf8')
  if (bodyText.trim() === '') return {}
  try {
    const body = JSON.parse(bodyText) as unknown
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch {
    throw new UserError('The body must be a JSON object')
  }
}

function sendJson(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function requireProjectDir(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') throw new UserError('`project` (the project directory) is required')
  return value
}

/** An `at` query parameter as the ISO time events carry; none when it isn't given. */
function momentOf(at: string | null) {
  if (at === null) return undefined
  const time = Date.parse(at)
  if (Number.isNaN(time)) throw new UserError(`\`at\` must be a date and time, like 2026-11-20T19:10:16.785Z; "${at}" isn't one.`)
  return new Date(time).toISOString()
}

const isViewerPath =(pathname: string) => pathname === '/' || pathname.startsWith('/assets/') || pathname.startsWith('/ui')

/** `servedProject`: the key of the one project this server serves, whose viewer it shows; any, in tests. */
export function createRequestHandler(app: Drillmaster, servedProject?: string) {
  const refuseOtherProject = (projectId: string) => {
    if (servedProject && projectId !== servedProject) throw new UserError(`This server serves project ${servedProject}, not ${projectId}.`, 404)
  }
  /** A work folder of another project; one that isn't a project yet may be set up here. */
  const requireServedProjectDir = (value: unknown) => {
    const projectDir = requireProjectDir(value)
    const projectKey = app.projectKeyOf(projectDir)
    if (servedProject && projectKey && projectKey !== servedProject) throw new UserError(`This server serves project ${servedProject}, not ${projectKey}.`, 409)
    return projectDir
  }
  return async (request: http.IncomingMessage, response: http.ServerResponse) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const route = `${request.method} ${url.pathname}`
      const hookMatch = HOOK_ROUTE.exec(route)
      if (hookMatch) {
        const body = await readJsonBody(request)
        return sendJson(response, 200, await app.hook(requireServedProjectDir(body.project), hookMatch[1]!, body.payload))
      }
      const artifactMatch = ARTIFACT_ROUTE.exec(route)
      if (artifactMatch) {
        refuseOtherProject(artifactMatch[1]!)
        const artifact = await app.artifact(artifactMatch[1]!, artifactMatch[2]!, artifactMatch[3]!)
        response.writeHead(200, { 'content-type': artifact.mediaType, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' })
        return response.end(artifact.bytes)
      }
      const historyMatch = HISTORY_ROUTE.exec(route)
      if (historyMatch) {
        refuseOtherProject(historyMatch[1]!)
        return sendJson(response, 200, await app.componentHistory(historyMatch[1]!, historyMatch[2]!))
      }
      const workflowPageMatch = WORKFLOW_PAGE_ROUTE.exec(route)
      if (workflowPageMatch) {
        refuseOtherProject(workflowPageMatch[1]!)
        return sendJson(response, 200, await app.workflowPage(workflowPageMatch[1]!, momentOf(url.searchParams.get('at'))))
      }
      const workItemsMatch = WORK_ITEMS_ROUTE.exec(route)
      if (workItemsMatch) {
        const [, projectId, workItemId] = workItemsMatch
        refuseOtherProject(projectId!)
        const at = momentOf(url.searchParams.get('at'))
        return sendJson(response, 200, workItemId ? await app.workItemPage(projectId!, workItemId, at) : await app.workItemsList(projectId!, at))
      }
      const viewerApiMatch = VIEWER_API_ROUTE.exec(route)
      if (viewerApiMatch) {
        const [, projectId, workItemId] = viewerApiMatch
        refuseOtherProject(projectId!)
        return sendJson(response, 200, workItemId ? await app.workItemView(projectId!, workItemId) : await app.projectView(projectId!))
      }
      if (request.method === 'GET' && isViewerPath(url.pathname)) {
        return serveViewer(response, url.pathname.startsWith('/assets/') ? url.pathname : '/index.html')
      }
      switch (route) {
        case 'GET /health':
          return sendJson(response, 200, { ok: true, name: 'drillmaster', version: VERSION, pid: process.pid, project: servedProject ?? null })
        case 'GET /api/served':
          return sendJson(response, 200, { project: servedProject ?? null })
        case 'GET /state': {
          const projectDir = requireServedProjectDir(url.searchParams.get('project'))
          if (url.searchParams.get('idle') === '1') await app.idle()
          const events = await app.events(projectDir)
          return sendJson(response, 200, { project: projectDir, events, state: await app.state(projectDir) })
        }
        case 'POST /projects/init': {
          const body = await readJsonBody(request)
          if (typeof body.drillmaster_repository !== 'string' || !body.drillmaster_repository) throw new UserError('`drillmaster_repository` (the git repository that keeps the project) is required')
          const { workflow, project } = await app.init(requireServedProjectDir(body.project), body.objective, {
            url: body.drillmaster_repository,
            ...(typeof body.folder === 'string' ? { folder: body.folder } : {}),
          })
          return sendJson(response, 201, { workflow, project: project.key })
        }
        case 'GET /tools':
          return sendJson(response, 200, { tools: app.tools() })
        case 'POST /tools/call': {
          const body = await readJsonBody(request)
          if (typeof body.name !== 'string') throw new UserError('`name` (the tool name) is required')
          return sendJson(response, 200, await app.callTool(requireServedProjectDir(body.project), body.name, body.arguments))
        }
        default:
          return sendJson(response, 404, { error: `No route for ${route}` })
      }
    } catch (error) {
      if (error instanceof UserError) return sendJson(response, error.status, { error: error.message })
      console.error(error)
      return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export interface RunningServer {
  port: number
  url: string
  close(): Promise<void>
}

export async function listen(app: Drillmaster, port = 0, servedProject?: string): Promise<RunningServer> {
  const server = http.createServer(createRequestHandler(app, servedProject))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  const boundPort = (server.address() as AddressInfo).port
  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
