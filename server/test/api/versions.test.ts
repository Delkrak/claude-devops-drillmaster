import { describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { projectId } from '../../src/env.js'
import { VERSION } from '../../src/version.js'
import { seedWorkflow, testPorts, WORKFLOW_3 } from '../helpers.js'

const check = (rule: string) => [{ rule, accepted: true, evidence: 'checked' }]
const textOf = (result: { content: { text: string }[] }) => result.content[0]!.text

async function project(dir: string, script: Record<string, unknown[]> = {}) {
  const ports = testPorts(script)
  await seedWorkflow(ports, dir, WORKFLOW_3)
  const app = new Drillmaster(ports)
  const start = async (args: Record<string, unknown> = {}) => {
    const started = await app.callTool(dir, 'work_start', { issue: '#1', description: 'CSV export', ...args })
    const { agent_token: token, work_item_id: workItemId } = started.structuredContent as { agent_token: string; work_item_id: string }
    await app.hook(dir, 'PostToolUse', { session_id: 's1', tool_name: 'work_start', tool_response: started.content })
    return { started, token, workItemId }
  }
  const item = async (workItemId: string) => (await app.state(dir)).workItems[workItemId]!
  return { app, ports, start, item }
}

describe('versions on every event', () => {
  it('stamps each event with the workflow and Drillmaster versions it was made under', async () => {
    const { app, start } = await project('/projects/versions')
    await start()
    const started = (await app.events('/projects/versions')).find((event) => event.type === 'work_item_started')!
    expect(started).toMatchObject({ workflow_version: '3.0.0', drillmaster_version: VERSION })
  })

  it('refuses to write a project that a newer Drillmaster wrote', async () => {
    const ports = testPorts()
    await seedWorkflow(ports, '/projects/newer', WORKFLOW_3)
    await ports.store.append(projectId('/projects/newer'), { id: 'future', at: '2026-12-01T00:00:00Z', drillmaster_version: '99.0.0', type: 'session_registered', session_id: 'x', source: 'startup' })
    const app = new Drillmaster(ports)
    const refused = await app.callTool('/projects/newer', 'work_start', { issue: '#1', description: 'd' })
    expect(refused).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/newer than this one/) }] })
  })
})

describe('a late start', () => {
  it('skips self gates when Drillmaster finds them met, recorded as skipped, justified', async () => {
    const { start, item, ports } = await project('/projects/late-ok', { late_start: [{ accepted: true, rule: null, why: 'The traces show the tests and the PR text.' }] })
    const { started, workItemId } = await start({ start_at: { stage: 2, step: 1 }, justification: 'done in an earlier session', evidence: 'commit abc, npm test green' })
    expect(textOf(started)).toContain('**Late start approved.** Skipped, justified: work step 1.1, 1.2.')
    expect(await item(workItemId)).toMatchObject({ stage: 2, step: 1, skipped_steps: ['1.1', '1.2'] })
    // Only skipping 1.x: the Owner gate at 2.1 is still ahead, so Owner is not asked.
    expect(ports.reviewer.requests[0]!.prompt).toContain("Agent's evidence: commit abc, npm test green")
  })

  it('starts at the first step when Drillmaster rejects, citing the rule', async () => {
    const { start, item } = await project('/projects/late-no', { late_start: [{ accepted: false, rule: 'test 1.1', why: 'No test run in the traces.' }] })
    const { started, workItemId } = await start({ start_at: { stage: 1, step: 2 }, justification: 'tests ran', evidence: 'trust me' })
    expect(textOf(started)).toContain('**Late start rejected**, citing `test 1.1`: No test run in the traces.')
    expect(await item(workItemId)).toMatchObject({ stage: 1, step: 1, skipped_steps: [] })
  })

  it("asks Owner before skipping Owner's gate, and moves on once Owner approves", async () => {
    const workflow = { ...WORKFLOW_3, stages: [...WORKFLOW_3.stages, { n: 3, name: 'ship', purpose: 'it is out', steps: [{ n: 1, name: 'release', instruction: 'Tag it.', gate: 'self' as const, rules: [], report: [] }] }] }
    const ports = testPorts({ late_start: [{ accepted: true, rule: null, why: 'All met.' }] })
    await seedWorkflow(ports, '/projects/late-owner', workflow)
    const app = new Drillmaster(ports)
    const started = await app.callTool('/projects/late-owner', 'work_start', { issue: '#2', description: 'd', start_at: { stage: 3, step: 1 }, justification: 'Owner reviewed it last week', evidence: 'PR #40 merged' })
    const { work_item_id: workItemId, late_start: lateStart } = started.structuredContent as { work_item_id: string; late_start: { verdict: string; ask_owner: { questions: { question: string }[] } } }
    expect(lateStart.verdict).toBe('awaiting_owner')
    const question = lateStart.ask_owner.questions[0]!.question
    expect(question).toMatch(/skipping 1.1, 1.2, 2.1 and your Owner gate of 2.1\? Agent says: Owner reviewed it last week/)
    await app.hook('/projects/late-owner', 'PreToolUse', { session_id: 's1', tool_name: 'AskUserQuestion', tool_use_id: 'tu', tool_input: { questions: [{ question }] } })
    const decided = await app.hook('/projects/late-owner', 'PostToolUse', { session_id: 's1', tool_name: 'AskUserQuestion', tool_use_id: 'tu', tool_response: { answers: { [question]: 'Approve' } } })
    expect((decided.output as any).hookSpecificOutput.additionalContext).toMatch(/Owner approved the late start/)
    expect((await app.state('/projects/late-owner')).workItems[workItemId]).toMatchObject({ stage: 3, step: 1, skipped_steps: ['1.1', '1.2', '2.1'] })
  })
})

describe('a new workflow version', () => {
  const retro = (ops: unknown[]) => ({
    findings: { should: 's', did: 'd', why: 'w', keep: 'k', improve: 'i' },
    proposals: [{ id: 1, change: 'the change', purpose: 'p', measure: 'owner_corrections_per_item', hypothesis: 'h', ops }],
  })
  const applyApproved = async (app: Drillmaster, dir: string) => {
    await app.callTool(dir, 'workflow_retrospective', { action: 'run' })
    await app.hook(dir, 'UserPromptSubmit', { session_id: 's1', prompt: 'approve 1' })
    return (await app.callTool(dir, 'workflow_retrospective', { action: 'apply' })).structuredContent as { workflow_version: string; restarted: string[] }
  }

  it('restarts an active work item on a major version, and shows what changed', async () => {
    const lint = { op: 'add_step', stage: 1, after: 0, step: { name: 'lint', instruction: 'Run npm run lint.', gate: 'self', rules: [], report: [] } }
    const { app, start, item } = await project('/projects/major', {
      retrospective: [retro([lint])],
      late_start: [{ accepted: true, rule: null, why: 'Lint and tests ran before the restart.' }],
    })
    const { token, workItemId } = await start()
    await app.callTool('/projects/major', 'work_gate', { token, stage: 1, step: 1, self_check: check('test 1.1'), text: 'green' })
    const applied = await applyApproved(app, '/projects/major')
    expect(applied).toMatchObject({ workflow_version: '4.0.0', restarted: [workItemId] })
    expect(await item(workItemId)).toMatchObject({ workflow_version: '4.0.0', stage: 1, step: 1, restarted: { from_version: '3.0.0', to_version: '4.0.0' } })

    const refused = await app.callTool('/projects/major', 'work_gate', { token, stage: 1, step: 2, self_check: check('pr 1.1'), text: 'old position' })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('Workflow 3.0.0 became 4.0.0, a major change, so this work item starts over')
    expect(textOf(refused)).toContain('- new: work step 1.1 "lint" (self gate)')
    expect(textOf(refused)).toContain('## Work step 1.1: lint')

    const skipped = await app.callTool('/projects/major', 'work_skip', { token, start_at: { stage: 1, step: 3 }, justification: 'lint and tests ran before the restart', evidence: 'the traces of 1.1' })
    expect(textOf(skipped)).toContain('Skipped, justified: work step 1.1, 1.2.')
    expect(await item(workItemId)).toMatchObject({ stage: 1, step: 3, restarted: null })
  })

  it('lets an active work item carry on through a minor version, with the new text', async () => {
    const reworded = { op: 'change_step', stage: 1, step: 2, instruction: 'Write the PR description with a What and a Why.' }
    const { app, start, item } = await project('/projects/minor', { retrospective: [retro([reworded])] })
    const { token, workItemId } = await start()
    const applied = await applyApproved(app, '/projects/minor')
    expect(applied).toMatchObject({ workflow_version: '3.1.0', restarted: [] })
    const passed = await app.callTool('/projects/minor', 'work_gate', { token, stage: 1, step: 1, self_check: check('test 1.1'), text: 'green' })
    expect(textOf(passed)).toContain('Write the PR description with a What and a Why.')
    expect(await item(workItemId)).toMatchObject({ workflow_version: '3.0.0', stage: 1, step: 2, restarted: null })
  })
})
