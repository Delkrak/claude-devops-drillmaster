import { describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { migrateWorkflow, type WorkflowDocument } from '../../src/core/workflow.js'
import { ownerAnswers, seedWorkflow, testPorts, OBJECTIVE } from '../helpers.js'

const textOf = (result: { content: { text: string }[] }) => result.content[0]!.text
const option = (value: string) => ({ value, description: `a ${value}` })
const step = (n: number, name: string, extra: Record<string, unknown> = {}) => ({ n, name, instruction: `Do: ${name}.`, gate: 'self', rules: [], report: [], ...extra })

/** Capture, refine only for features, and build with a step only for bugs and one for features or what users see. */
const PIPELINE: WorkflowDocument = migrateWorkflow({
  version: '1.0.0',
  objective: { text: OBJECTIVE.text, measures: ['owner_friction_per_item'] },
  stages: [
    { n: 1, name: 'capture', purpose: 'everyone knows what is wrong or wanted', steps: [step(1, 'write down what is wrong or wanted')] },
    { n: 2, name: 'refine', purpose: 'a feature has a spec', if: "kind == 'feature'", steps: [step(1, 'write the spec')] },
    {
      n: 3,
      name: 'build',
      purpose: 'the change works',
      steps: [step(1, 'reproduce the bug with a failing test', { if: "kind == 'bug'" }), step(2, 'write the code'), step(3, 'document it', { if: "kind == 'feature' || user_visible == 'yes'", update: 'major' })],
    },
  ],
  policies: [],
  inputs: [
    { name: 'kind', options: [option('bug'), option('feature')], set_at: 'start', by: 'agent', instruction: 'Is it a bug or a feature?' },
    { name: 'user_visible', options: [option('yes'), option('no')], set_at: '1.1', by: 'agent', instruction: 'Do users see the change?' },
  ],
  experiments: [],
})

async function project(dir: string, workflow = PIPELINE) {
  const ports = testPorts()
  await seedWorkflow(ports, dir, workflow)
  const app = new Drillmaster(ports)
  const tool = (name: string, args: Record<string, unknown>) => app.callTool(dir, name, args)
  const start = async (inputs?: unknown[]) => {
    const started = await tool('work_start', { issue: '#1', description: 'the work item', ...(inputs ? { inputs } : {}) })
    const { agent_token: token, work_item_id: workItemId } = (started.structuredContent ?? {}) as { agent_token: string; work_item_id: string }
    return { started, token, item: async () => (await app.state(dir)).workItems[workItemId]! }
  }
  const gate = (token: string, at: string, inputs?: unknown[]) => tool('work_gate', { token, step: at, self_check: [], text: 'done', ...(inputs ? { inputs } : {}) })
  return { app, ports, tool, start, gate }
}

describe('steps and stages that apply by the work item inputs', () => {
  it("can't start without Agent's start inputs", async () => {
    const { start } = await project('/projects/if-start')
    expect(textOf((await start()).started)).toMatch(/Work can't go on without input "kind": set it in work_start \(inputs\)\. Is it a bug or a feature\? Pick one of: bug, feature\./)
    expect(textOf((await start([{ name: 'kind', value: 'chore' }])).started)).toMatch(/Pick one of: bug, feature/)
  })

  it('takes a feature through refine, past the bug step, to its documentation', async () => {
    const { start, gate } = await project('/projects/if-feature')
    const { started, token, item } = await start([{ name: 'kind', value: 'feature' }])
    expect(textOf(started)).toContain('## Work step 1.1: write down what is wrong or wanted')
    expect(textOf(await gate(token, '1.1'))).toMatch(/Work can't go on without input "user_visible": set it with the gate of step 1\.1/)
    expect((await gate(token, '1.1', [{ name: 'user_visible', value: 'no' }])).structuredContent).toMatchObject({ next: { stage: 2, step: 1 } })
    const refined = await gate(token, '2.1')
    expect(refined.structuredContent).toMatchObject({
      next: { stage: 3, step: 2 },
      skipped_by_condition: [{ step: '3.1', why: 'step 3.1 "reproduce the bug with a failing test" applies only when kind == \'bug\', and kind is feature.' }],
    })
    expect(textOf(refined)).toContain('- Skipped step 3.1: step 3.1 "reproduce the bug with a failing test" applies only when')
    expect(textOf(refined)).toContain('## Work step 3.2: write the code')
    expect((await gate(token, '3.2')).structuredContent).toMatchObject({ next: { stage: 3, step: 3 } })
    expect((await gate(token, '3.3')).structuredContent).toMatchObject({ done: true })
    expect(await item()).toMatchObject({ inputs: { kind: { value: 'feature' }, user_visible: { value: 'no' } }, condition_skipped_step_guids: [PIPELINE.stages[2]!.steps[0]!.guid] })
  })

  it('takes a bug past the whole refine stage, and past documentation users do not see', async () => {
    const { start, gate, tool } = await project('/projects/if-bug')
    const { token, item } = await start([{ name: 'kind', value: 'bug' }])
    const captured = await gate(token, '1.1', [{ name: 'user_visible', value: 'no' }])
    expect(captured.structuredContent).toMatchObject({ next: { stage: 3, step: 1 }, skipped_by_condition: [{ step: '2.1', why: expect.stringContaining('stage 2 "refine" applies only when kind == \'feature\', and kind is bug') }] })
    expect(textOf(await tool('work_skip', { token, step: '2.1', why: 'not needed' }))).toMatch(/at work step 3\.1/)
    await gate(token, '3.1')
    expect((await gate(token, '3.2')).structuredContent).toMatchObject({ done: true, skipped_by_condition: [{ step: '3.3' }] })
    expect((await item()).skipped_step_guids).toHaveLength(2)
  })

  it('goes back to a skipped step that applies once Agent changes an input, keeping the steps before it', async () => {
    const { start, gate, tool } = await project('/projects/if-change')
    const { token, item } = await start([{ name: 'kind', value: 'feature' }])
    await gate(token, '1.1', [{ name: 'user_visible', value: 'no' }])
    await gate(token, '2.1')
    expect(textOf(await tool('work_input', { token, name: 'kind', value: 'feature', why: 'same' }))).toMatch(/is feature already/)
    expect(textOf(await tool('work_input', { token, name: 'size', value: 'x', why: 'w' }))).toMatch(/has no input "size"; its inputs are kind, user_visible/)
    const changed = await tool('work_input', { token, name: 'kind', value: 'bug', why: 'the tests show existing behaviour is wrong' })
    expect(changed.structuredContent).toMatchObject({ input: 'kind', value: 'bug', goes_back_to: '3.1', next: { stage: 3, step: 1 } })
    expect(textOf(changed)).toContain('Step 3.1 applies to the work item now, so it goes back there')
    expect(textOf(changed)).toContain('## Work step 3.1: reproduce the bug with a failing test')
    const [capture, refine] = [PIPELINE.stages[0]!.steps[0]!.guid, PIPELINE.stages[1]!.steps[0]!.guid]
    expect(await item()).toMatchObject({ stage: 3, step: 1, passed_step_guids: [capture, refine], condition_skipped_step_guids: [], inputs: { kind: { value: 'bug', by: 'agent', explanation: 'the tests show existing behaviour is wrong' } } })
    await gate(token, '3.1')
    expect((await gate(token, '3.2')).structuredContent).toMatchObject({ done: true, skipped_by_condition: [{ step: '3.3' }] })
  })

  it("waits at a step whose if reads Owner's input until Owner sets it", async () => {
    const withRisk = migrateWorkflow({
      ...PIPELINE,
      stages: [{ ...PIPELINE.stages[0]!, steps: [PIPELINE.stages[0]!.steps[0]!, step(2, 'review the risk', { if: "risk == 'high'" }), step(3, 'say what changed')] }],
      inputs: [{ guid: 'guid-risk', name: 'risk', options: [option('low'), option('high')], set_at: 'start', by: 'owner', instruction: 'How risky is it?' }],
    })
    const { app, start, gate } = await project('/projects/if-owner', withRisk)
    const { started, token, item } = await start()
    expect(started.structuredContent).toMatchObject({ ask_owner: { questions: [expect.objectContaining({ question: 'Input "risk" for wi_1 (#1): How risky is it?' })] } })
    const captured = await gate(token, '1.1')
    expect(captured.structuredContent).toMatchObject({ next: { stage: 1, step: 2 }, waiting_for_inputs: ['risk'] })
    expect(textOf(captured)).toContain('**Step 1.2 waits for input risk**')
    expect(textOf(await gate(token, '1.2'))).toMatch(/Whether step 1\.2 applies depends on risk, which isn't set yet: "risk" is Owner's to set/)
    expect(await ownerAnswers(app, '/projects/if-owner', () => 'low')).toContain('Owner set input "risk": low.')
    expect(await item()).toMatchObject({ stage: 1, step: 3, inputs: { risk: { value: 'low', by: 'owner' } } })
  })

  it('updates over a changed if, going back to the step that now applies', async () => {
    const { app, ports, start, gate } = await project('/projects/if-update')
    const { token, item } = await start([{ name: 'kind', value: 'feature' }])
    await gate(token, '1.1', [{ name: 'user_visible', value: 'no' }])
    await gate(token, '2.1')
    ports.reviewer.enqueue('retrospective', { findings: { should: 's', did: 'd', why: 'w', keep: [], improve: [] }, proposals: [{ change: 'features too', purpose: 'p', measure: 'gate_rejections_per_item', ops: [{ op: 'change_step', step: '3.1', if: '' }] }] })
    await app.callTool('/projects/if-update', 'workflow_retrospective', { action: 'run' })
    await ownerAnswers(app, '/projects/if-update', () => 'Approve')
    expect((await app.callTool('/projects/if-update', 'workflow_retrospective', { action: 'apply' })).structuredContent).toMatchObject({ workflow_version: '2.0.0' })
    const built = await gate(token, '3.2')
    expect(built.structuredContent).toMatchObject({ next: { stage: 3, step: 1 }, update: { from_version: '1.0.0', to_version: '2.0.0', kept: ['1.1', '2.1'] } })
    expect(await item()).toMatchObject({ workflow_version: '2.0.0', stage: 3, step: 1 })
  })
})

describe('inputs set at a step that is skipped, and where a work item starts', () => {
  const withSeverity = migrateWorkflow({
    ...PIPELINE,
    stages: [
      { ...PIPELINE.stages[0]!, steps: [PIPELINE.stages[0]!.steps[0]!, step(2, 'rate the bug', { if: "kind == 'bug'" }), step(3, 'escalate', { if: "severity == 'high'" })] },
      PIPELINE.stages[1]!,
    ],
    inputs: [...PIPELINE.inputs, { name: 'severity', options: [option('low'), option('high')], set_at: '1.2', by: 'agent', instruction: 'How bad is it?' }],
  })

  it("lets Agent set its input of a step the work item skipped, so a later step can tell whether it applies", async () => {
    const { start, gate, tool } = await project('/projects/if-skipped-input', withSeverity)
    const { token } = await start([{ name: 'kind', value: 'feature' }])
    const captured = await gate(token, '1.1', [{ name: 'user_visible', value: 'no' }])
    expect(captured.structuredContent).toMatchObject({ next: { stage: 1, step: 3 }, waiting_for_inputs: ['severity'], skipped_by_condition: [{ step: '1.2' }] })
    const set = await tool('work_input', { token, name: 'severity', value: 'low', why: 'a feature has no severity: low' })
    expect(set.structuredContent).toMatchObject({ next: { stage: 2, step: 1 }, skipped_by_condition: [{ step: '1.3' }] })
  })

  it("takes Drillmaster's inputs at a step whose Owner gate Owner approved in AskUserQuestion", async () => {
    const ownerGated = migrateWorkflow({
      ...PIPELINE,
      stages: [{ ...PIPELINE.stages[0]!, steps: [step(1, 'approve', { gate: 'owner' }), step(2, 'go on', { if: "risk == 'high'" }), step(3, 'finish')] }],
      inputs: [{ name: 'risk', options: [option('low'), option('high')], set_at: '1.1', by: 'drillmaster', instruction: 'How risky?' }],
    })
    const { app, ports, start, gate } = await project('/projects/if-owner-gate-input', ownerGated)
    ports.reviewer.enqueue('inputs', { inputs: [{ name: 'risk', value: 'low', explanation: 'one file' }] })
    const { token, item } = await start()
    await gate(token, '1.1')
    await ownerAnswers(app, '/projects/if-owner-gate-input', () => 'Approve')
    await app.idle()
    expect(await item()).toMatchObject({ stage: 1, step: 3, inputs: { risk: { value: 'low', by: 'drillmaster' } } })
  })

  it('checks the named stages against where the work item starts, past the stages that do not apply to it', async () => {
    const refineFirst = migrateWorkflow({ ...PIPELINE, stages: [PIPELINE.stages[1]!, PIPELINE.stages[2]!].map((stage, index) => ({ ...stage, n: index + 1 })) })
    const { tool } = await project('/projects/if-start-stage', refineFirst)
    const started = await tool('work_start', { issue: '#1', description: 'a bug', inputs: [{ name: 'kind', value: 'bug' }], stages: ['2'] })
    expect(started.structuredContent).toMatchObject({ stage: 2, step: 1 })
    expect((await tool('work_start', { issue: '#2', description: 'a feature', inputs: [{ name: 'kind', value: 'feature' }], stages: ['2'] })).content[0]!.text).toMatch(/starts at step 1.1, in stage 1 "refine"/)
  })
})
