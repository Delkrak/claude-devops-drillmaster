import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { foldState } from '../../src/core/state.js'
import { tempDir } from '../helpers.js'
import { claudeTurn } from '../sim/claude.js'
import { defaultAnswers, listenForOwnerQuestions, OWNER_PERMISSION_TOOL, ownerMcpConfig, type AskedQuestion } from '../sim/ownerAnswers.js'
import { projectId } from '../../src/env.js'

const enabled = process.env.DRILLMASTER_PLUGIN_TESTS === '1'
const REPO = path.resolve(import.meta.dirname, '../../..')
const TOOLS = ['mcp__plugin_devops-drillmaster_drillmaster', 'Read', 'Write', 'Skill']

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
      process.kill((JSON.parse(await readFile(path.join(home.dir, 'daemon.json'), 'utf8')) as { pid: number }).pid)
    } catch {
      // Never started.
    }
    await project?.remove()
    await home?.remove()
  })

  it('sets up workflow_0 through the setup skill', async () => {
    const storeRepo = path.join(home.dir, 'store.git')
    execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', storeRepo])
    await turn(`Set up Drillmaster with the drillmaster setup skill. Objective: ship features without Owner stepping in. Measure: owner_corrections_per_item. Store: the git repo at ${storeRepo}.`)
    expect(foldState(await events()).workflow).toMatchObject({ version: '0.0.0', stages: [], storage: { repo: storeRepo } })
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

  it('decides an Owner gate through AskUserQuestion, and delivers with an image artifact', async () => {
    // A workflow with one Owner-gated step, as if a retrospective had added it.
    const ownerGated = {
      version: '1.0.0',
      objective: { text: 'ship features without Owner stepping in', measures: ['owner_corrections_per_item'] },
      stages: [{ n: 1, name: 'review', purpose: 'Owner accepts the change', steps: [{ n: 1, name: 'Owner approves', instruction: 'Show Owner the file and ask for approval.', gate: 'owner', rules: [], report: ['what to look at'] }] }],
      policies: [],
      metrics: [],
      experiments: [],
    }
    const eventsFile = path.join(home.dir, 'projects', projectId(project.dir), 'events.jsonl')
    await writeFile(eventsFile, (await readFile(eventsFile, 'utf8')) + JSON.stringify({ id: 'ev_plugin_v1', at: new Date().toISOString(), type: 'workflow_changed', workflow: ownerGated, reason: 'an Owner gate' }) + '\n')
    await writeFile(path.join(project.dir, 'shot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
    await turn('Do issue #2 with the drillmaster work skill: create bye.txt containing "bye". At the Owner gate, ask me as the work tool tells you. Then deliver it as pr "local" with shot.png as an artifact, and write your post mortem.')
    const state = foldState(await events())
    const item = Object.values(state.workItems).find((candidate) => candidate.issue.includes('2'))!
    expect(askedOwner.some((question) => question.question.startsWith(`Owner gate of ${item.work_item_id}`))).toBe(true)
    const verdicts = (await events()).filter((e) => e.type === 'gate_verdict' && e.work_item_id === item.work_item_id)
    expect(verdicts).toContainEqual(expect.objectContaining({ by: 'owner', via: 'question', accepted: true }))
    expect(item).toMatchObject({ status: 'delivered', artifacts: [expect.objectContaining({ name: 'shot.png', media_type: 'image/png' })] })
  }, 600_000)
})
