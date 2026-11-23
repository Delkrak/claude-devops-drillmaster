import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectKey } from '../../src/adapters/projects.js'
import { VERSION } from '../../src/version.js'
import { OBJECTIVE, tempDir } from '../helpers.js'

const SERVER_DIR = path.resolve(import.meta.dirname, '../..')
let home: Awaited<ReturnType<typeof tempDir>>
let project: Awaited<ReturnType<typeof tempDir>>
let client: Client
let drillmasterRepository: string

const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { type: string; text: string }[])[0]!.text
const serverInfoFile = () => path.join(home.dir, 'projects', projectKey({ url: drillmasterRepository, folder: 'shim' }), 'daemon.json')

beforeAll(async () => {
  home = await tempDir('home')
  project = await tempDir('project')
  drillmasterRepository = path.join(home.dir, 'drillmaster.git')
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', drillmasterRepository])
  client = new Client({ name: 'shim-test', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', path.join(SERVER_DIR, 'src', 'cli.ts'), 'mcp'],
      cwd: SERVER_DIR,
      env: { ...(process.env as Record<string, string>), DRILLMASTER_HOME: home.dir, CLAUDE_PROJECT_DIR: project.dir, DRILLMASTER_REVIEWER: 'none' },
      stderr: 'pipe',
    }),
  )
})

afterAll(async () => {
  await client?.close()
  try {
    const { pid } = JSON.parse(await readFile(serverInfoFile(), 'utf8')) as { pid: number }
    process.kill(pid)
  } catch {
    // The server never started.
  }
  await project.remove()
  await home.remove()
})

describe('stdio MCP shim', () => {
  it('lists the tools in a folder that is no project yet, where only setup works', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['workflow_get', 'work_start', 'work_resume', 'work_skip', 'work_input', 'work_report', 'work_gate', 'work_deliver', 'work_post_mortem', 'workflow_retrospective', 'work_status'])
    const before = await client.callTool({ name: 'workflow_get', arguments: {} })
    expect(before.isError).toBe(true)
    expect(text(before)).toMatch(/not a Drillmaster project/)
  })

  it("sets the project up through the project's own server, at this version", async () => {
    const setup = await client.callTool({
      name: 'workflow_retrospective',
      arguments: { action: 'setup', objective: OBJECTIVE.text, measures: OBJECTIVE.measures, drillmaster_repository: drillmasterRepository, folder: 'shim' },
    })
    expect(setup.isError).toBeFalsy()
    const info = JSON.parse(await readFile(serverInfoFile(), 'utf8')) as { url: string; version: string }
    expect(info).toMatchObject({ url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/), version: VERSION })
    expect(JSON.parse(await readFile(path.join(project.dir, '.drillmaster'), 'utf8'))).toEqual({ drillmaster_repository: drillmasterRepository, folder: 'shim' })
    const after = await client.callTool({ name: 'workflow_get', arguments: {} })
    expect(JSON.parse(text(after))).toMatchObject({ kind: 'overview', version: '0.0.0', objective: OBJECTIVE })
  })

  it('keeps the events in the isolated home only', async () => {
    const { url } = JSON.parse(await readFile(serverInfoFile(), 'utf8')) as { url: string }
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
