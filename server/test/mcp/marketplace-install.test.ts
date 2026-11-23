import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectKey } from '../../src/adapters/projects.js'
import { OBJECTIVE, tempDir } from '../helpers.js'

// The plugin as a marketplace install gets it: only the files git ships, no npm install, no build.
// Everything it runs (the MCP command, the hooks, the project server, the viewer) must come from them.

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..')
const PLUGIN_TOOLS = ['workflow_get', 'work_start', 'work_resume', 'work_skip', 'work_input', 'work_report', 'work_gate', 'work_deliver', 'work_post_mortem', 'workflow_retrospective', 'work_status']

let installed: Awaited<ReturnType<typeof tempDir>>
let home: Awaited<ReturnType<typeof tempDir>>
let project: Awaited<ReturnType<typeof tempDir>>
let drillmasterRepository: string
let client: Client
const pluginRoot = () => path.join(installed.dir, 'devops-drillmaster')
const serverInfoFile = () => path.join(home.dir, 'projects', projectKey({ url: drillmasterRepository, folder: 'installed' }), 'daemon.json')
const environment = () => ({ ...(process.env as Record<string, string>), DRILLMASTER_HOME: home.dir, CLAUDE_PROJECT_DIR: project.dir, CLAUDE_PLUGIN_ROOT: pluginRoot(), DRILLMASTER_REVIEWER: 'none' })

/** Copies the files git would ship (tracked, or new and not ignored) to where a marketplace install puts the plugin. */
async function installAsTheMarketplaceDoes() {
  const shipped = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: REPOSITORY_ROOT }).toString().split('\0').filter(Boolean)
  for (const file of shipped) {
    const from = path.join(REPOSITORY_ROOT, file)
    if (!existsSync(from)) continue
    await mkdir(path.dirname(path.join(pluginRoot(), file)), { recursive: true })
    await copyFile(from, path.join(pluginRoot(), file))
  }
}

/** Runs the command a plugin entry names, with ${CLAUDE_PLUGIN_ROOT} put in as Claude Code does. */
const withPluginRoot = (text: string) => text.split('${CLAUDE_PLUGIN_ROOT}').join(pluginRoot())

beforeAll(async () => {
  installed = await tempDir('installed')
  home = await tempDir('installed-home')
  project = await tempDir('installed-project')
  drillmasterRepository = path.join(home.dir, 'drillmaster.git')
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', drillmasterRepository])
  await installAsTheMarketplaceDoes()
  const manifest = JSON.parse(await readFile(path.join(pluginRoot(), '.claude-plugin', 'plugin.json'), 'utf8')) as { mcpServers: Record<string, { command: string; args: string[] }> }
  const { command, args } = manifest.mcpServers.drillmaster!
  client = new Client({ name: 'marketplace-install-test', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({ command: command === 'node' ? process.execPath : command, args: args.map(withPluginRoot), cwd: project.dir, env: environment(), stderr: 'pipe' }),
  )
}, 120_000)

afterAll(async () => {
  await client?.close()
  try {
    const { pid } = JSON.parse(await readFile(serverInfoFile(), 'utf8')) as { pid: number }
    process.kill(pid)
  } catch {
    // The project server never started.
  }
  await project.remove()
  await home.remove()
  await installed.remove()
})

describe('the plugin installed from the marketplace', () => {
  it('ships no build and no dependencies of its own to run from', () => {
    expect(existsSync(path.join(pluginRoot(), 'server', 'node_modules'))).toBe(false)
    expect(existsSync(path.join(pluginRoot(), 'server', 'dist'))).toBe(false)
  })

  it("starts its MCP server from the plugin's files alone", async () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'drillmaster', version: '0.3.0' })
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(PLUGIN_TOOLS)
  })

  it("sets a project up, which starts the project's server from the plugin's files, with its viewer", async () => {
    const setup = await client.callTool({
      name: 'workflow_retrospective',
      arguments: { action: 'setup', objective: OBJECTIVE.text, measures: OBJECTIVE.measures, drillmaster_repository: drillmasterRepository, folder: 'installed' },
    })
    expect(setup.isError).toBeFalsy()
    const { url, version } = JSON.parse(await readFile(serverInfoFile(), 'utf8')) as { url: string; version: string }
    expect(version).toBe('0.3.0')
    const viewer = await fetch(`${url}/`)
    expect(viewer.status).toBe(200)
    expect(await viewer.text()).toMatch(/<script type="module" [^>]*src="\/assets\/index-/)
  }, 120_000)

  it("runs its hooks from the plugin's files: the SessionStart brief comes from the project's server", async () => {
    const hooks = JSON.parse(await readFile(path.join(pluginRoot(), 'hooks', 'hooks.json'), 'utf8')) as { hooks: Record<string, { hooks: { command: string }[] }[]> }
    const [node, script, event] = withPluginRoot(hooks.hooks.SessionStart![0]!.hooks[0]!.command).match(/"[^"]+"|\S+/g)!.map((part) => part.replace(/^"|"$/g, ''))
    const brief = await new Promise<string>((resolve) => {
      const hook = spawn(node === 'node' ? process.execPath : node!, [script!, event!], { env: environment() })
      let stdout = ''
      hook.stdout.on('data', (chunk) => (stdout += chunk))
      hook.on('close', () => resolve(stdout))
      hook.stdin.end(JSON.stringify({ session_id: 'installed-1', source: 'startup', hook_event_name: 'SessionStart' }))
    })
    expect(JSON.parse(brief).hookSpecificOutput.additionalContext).toMatch(/Drillmaster runs this project/)
  }, 60_000)
})
