import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { daemonInfoFile } from './env.js'

const HEALTH_TIMEOUT_MS = 1500
const START_POLL_MS = 150
const DEFAULT_START_TIMEOUT_MS = 15_000

export interface DaemonInfo {
  port: number
  pid: number
  url: string
}

export async function readDaemonInfo(env: NodeJS.ProcessEnv = process.env): Promise<DaemonInfo | undefined> {
  try {
    return JSON.parse(await readFile(daemonInfoFile(env), 'utf8')) as DaemonInfo
  } catch {
    return undefined
  }
}

export async function isDrillmasterServerAt(url: string) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    const health = (await response.json()) as { name?: string }
    return response.ok && health.name === 'drillmaster'
  } catch {
    return false
  }
}

function cliEntryPath() {
  const thisModule = fileURLToPath(import.meta.url)
  return path.join(path.dirname(thisModule), `cli${path.extname(thisModule)}`)
}

export async function findOrStartServer(env: NodeJS.ProcessEnv = process.env, timeoutMs = DEFAULT_START_TIMEOUT_MS): Promise<string> {
  const existingInfo = await readDaemonInfo(env)
  if (existingInfo && (await isDrillmasterServerAt(existingInfo.url))) return existingInfo.url

  const server = spawn(process.execPath, [...process.execArgv, cliEntryPath(), 'daemon'], { detached: true, stdio: 'ignore', windowsHide: true, env })
  server.unref()

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS))
    const announcedInfo = await readDaemonInfo(env)
    if (announcedInfo && (await isDrillmasterServerAt(announcedInfo.url))) return announcedInfo.url
  }
  throw new Error(`The Drillmaster server did not start within ${timeoutMs / 1000}s (home: ${path.dirname(daemonInfoFile(env))}).`)
}

export async function requestJson<T>(url: string, method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${url}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(json.error ?? `${method} ${route} failed with ${response.status}`)
  return json
}
