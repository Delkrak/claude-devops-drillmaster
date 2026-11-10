#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const POST_TIMEOUT_MS = 4000
const SERVER_BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'dist')
const buildModule = (name) => import(pathToFileURL(path.join(SERVER_BUILD, name)).href)

const readHookPayload = () => {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
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

const forwardHook = async () => {
  const hookEvent = process.argv[2]
  if (!hookEvent) return
  const payload = readHookPayload()
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? payload.cwd ?? process.cwd()
  const { projectToServe, runningProjectServer } = await buildModule('projectLocator.js')
  // A folder without .drillmaster isn't traced.
  const project = projectToServe(projectDir)
  if (!project) return

  let serverUrl = await runningProjectServer(project.key)
  if (!serverUrl) {
    // Only the session's first hook starts the project's server; later hooks must stay fast.
    if (hookEvent !== 'SessionStart') return
    const { findOrStartProjectServer } = await buildModule('projectServer.js')
    serverUrl = await findOrStartProjectServer(project)
  }
  const serverAnswer = await postHookEvent(serverUrl, hookEvent, { project: projectDir, payload })
  if (serverAnswer?.output) process.stdout.write(JSON.stringify(serverAnswer.output))
}

forwardHook().catch(() => {
  // A hook only records: failing silently loses one trace, never the session.
})
