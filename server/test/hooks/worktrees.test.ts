import { execFileSync, spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DotDrillmasterResolver, projectKey } from '../../src/adapters/projects.js'
import { Drillmaster } from '../../src/app.js'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { listen, type RunningServer } from '../../src/daemon/http.js'
import { projectToServe } from '../../src/projectLocator.js'
import { OBJECTIVE, TEST_REPOSITORY, tempDir, testPorts } from '../helpers.js'

// Two git worktrees of one repository, each with its own Claude session and work item, run through
// the real hook script against one server: the project is the repository's committed .drillmaster,
// not the folder.

const HOOK = path.resolve(import.meta.dirname, '../../../scripts/hook.mjs')
const PLACE = { url: TEST_REPOSITORY, folder: 'worktrees' }
const WORK_START_TOOL = 'mcp__plugin_devops-drillmaster_drillmaster__work_start'

let server: RunningServer
let home: Awaited<ReturnType<typeof tempDir>>
let root: Awaited<ReturnType<typeof tempDir>>
let mainWorktree: string
let secondWorktree: string

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' })

function runHook(projectDir: string, event: string, payload: unknown) {
  return new Promise<number | null>((resolve) => {
    const child = spawn(process.execPath, [HOOK, event], { env: { ...process.env, DRILLMASTER_HOME: home.dir, CLAUDE_PROJECT_DIR: projectDir } })
    child.on('close', resolve)
    child.stdin.end(JSON.stringify(payload))
  })
}

const post = async (route: string, body: unknown) =>
  (await fetch(`${server.url}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<Record<string, any>>
const eventsSeenFrom = async (projectDir: string) =>
  ((await (await fetch(`${server.url}/state?project=${encodeURIComponent(projectDir)}&idle=1`)).json()) as { events: DrillmasterEvent[] }).events

/** One session's work in one worktree: it starts, takes up its work item, and edits a file there. */
async function workIn(projectDir: string, sessionId: string, issue: string) {
  expect(await runHook(projectDir, 'SessionStart', { session_id: sessionId, source: 'startup' })).toBe(0)
  expect(await runHook(projectDir, 'UserPromptSubmit', { session_id: sessionId, prompt: `do ${issue}` })).toBe(0)
  const started = await post('/tools/call', { project: projectDir, name: 'work_start', arguments: { issue, description: `the work of ${issue}` } })
  expect(await runHook(projectDir, 'PostToolUse', { session_id: sessionId, tool_name: WORK_START_TOOL, tool_response: started.content })).toBe(0)
  return async () => {
    expect(await runHook(projectDir, 'PostToolUse', { session_id: sessionId, tool_name: 'Edit', tool_input: { file_path: path.join(projectDir, 'src', `${issue.slice(1)}.js`) }, tool_response: {} })).toBe(0)
  }
}

beforeAll(async () => {
  home = await tempDir('worktrees-home')
  root = await tempDir('worktrees-repo')
  mainWorktree = path.join(root.dir, 'main')
  secondWorktree = path.join(root.dir, 'second')
  await mkdir(mainWorktree)
  git(mainWorktree, 'init', '-q', '-b', 'main')
  await writeFile(path.join(mainWorktree, '.drillmaster'), JSON.stringify({ drillmaster_repository: PLACE.url, folder: PLACE.folder }, null, 2) + '\n')
  git(mainWorktree, 'add', '.drillmaster')
  git(mainWorktree, 'commit', '-q', '-m', 'link the project to Drillmaster')
  git(mainWorktree, 'worktree', 'add', '-q', '-b', 'second', secondWorktree)

  const key = projectKey(PLACE)
  server = await listen(new Drillmaster({ ...testPorts(), projects: new DotDrillmasterResolver() }), 0, key)
  await mkdir(path.join(home.dir, 'projects', key), { recursive: true })
  await writeFile(path.join(home.dir, 'projects', key, 'daemon.json'), JSON.stringify({ port: server.port, pid: process.pid, url: server.url }))
  await post('/projects/init', { project: mainWorktree, drillmaster_repository: PLACE.url, folder: PLACE.folder, objective: OBJECTIVE })
}, 60_000)

afterAll(async () => {
  await server.close()
  await home.remove()
  await root.remove()
})

describe('two git worktrees of one project', () => {
  it('are one project, with one server and one history', () => {
    expect(projectToServe(mainWorktree)?.key).toBe(projectKey(PLACE))
    expect(projectToServe(secondWorktree)?.key).toBe(projectKey(PLACE))
  })

  it('keep the work of a session in each apart, though they run side by side', async () => {
    const editInMain = await workIn(mainWorktree, 'session-main', '#1')
    const editInSecond = await workIn(secondWorktree, 'session-second', '#2')
    await editInSecond()
    await editInMain()

    const events = await eventsSeenFrom(secondWorktree)
    expect(events).toEqual(await eventsSeenFrom(mainWorktree))
    const workItemOf = (issue: string) => events.find((event) => event.type === 'work_item_started' && event.issue === issue)! as { work_item_id: string }
    const idOf = (issue: string) => workItemOf(issue).work_item_id
    const bound = events.flatMap((event) => (event.type === 'session_bound' ? [[event.session_id, event.work_item_id]] : []))
    expect(bound).toEqual([
      ['session-main', idOf('#1')],
      ['session-second', idOf('#2')],
    ])
    const editsBy = (worktree: string) => events.filter((event) => event.type === 'work_trace' && event.tool === 'Edit' && event.input?.includes(path.basename(worktree)))
    expect(editsBy(mainWorktree).map((event) => (event as { work_item_id: string }).work_item_id)).toEqual([idOf('#1')])
    expect(editsBy(secondWorktree).map((event) => (event as { work_item_id: string }).work_item_id)).toEqual([idOf('#2')])
  }, 60_000)
})
