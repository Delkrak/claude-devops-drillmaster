import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ScriptedReviewer } from '../../src/adapters/reviewers.js'
import { Drillmaster } from '../../src/app.js'
import { listen, type RunningServer } from '../../src/daemon/http.js'
import { ownerAnswers, TEST_REPOSITORY, testPorts, workToolCall } from '../helpers.js'

let app: Drillmaster
let server: RunningServer
let reviewer: ScriptedReviewer
const PROJECT = '/projects/retro'
const SESSION = 'retro-session'

const post = async (route: string, body: unknown) => {
  const res = await fetch(`${server.url}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return (await res.json()) as any
}
const tool = async (name: string, args: unknown) => {
  const body = await post('/tools/call', { project: PROJECT, ...workToolCall(name, args as Record<string, unknown>) })
  return { isError: body.isError === true, value: body.isError ? body.content[0].text : body.structuredContent, text: body.content[0].text as string }
}
const hook = (event: string, payload: Record<string, unknown>) => post(`/hooks/${event}`, { project: PROJECT, payload: { session_id: SESSION, ...payload } })
const state = async () => (await (await fetch(`${server.url}/state?project=${encodeURIComponent(PROJECT)}`)).json()) as any

const testRule = { id: '1.1', rule: 'the tests run green before a PR', verified_by: 'the test output' }

beforeAll(async () => {
  const ports = testPorts({
    post_mortem: [{ keep: 'Owner saw the PR', change: 'Owner had to ask for the tests', experiment_reflections: 'none running', free_text: '' }],
    retrospective: [
      {
        findings: { should: 'tests run before the PR', did: 'Owner had to ask', why: 'no step asks for it', keep: 'small PRs', improve: 'add a test step' },
        proposals: [
          {
            id: 1,
            change: 'add a build stage whose first step runs the tests',
            purpose: 'Owner corrected missing test runs',
            measure: 'owner_friction_per_item',
            hypothesis: 'A test step means Owner stops asking for tests',
            target: 0,
            judge_after: 2,
            ops: [
              { op: 'add_policy', name: 'test', rules: [testRule] },
              { op: 'add_stage', name: 'build', purpose: 'the change works', steps: [{ name: 'run the tests', instruction: 'Run npm test and fix what is red.', gate: 'self', rules: ['test 1.1'], report: ['test result'] }] },
            ],
          },
          { id: 2, change: 'measure time too', purpose: 'see speed', measure: 'minutes_per_item', ops: [{ op: 'set_objective', measures: ['owner_friction_per_item', 'minutes_per_item'] }] },
          { id: 3, change: 'broken', purpose: 'x', measure: 'minutes_per_item', ops: [{ op: 'remove_stage', stage: 9 }] },
        ],
      },
    ],
  })
  reviewer = ports.reviewer
  app = new Drillmaster(ports)
  server = await listen(app)
})
afterAll(() => server.close())

describe('the improvement loop', () => {
  let token: string

  it("sets workflow_0 from Owner's objective, once", async () => {
    const setup = await tool('workflow_retrospective', { action: 'setup', drillmaster_repository: TEST_REPOSITORY, objective: 'ship features without Owner stepping in', measures: ['owner_friction_per_item'] })
    expect(setup.value.workflow).toMatchObject({ version: '0.0.0', stages: [] })
    expect((await tool('workflow_retrospective', { action: 'setup', drillmaster_repository: TEST_REPOSITORY, objective: 'again', measures: ['minutes_per_item'] })).isError).toBe(true)
  })

  it('runs a work item that Owner has to correct', async () => {
    await hook('SessionStart', { source: 'startup' })
    await hook('UserPromptSubmit', { prompt: 'add CSV export (issue #1)' })
    const started = await tool('work_report', { action: 'start', issue: '#1' })
    token = started.value.agent_token
    await hook('PostToolUse', { tool_name: 'mcp__x__work_start', tool_input: { issue: '#1' }, tool_response: { work_item_id: started.value.work_item_id } })
    await hook('UserPromptSubmit', { prompt: 'you never ran the tests' })
    await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } })
    expect((await tool('work_report', { token, action: 'deliver', pr: '#2' })).value).toMatchObject({ pr: '#2' })
    const unknownRef = await tool('work_report', { token, action: 'post_mortem', keep: [{ refs: ['step 1.1'], text: 'x' }], change: [], experiment_reflections: [] })
    expect(unknownRef.value).toBe('There is no step 1.1 in workflow 0.0.0.')
    const pm = await tool('work_report', { token, action: 'post_mortem', keep: [{ refs: [], text: 'small PR' }], change: [{ refs: ['tool work_report'], text: 'a step for tests' }], experiment_reflections: [] })
    expect(pm.value).toMatchObject({ recorded: 'post_mortem' })
    await app.idle()
    const pms = (await state()).events.filter((e: any) => e.type === 'post_mortem_written').map((e: any) => e.author)
    expect(pms.sort()).toEqual(['agent', 'drillmaster'])
  })

  it('shows the measures in the workflow overview', async () => {
    const overview = await tool('workflow_get', {})
    expect(overview.value.measures.owner_friction_per_item).toEqual({ last_5: 1, all: 1, delivered: 1 })
  })

  it("runs the retrospective from the post mortems and Owner's corrections, dropping proposals that would not apply", async () => {
    const retro = await tool('workflow_retrospective', { action: 'run' })
    expect(retro.value.findings.improve).toEqual([{ refs: [], text: 'add a test step' }])
    expect(retro.value.proposals.map((p: any) => p.id)).toEqual([1, 2])
    expect(retro.value.dropped).toEqual([{ change: 'broken', error: 'There is no stage 9 in workflow 0.0.0.' }])
    const prompt = reviewer.requests.find((r) => r.kind === 'retrospective')!.prompt
    expect(prompt).toContain('"you never ran the tests"')
    expect(prompt).toContain('Owner had to ask for the tests')
  })

  it('refuses to apply until Owner approves in AskUserQuestion, and takes a note as a decline', async () => {
    expect((await tool('workflow_retrospective', { action: 'apply', proposal: 1 })).value).toMatch(/has not approved/)
    expect((await hook('UserPromptSubmit', { prompt: 'approve 1' })).output).toBeUndefined()
    const decided = await ownerAnswers(app, PROJECT, (question) => (question.startsWith('Proposal 1') ? 'Approve' : { answer: 'Approve', notes: 'only if it is cheap' }), SESSION)
    expect(decided).toMatch(/approved proposal 1.*declined proposal 2 \("only if it is cheap"\)/)
    expect((await tool('workflow_retrospective', { action: 'apply', proposal: 2 })).value).toMatch(/declined/)
  })

  it('applies the approved proposal as a workflow experiment with its baseline', async () => {
    const applied = await tool('workflow_retrospective', { action: 'apply', proposal: 1 })
    expect(applied.value).toMatchObject({
      workflow_version: '1.0.0',
      applied: [
        {
          proposal: 1,
          level: 'major',
          experiment: { id: 1, measure: 'owner_friction_per_item', baseline: 1, purpose: 'Owner corrected missing test runs', target: 0, judge_after: 2, version: '1.0.0' },
        },
      ],
    })
    expect((await tool('workflow_retrospective', { action: 'apply', proposal: 1 })).value).toMatch(/already applied/)
    const stage = await tool('workflow_get', { stage: 1 })
    expect(stage.value.steps[0]).toMatchObject({ n: '1.1', name: 'run the tests', instruction: 'Run npm test and fix what is red.', gate: 'self' })
    expect((await tool('workflow_get', { version: '0.0.0', full: true })).value.workflow.stages).toEqual([])
    expect((await tool('workflow_get', { version: 0, full: true })).value.workflow.stages).toEqual([])
  })

  it('starts the next work item on the new workflow', async () => {
    const next = await tool('work_report', { action: 'start', issue: '#3' })
    expect(next.value).toMatchObject({ stage: 1, step: 1, workflow_version: '1.0.0' })
    expect(next.text).toContain('## Work step 1.1: run the tests')
    expect(next.text).toContain('Run npm test and fix what is red.')
    expect(next.text).toContain('`test 1.1`: the tests run green before a PR. Verified by: the test output.')
  })
})
