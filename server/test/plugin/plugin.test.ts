import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { foldState } from '../../src/core/state.js'
import { tempDir } from '../helpers.js'
import { claudeTurn } from '../sim/claude.js'

const enabled = process.env.DRILLMASTER_PLUGIN_TESTS === '1'
const REPO = path.resolve(import.meta.dirname, '../../..')
const TOOLS = ['mcp__plugin_devops-drillmaster_drillmaster', 'Read', 'Write', 'Skill']

let home: Awaited<ReturnType<typeof tempDir>>
let project: Awaited<ReturnType<typeof tempDir>>
let env: NodeJS.ProcessEnv
let session: string | undefined

const turn = async (prompt: string) => {
  const t = await claudeTurn({ cwd: project.dir, env, prompt, resume: session, args: ['--plugin-dir', REPO, '--allowedTools', ...TOOLS], timeoutMs: 600_000 })
  session = t.session_id
  return t.result
}
const events = async () => {
  const { url } = JSON.parse(await readFile(path.join(home.dir, 'daemon.json'), 'utf8')) as { url: string }
  return ((await (await fetch(`${url}/state?project=${encodeURIComponent(project.dir)}`)).json()) as { events: DrillmasterEvent[] }).events
}

describe.skipIf(!enabled)('the plugin in real Claude Code', () => {
  beforeAll(async () => {
    home = await tempDir('plugin-home')
    project = await tempDir('plugin-project')
    execFileSync('git', ['init', '-q'], { cwd: project.dir })
    const script = path.join(home.dir, 'reviewer.json')
    await writeFile(script, JSON.stringify({ post_mortem: [{ keep: 'k', change: 'c', experiment_reflections: 'none', free_text: 'scripted' }] }))
    env = { ...process.env, DRILLMASTER_HOME: home.dir, DRILLMASTER_REVIEWER: `scripted:${script}` }
    delete env.CLAUDE_PROJECT_DIR
  })

  afterAll(async () => {
    try {
      process.kill((JSON.parse(await readFile(path.join(home.dir, 'daemon.json'), 'utf8')) as { pid: number }).pid)
    } catch {
      // Never started.
    }
    await project?.remove()
    await home?.remove()
  })

  it('sets up workflow_0 through the setup skill', async () => {
    await turn('Set up Drillmaster with the drillmaster setup skill. Objective: ship features without Owner stepping in. Measure: owner_corrections_per_item.')
    expect(foldState(await events()).workflow).toMatchObject({ version: 0, stages: [] })
  }, 600_000)

  it('runs a work item from start to both post mortems, with every action traced', async () => {
    await turn('Do issue #1 with the drillmaster work skill: create hello.txt containing "hi". Deliver it as pr "local", then write your post mortem.')
    // Drillmaster's post mortem runs in the background; give it a moment.
    let state = foldState(await events())
    for (let i = 0; i < 20 && !Object.values(state.workItems).some((w) => w.post_mortems.length === 2); i++) {
      await new Promise((r) => setTimeout(r, 500))
      state = foldState(await events())
    }
    const item = Object.values(state.workItems)[0]!
    expect(item).toMatchObject({ issue: expect.stringContaining('1'), status: 'delivered', pr: 'local' })
    expect(item.post_mortems.sort()).toEqual(['agent', 'drillmaster'])
    expect(item.sessions).toHaveLength(1)
    // Every action is traced; Agent may write the file just before or after starting the work item.
    const traces = (await events()).filter((e) => e.type === 'work_trace')
    expect(traces.map((t) => (t.type === 'work_trace' ? `${t.hook}:${t.tool ?? ''}` : ''))).toContain('PostToolUse:Write')
    expect(item.traces).toBeGreaterThan(0)
  }, 600_000)
})
