import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { foldState } from '../../src/core/state.js'
import { tempDir } from '../helpers.js'
import { claudeTurn } from '../sim/claude.js'
import { defaultAnswers, listenForOwnerQuestions, OWNER_PERMISSION_TOOL, ownerMcpConfig, type AskedQuestion } from '../sim/ownerAnswers.js'
import { DotDrillmasterResolver } from '../../src/adapters/projects.js'
import { projectServerInfoFile } from '../../src/projectLocator.js'

const enabled = process.env.DRILLMASTER_PLUGIN_TESTS === '1'
const REPO = path.resolve(import.meta.dirname, '../../..')
const TOOLS = ['mcp__plugin_devops-drillmaster_drillmaster', 'Read', 'Write', 'Skill', 'Bash(cat:*)']

let home: Awaited<ReturnType<typeof tempDir>>
let project: Awaited<ReturnType<typeof tempDir>>
let env: NodeJS.ProcessEnv
let session: string | undefined
let ownerEndpoint: Awaited<ReturnType<typeof listenForOwnerQuestions>>
const askedOwner: AskedQuestion[] = []

const turn = async (prompt: string) => {
  const mcpConfig = path.join(home.dir, 'owner-mcp.json')
  const t = await claudeTurn({
    cwd: project.dir,
    env,
    prompt,
    resume: session,
    args: ['--plugin-dir', REPO, '--mcp-config', mcpConfig, '--permission-prompt-tool', OWNER_PERMISSION_TOOL, '--allowedTools', ...TOOLS],
    timeoutMs: 600_000,
  })
  session = t.session_id
  return t.result
}
/** The project's own server, announced in its folder of the Drillmaster home. */
const serverInfo = async () => JSON.parse(await readFile(projectServerInfoFile(new DotDrillmasterResolver().resolve(project.dir)!.key, env), 'utf8')) as { url: string; pid: number }
const events = async () => {
  const { url } = await serverInfo()
  return ((await (await fetch(`${url}/state?project=${encodeURIComponent(project.dir)}`)).json()) as { events: DrillmasterEvent[] }).events
}

describe.skipIf(!enabled)('the plugin in real Claude Code', () => {
  beforeAll(async () => {
    home = await tempDir('plugin-home')
    project = await tempDir('plugin-project')
    execFileSync('git', ['init', '-q'], { cwd: project.dir })
    const script = path.join(home.dir, 'reviewer.json')
    await writeFile(script, JSON.stringify({ post_mortem: [{ keep: 'k', change: 'c', experiment_reflections: 'none', free_text: 'scripted' }, { keep: 'k2', change: 'c2', experiment_reflections: 'none', free_text: 'scripted' }] }))
    env = { ...process.env, DRILLMASTER_HOME: home.dir, DRILLMASTER_REVIEWER: `scripted:${script}` }
    delete env.CLAUDE_PROJECT_DIR
    ownerEndpoint = await listenForOwnerQuestions(async (questions) => {
      askedOwner.push(...questions)
      return defaultAnswers(questions)
    })
    await writeFile(path.join(home.dir, 'owner-mcp.json'), JSON.stringify(ownerMcpConfig(ownerEndpoint.url)))
  })

  afterAll(async () => {
    ownerEndpoint?.close()
    try {
      process.kill((await serverInfo()).pid)
    } catch {
      // Never started.
    }
    await project?.remove()
    await home?.remove()
  })

  it('sets up workflow_0 through the setup skill, which writes .drillmaster', async () => {
    const drillmasterRepository = path.join(home.dir, 'drillmaster.git')
    execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', drillmasterRepository])
    await turn(`Set up Drillmaster with the drillmaster setup skill. Objective: ship features without Owner stepping in. Measure: owner_friction_per_item. The Drillmaster repository: ${drillmasterRepository}.`)
    expect(JSON.parse(await readFile(path.join(project.dir, '.drillmaster'), 'utf8'))).toMatchObject({ drillmaster_repository: drillmasterRepository })
    expect(foldState(await events()).workflow).toMatchObject({ version: '0.0.0', stages: [] })
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
    const traced = traces.map((t) => (t.type === 'work_trace' ? `${t.hook}:${t.tool ?? ''}` : ''))
    expect(traced.some((entry) => entry === 'PostToolUse:Write' || entry === 'PostToolUse:Bash'), traced.join(' ')).toBe(true)
    expect(item.traces).toBeGreaterThan(0)
  }, 600_000)

  it('decides an Owner gate in AskUserQuestion with what Owner approves beside it, captures a command, and delivers with an image artifact', async () => {
    // A workflow with one Owner-gated step and a tool capture, as if a retrospective had added them.
    const ownerGated = {
      version: '1.0.0',
      objective: { text: 'ship features without Owner stepping in', measures: ['owner_friction_per_item'] },
      stages: [{ n: 1, name: 'review', purpose: 'Owner accepts the change', steps: [{ n: 1, name: 'Owner approves', instruction: 'Show the file with cat, then ask Owner for approval.', gate: 'owner', rules: [], report: ['what to look at'] }] }],
      policies: [],
      inputs: [],
      tool_captures: [{ name: 'file', command: 'cat bye', keep: '| line_format `content: {{__line__}}`' }],
      experiments: [],
    }
    const eventsFile = path.join(home.dir, 'projects', new DotDrillmasterResolver().resolve(project.dir)!.key, 'events.jsonl')
    await writeFile(eventsFile, (await readFile(eventsFile, 'utf8')) + JSON.stringify({ id: 'ev_plugin_v1', at: new Date().toISOString(), type: 'workflow_changed', workflow: ownerGated, reason: 'an Owner gate' }) + '\n')
    await writeFile(path.join(project.dir, 'shot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
    await turn('Do issue #2 with the drillmaster work skill: create bye.txt containing "bye", and show it with cat bye.txt. At the Owner gate, ask me as the work tool tells you. Then deliver it as pr "local" with shot.png as an artifact, and write your post mortem.')
    const state = foldState(await events())
    const item = Object.values(state.workItems).find((candidate) => candidate.issue.includes('2'))!
    const gateQuestion = askedOwner.find((question) => question.question.startsWith(`Owner gate of ${item.work_item_id}`))
    expect(gateQuestion?.options[0]?.preview).toContain('## What Agent reports')
    const captured = (await events()).filter((e) => e.type === 'work_trace' && e.captures?.length)
    // Agent may run more in the same call, so the capture keeps at least the file's line.
    expect(captured).toContainEqual(expect.objectContaining({ captures: [expect.objectContaining({ name: 'file', lines: expect.arrayContaining(['content: bye']) })] }))
    const verdicts = (await events()).filter((e) => e.type === 'gate_verdict' && e.work_item_id === item.work_item_id)
    expect(verdicts).toContainEqual(expect.objectContaining({ by: 'owner', via: 'question', accepted: true }))
    expect(item).toMatchObject({ status: 'delivered', artifacts: [expect.objectContaining({ name: 'shot.png', media_type: 'image/png' })] })
  }, 600_000)

  it('takes a work item up again in a fresh session, with work_resume', async () => {
    await turn('Start issue #3 "add a LICENSE file" with the drillmaster work skill, and stop right after work_start: do no work on it today.')
    session = undefined
    await turn('Take up issue #3 again with work_resume (the issue as it was started), check work_status, and stop there.')
    const item = Object.values(foldState(await events()).workItems).find((candidate) => candidate.issue.includes('3'))!
    expect(item).toMatchObject({ resumed: 1, status: 'active' })
    expect(item.sessions).toHaveLength(2)
  }, 600_000)
})
