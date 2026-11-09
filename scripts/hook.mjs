#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const POST_TIMEOUT_MS = 4000
const START_POLL_MS = 150
const START_POLL_ATTEMPTS = 30

const drillmasterHome = () => path.resolve(process.env.DRILLMASTER_HOME ?? path.join(os.homedir(), '.drillmaster'))

const readHookPayload = () => {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

const announcedServerUrl = () => {
  try {
    return JSON.parse(readFileSync(path.join(drillmasterHome(), 'daemon.json'), 'utf8')).url
  } catch {
    return undefined
  }
}

const postHookEvent = async (serverUrl, hookEvent, body) => {
  const response = await fetch(`${serverUrl}/hooks/${hookEvent}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

const startServerFromPluginBuild = async () => {
  const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'dist', 'cli.js')
  spawn(process.execPath, [cliPath, 'daemon'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  for (let attempt = 0; attempt < START_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS))
    const serverUrl = announcedServerUrl()
    if (serverUrl) return serverUrl
  }
  return undefined
}

const forwardHook = async () => {
  const hookEvent = process.argv[2]
  if (!hookEvent) return
  const payload = readHookPayload()
  const body = { project: process.env.CLAUDE_PROJECT_DIR ?? payload.cwd ?? process.cwd(), payload }

  let serverUrl = announcedServerUrl()
  let serverAnswer
  try {
    if (!serverUrl) throw new Error('no server')
    serverAnswer = await postHookEvent(serverUrl, hookEvent, body)
  } catch {
    // Only the session's first hook starts the server; later hooks must stay fast.
    if (hookEvent !== 'SessionStart') return
    serverUrl = await startServerFromPluginBuild()
    if (!serverUrl) return
    serverAnswer = await postHookEvent(serverUrl, hookEvent, body)
  }
  if (serverAnswer?.output) process.stdout.write(JSON.stringify(serverAnswer.output))
}

forwardHook().catch(() => {
  // A hook only records: failing silently loses one trace, never the session.
})
