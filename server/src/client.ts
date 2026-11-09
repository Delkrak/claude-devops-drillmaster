// How clients (the stdio shim and the CLI) find the one Drillmaster server, starting it if needed.

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { daemonFile } from './env.js'

export interface DaemonInfo {
  port: number
  pid: number
  url: string
}

export async function readDaemonInfo(env: NodeJS.ProcessEnv = process.env): Promise<DaemonInfo | undefined> {
  try {
    return JSON.parse(await readFile(daemonFile(env), 'utf8')) as DaemonInfo
  } catch {
    return undefined
  }
}

export async function isHealthy(url: string) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
    const body = (await res.json()) as { name?: string }
    return res.ok && body.name === 'drillmaster'
  } catch {
    return false
  }
}

/** The CLI entry next to this module: cli.js when built, cli.ts when run through tsx. */
function cliEntry() {
  const here = fileURLToPath(import.meta.url)
  return path.join(path.dirname(here), `cli${path.extname(here)}`)
}

/** Returns the server's URL, starting a detached server first if none answers. */
export async function ensureDaemon(env: NodeJS.ProcessEnv = process.env, timeoutMs = 15_000): Promise<string> {
  const existing = await readDaemonInfo(env)
  if (existing && (await isHealthy(existing.url))) return existing.url

  const child = spawn(process.execPath, [...process.execArgv, cliEntry(), 'daemon'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env,
  })
  child.unref()

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    const info = await readDaemonInfo(env)
    if (info && (await isHealthy(info.url))) return info.url
  }
  throw new Error(`The Drillmaster server did not start within ${timeoutMs / 1000}s (home: ${path.dirname(daemonFile(env))}).`)
}

export async function request<T>(url: string, method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${url}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `${method} ${route} failed with ${res.status}`)
  return json
}
