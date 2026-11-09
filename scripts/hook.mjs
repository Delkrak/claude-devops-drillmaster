#!/usr/bin/env node
// The Drillmaster hook client. It stores nothing itself: it forwards the raw Claude Code hook
// payload to the Drillmaster server (POST /hooks/<event>) and prints whatever the server returns.
// It must never fail the session, so every error ends in silence and exit code 0.
//
// Usage (from hooks/hooks.json): node hook.mjs <HookEvent>

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const home = () => path.resolve(process.env.DRILLMASTER_HOME ?? path.join(os.homedir(), '.drillmaster'))

const readStdin = () => {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

const serverUrl = () => {
  try {
    return JSON.parse(readFileSync(path.join(home(), 'daemon.json'), 'utf8')).url
  } catch {
    return undefined
  }
}

const post = async (url, event, body) => {
  const res = await fetch(`${url}/hooks/${event}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Starts the server from this plugin's build, then waits for it to announce itself. */
const startServer = async () => {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'dist', 'cli.js')
  spawn(process.execPath, [cli, 'daemon'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    const url = serverUrl()
    if (url) return url
  }
  return undefined
}

const main = async () => {
  const event = process.argv[2]
  if (!event) return
  const payload = readStdin()
  const body = { project: process.env.CLAUDE_PROJECT_DIR ?? payload.cwd ?? process.cwd(), payload }

  let url = serverUrl()
  let result
  try {
    if (!url) throw new Error('no server')
    result = await post(url, event, body)
  } catch {
    // Only the session's first hook starts the server; later hooks must stay fast.
    if (event !== 'SessionStart') return
    url = await startServer()
    if (!url) return
    result = await post(url, event, body)
  }
  if (result?.output) process.stdout.write(JSON.stringify(result.output))
}

main().catch(() => {
  // A Drillmaster hook only records; failing silently loses one trace, never the session.
})
