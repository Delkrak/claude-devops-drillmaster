#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const POST_TIMEOUT_MS = 4000
// The plugin's committed bundle: a marketplace install has no build of its own.
const SERVER_BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'bundle')
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
  const { projectToServe, readProjectServerInfo } = await buildModule('projectLocator.js')
  // A folder without .drillmaster isn't traced.
  const project = projectToServe(projectDir)
  if (!project) return
  const body = { project: projectDir, payload }

  let serverAnswer
  try {
    // The fast path: the server named in daemon.json, which refuses a folder of another project.
    const announced = await readProjectServerInfo(project.key)
    if (!announced) throw new Error('no server')
    serverAnswer = await postHookEvent(announced.url, hookEvent, body)
  } catch {
    // Only the session's first hook starts the project's server; later hooks must stay fast.
    if (hookEvent !== 'SessionStart') return
    const { findOrStartProjectServer } = await buildModule('projectServer.js')
    serverAnswer = await postHookEvent(await findOrStartProjectServer(project), hookEvent, body)
  }
  if (serverAnswer?.output) process.stdout.write(JSON.stringify(serverAnswer.output))
}

forwardHook().catch(() => {
  // A hook only records: failing silently loses one trace, never the session.
})
