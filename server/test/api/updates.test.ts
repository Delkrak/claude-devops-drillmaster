import { describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import type { UpdateLevel } from '../../src/core/updates.js'
import { migrateWorkflow, type WorkflowDocument } from '../../src/core/workflow.js'
import { VERSION } from '../../src/version.js'
import { ownerAnswers, seedWorkflow, testPorts, WORKFLOW_3 } from '../helpers.js'

const check = (rule: string) => [{ rule, accepted: true, evidence: 'checked' }]
const textOf = (result: { content: { text: string }[] }) => result.content[0]!.text

/** WORKFLOW_3 with an update setting on step 2.1, Owner's review, and any other step changes. */
const withStep21 = (update: UpdateLevel | undefined, extra: (workflow: WorkflowDocument) => void = () => {}) => {
  const workflow = structuredClone(WORKFLOW_3)
  workflow.stages[1]!.steps[0]!.update = update
  extra(workflow)
  return migrateWorkflow(workflow)
}

async function project(dir: string, workflow: WorkflowDocument, script: Record<string, unknown[]> = {}) {
  const ports = testPorts(script)
  await seedWorkflow(ports, dir, workflow)
  const app = new Drillmaster(ports)
  const started = await app.callTool(dir, 'work_start', { issue: '#1', description: 'CSV export' })
  const { agent_token: token, work_item_id: workItemId } = started.structuredContent as { agent_token: string; work_item_id: string }
  await app.hook(dir, 'PostToolUse', { session_id: 's1', tool_name: 'work_start', tool_response: started.content })
  const item = async () => (await app.state(dir)).workItems[workItemId]!
  const gate = (step: string, rules: string[]) => app.callTool(dir, 'work_gate', { token, step, self_check: rules.flatMap(check), text: 'done' })
  const changeWorkflow = async (ops: unknown[]) => {
    ports.reviewer.enqueue('retrospective', { findings: { should: 's', did: 'd', why: 'w', keep: [], improve: [] }, proposals: [{ change: 'the change', purpose: 'p', measure: 'owner_friction_per_item', ops }] })
    await app.callTool(dir, 'workflow_retrospective', { action: 'run' })
    await ownerAnswers(app, dir, () => 'Approve')
    return (await app.callTool(dir, 'workflow_retrospective', { action: 'apply' })).structuredContent as { workflow_version: string; note?: string }
  }
  const status = async () => (await app.callTool(dir, 'work_status', { token })).structuredContent as Record<string, unknown>
  return { app, ports, token, item, gate, changeWorkflow, status }
}

const emailStep = { name: 'send email to stakeholder', instruction: 'Email the stakeholders what is coming.', gate: 'self', rules: [], report: [] }

describe('versions on every event', () => {
  it('stamps each event with the workflow and Drillmaster versions it was made under', async () => {
    const { app } = await project('/projects/versions', WORKFLOW_3)
    const started = (await app.events('/projects/versions')).find((event) => event.type === 'work_item_started')!
    expect(started).toMatchObject({ workflow_version: '3.0.0', drillmaster_version: VERSION })
  })

})

describe('updating a work item at a step that allows it', () => {
  it('keeps an open work item on its version until a step allows an update', async () => {
    const { gate, changeWorkflow, item } = await project('/projects/stays', withStep21(undefined))
    await gate('1.1', ['test 1.1'])
    const applied = await changeWorkflow([{ op: 'add_step', stage: '1', step: emailStep }])
    expect(applied).toMatchObject({ workflow_version: '4.0.0', note: expect.stringMatching(/stay on their workflow version/) })
    await gate('1.2', ['pr 1.1'])
    expect(await item()).toMatchObject({ workflow_version: '3.0.0', stage: 2, step: 1, last_update: null })
  })

  it('fast-forwards past the unchanged steps to the new one: no re-approval for an added step', async () => {
    const { gate, changeWorkflow, item, status } = await project('/projects/added', withStep21('minor'))
    await gate('1.1', ['test 1.1'])
    await changeWorkflow([{ op: 'add_step', stage: '1', step: emailStep }])
    const passed = await gate('1.2', ['pr 1.1'])
    expect(passed.structuredContent).toMatchObject({ verdict: 'accepted', next: { stage: 1, step: 3 }, update: { from_version: '3.0.0', to_version: '4.0.0', kept: ['1.1', '1.2'] } })
    expect(textOf(passed)).toContain('**The work item updated from workflow 3.0.0 to 4.0.0**')
    expect(textOf(passed)).toContain('- new: step 1.3 "send email to stakeholder" (self gate)')
    expect(textOf(passed)).toContain('## Work step 1.3: send email to stakeholder')
    expect(await item()).toMatchObject({ workflow_version: '4.0.0', stage: 1, step: 3, last_update: { from_version: '3.0.0', to_version: '4.0.0' } })
    expect(await status()).toMatchObject({ passed_steps: ['1.1', '1.2'] })
    expect((await gate('1.3', [])).structuredContent).toMatchObject({ verdict: 'accepted', next: { stage: 2, step: 1 } })
  })

  it('goes back to the first step that changed, even before where it was', async () => {
    const { gate, changeWorkflow, item } = await project('/projects/back', withStep21('minor'))
    await gate('1.1', ['test 1.1'])
    await changeWorkflow([{ op: 'change_step', step: '1.1', instruction: 'Run npm test, and paste the summary line.' }])
    const passed = await gate('1.2', ['pr 1.1'])
    expect(passed.structuredContent).toMatchObject({ next: { stage: 1, step: 1 }, update: { to_version: '3.1.0', kept: [] } })
    expect(textOf(passed)).toContain('- changed: step 1.1 "run the tests"')
    expect(await item()).toMatchObject({ workflow_version: '3.1.0', stage: 1, step: 1, passed_step_guids: [] })
  })

  it('updates only when the newer version is at least the level the step names', async () => {
    const { gate, changeWorkflow, item } = await project('/projects/level', withStep21('major'))
    await gate('1.1', ['test 1.1'])
    await changeWorkflow([{ op: 'change_stage', stage: '2', purpose: 'Owner accepts the change, with the PR open' }])
    await gate('1.2', ['pr 1.1'])
    expect(await item()).toMatchObject({ workflow_version: '3.0.0', stage: 2, step: 1 })
  })

  it('counts a skipped step as done, as long as it is unchanged', async () => {
    const workflow = withStep21('minor', (draft) => {
      draft.stages[0]!.steps[1]!.skippable = 'self'
    })
    const { app, token, gate, changeWorkflow, item } = await project('/projects/skipped', workflow)
    await gate('1.1', ['test 1.1'])
    await changeWorkflow([{ op: 'add_step', stage: '1', step: emailStep }])
    const skipped = await app.callTool('/projects/skipped', 'work_skip', { token, step: '1.2', why: 'a docs-only change has no PR description to write' })
    expect(skipped.structuredContent).toMatchObject({ skip: 'accepted', by: 'agent', next: { stage: 1, step: 3 }, update: { kept: ['1.1', '1.2'] } })
    expect(await item()).toMatchObject({ workflow_version: '4.0.0', stage: 1, step: 3 })
  })
})

describe('skipping a skippable step', () => {
  const skippable = (decider: 'self' | 'drillmaster' | 'owner') =>
    withStep21(undefined, (draft) => {
      draft.stages[0]!.steps[1]!.skippable = decider
    })

  it("skips at once when it is Agent's to decide, and refuses a step that isn't skippable or isn't the current one", async () => {
    const { app, token, gate, item, status } = await project('/projects/skip-self', skippable('self'))
    expect(textOf(await app.callTool('/projects/skip-self', 'work_skip', { token, step: '1.1', why: 'x' }))).toMatch(/Step 1.1 "run the tests" is not skippable/)
    expect(textOf(await app.callTool('/projects/skip-self', 'work_skip', { token, step: '1.2', why: 'x' }))).toMatch(/Only the step you are at can be skipped/)
    await gate('1.1', ['test 1.1'])
    const first = (await app.callTool('/projects/skip-self', 'work_gate', { token, step: '1.1', self_check: check('test 1.1'), text: 'done' })).content[0]!.text
    expect(first).toMatch(/at work step 1.2, not 1.1/)
    const skipped = await app.callTool('/projects/skip-self', 'work_skip', { token, step: '1.2', why: 'no PR for a config change' })
    expect(textOf(skipped)).toContain('**Skipped** step 1.2 (agent): no PR for a config change')
    expect(textOf(skipped)).toContain('## Work step 2.1: Owner approves')
    expect(await item()).toMatchObject({ stage: 2, step: 1 })
    expect(await status()).toMatchObject({ skipped_steps: ['1.2'], passed_steps: ['1.1'] })
  })

  it("asks Drillmaster when the step says so, and does the step when it's rejected", async () => {
    const { app, token, gate, item, ports } = await project('/projects/skip-dm', skippable('drillmaster'), { skip: [{ accepted: false, why: 'This change touches the export, so the PR needs a description.' }] })
    await gate('1.1', ['test 1.1'])
    const rejected = await app.callTool('/projects/skip-dm', 'work_skip', { token, step: '1.2', why: 'small change' })
    expect(rejected.structuredContent).toMatchObject({ skip: 'rejected', by: 'drillmaster' })
    expect(textOf(rejected)).toContain('Do the step.')
    expect(ports.reviewer.requests.find((request) => request.kind === 'skip')!.prompt).toContain("Agent's reason: small change")
    expect(await item()).toMatchObject({ stage: 1, step: 2, skipped_step_guids: [] })
  })

  it('asks Owner when the step says so, and moves on once Owner approves', async () => {
    const { app, token, gate, item } = await project('/projects/skip-owner', skippable('owner'))
    await gate('1.1', ['test 1.1'])
    const pending = await app.callTool('/projects/skip-owner', 'work_skip', { token, step: '1.2', why: 'Owner writes the PR text' })
    expect(pending.structuredContent).toMatchObject({ skip: 'pending', decided_by: 'owner', ask_owner: { questions: [expect.objectContaining({ header: 'Skip step' })] } })
    expect(textOf(await gate('1.2', ['pr 1.1']))).toMatch(/waits for Owner's decision/)
    expect(await ownerAnswers(app, '/projects/skip-owner', () => 'Approve')).toMatch(/Owner approved skipping step 1.2\. Next: step 2.1/)
    expect(await item()).toMatchObject({ stage: 2, step: 1, pending_skip: null })
  })
})
