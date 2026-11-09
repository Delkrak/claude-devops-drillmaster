import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OBJECTIVE, tempDir } from '../helpers.js'

const SERVER_DIR = path.resolve(import.meta.dirname, '../..')
let home: Awaited<ReturnType<typeof tempDir>>
let project: Awaited<ReturnType<typeof tempDir>>
let client: Client

const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { type: string; text: string }[])[0]!.text

beforeAll(async () => {
  home = await tempDir('home')
  project = await tempDir('project')
  client = new Client({ name: 'shim-test', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', path.join(SERVER_DIR, 'src', 'cli.ts'), 'mcp'],
      cwd: SERVER_DIR,
      env: { ...(process.env as Record<string, string>), DRILLMASTER_HOME: home.dir, CLAUDE_PROJECT_DIR: project.dir },
      stderr: 'pipe',
    }),
  )
})

afterAll(async () => {
  await client?.close()
  try {
    const { pid } = JSON.parse(await readFile(path.join(home.dir, 'daemon.json'), 'utf8')) as { pid: number }
    process.kill(pid)
  } catch {
    // The server never started.
  }
  await project.remove()
  await home.remove()
})

describe('stdio MCP shim', () => {
  it('starts the shared server and lists the tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['workflow_get', 'work_start', 'work_skip', 'work_report', 'work_gate', 'work_deliver', 'work_post_mortem', 'workflow_retrospective', 'work_status'])
    const info = JSON.parse(await readFile(path.join(home.dir, 'daemon.json'), 'utf8')) as { url: string }
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('forwards workflow_get with the project dir', async () => {
    const before = await client.callTool({ name: 'workflow_get', arguments: {} })
    expect(before.isError).toBe(true)
    expect(text(before)).toMatch(/no workflow yet/)

    const { url } = JSON.parse(await readFile(path.join(home.dir, 'daemon.json'), 'utf8')) as { url: string }
    const init = await fetch(`${url}/projects/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: project.dir, objective: OBJECTIVE }),
    })
    expect(init.status).toBe(201)

    const after = await client.callTool({ name: 'workflow_get', arguments: {} })
    expect(after.isError).toBeFalsy()
    expect(JSON.parse(text(after))).toMatchObject({ kind: 'overview', version: '0.0.0', objective: OBJECTIVE })
  })

  it('stores events in the isolated home only', async () => {
    const { url } = JSON.parse(await readFile(path.join(home.dir, 'daemon.json'), 'utf8')) as { url: string }
    const res = await fetch(`${url}/state?project=${encodeURIComponent(project.dir)}`)
    const { events } = (await res.json()) as { events: { type: string }[] }
    expect(events.map((e) => e.type)).toEqual(['project_initialized'])
  })

  it('gives Claude Code the markdown rendering, without structuredContent to show instead', async () => {
    const started = await client.callTool({ name: 'work_start', arguments: { issue: '#1', description: 'through the shim' } })
    expect(started.structuredContent).toBeUndefined()
    expect(text(started)).toContain('# Work item ')
    expect(text(started)).toContain('work_item_id: wi_')
  })
})
