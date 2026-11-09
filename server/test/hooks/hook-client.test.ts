// Runs the real plugin hook client (scripts/hook.mjs) as Claude Code would: a separate process,
// the payload on stdin, the output on stdout. The server is in-process, found via daemon.json.

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { listen, type RunningServer } from '../../src/daemon/http.js'
import { OBJECTIVE, tempDir, testPorts } from '../helpers.js'

const HOOK = path.resolve(import.meta.dirname, '../../../scripts/hook.mjs')
const FIXTURES = path.join(import.meta.dirname, 'fixtures')

let server: RunningServer
let home: Awaited<ReturnType<typeof tempDir>>
let project: Awaited<ReturnType<typeof tempDir>>

function runHook(event: string, payload: unknown, env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string; ms: number }>((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [HOOK, event], {
      env: { ...process.env, DRILLMASTER_HOME: home.dir, CLAUDE_PROJECT_DIR: project.dir, ...env },
    })
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.on('close', (code) => resolve({ code, stdout, ms: Date.now() - started }))
    child.stdin.end(JSON.stringify(payload))
  })
}

beforeAll(async () => {
  home = await tempDir('hook-home')
  project = await tempDir('hook-project')
  server = await listen(new Drillmaster(testPorts()))
  await writeFile(path.join(home.dir, 'daemon.json'), JSON.stringify({ port: server.port, pid: process.pid, url: server.url }))
  await fetch(`${server.url}/projects/init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: project.dir, objective: OBJECTIVE }),
  })
})

afterAll(async () => {
  await server.close()
  await home.remove()
  await project.remove()
})

describe('hook.mjs', () => {
  it('prints the SessionStart brief', async () => {
    const { code, stdout } = await runHook('SessionStart', { session_id: 'h1', source: 'startup', hook_event_name: 'SessionStart' })
    expect(code).toBe(0)
    expect(JSON.parse(stdout).hookSpecificOutput.additionalContext).toMatch(/Drillmaster runs this project/)
  })

  it.each(readdirSync(FIXTURES).filter((f) => f.endsWith('.json')))('stores the recorded payload %s', async (file) => {
    const { event, payload } = JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8')) as { event: string; payload: { session_id: string } }
    const before = await count()
    const { code } = await runHook(event, payload)
    expect(code).toBe(0)
    expect(await count()).toBeGreaterThan(before)
  })

  it('stays silent and quick when no server answers', async () => {
    const { code, stdout, ms } = await runHook('PreToolUse', { session_id: 'h1' }, { DRILLMASTER_HOME: path.join(home.dir, 'nowhere') })
    expect(code).toBe(0)
    expect(stdout).toBe('')
    expect(ms).toBeLessThan(5000)
  })

  it('stays silent on garbage input', async () => {
    const child = await new Promise<number | null>((resolve) => {
      const p = spawn(process.execPath, [HOOK, 'PreToolUse'], { env: { ...process.env, DRILLMASTER_HOME: home.dir } })
      p.on('close', resolve)
      p.stdin.end('not json')
    })
    expect(child).toBe(0)
  })
})

async function count() {
  const res = await fetch(`${server.url}/state?project=${encodeURIComponent(project.dir)}`)
  return ((await res.json()) as { events: unknown[] }).events.length
}
