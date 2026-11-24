import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { averageMeasure, measureBaseline, measureDeliveredItems } from '../../src/core/measures.js'
import { applyWorkflowOps, applyProposal, InvalidChange, levelOfOps, readPostMortemAnswer, readRetroAnswer, WorkflowOp } from '../../src/core/retro.js'
import { workflowZero } from '../../src/core/workflow.js'
import { EXPERIMENT_1, OBJECTIVE, WORKFLOW_3 } from '../helpers.js'

const w0 = workflowZero(OBJECTIVE as never)
const sequentialGuids = () => {
  let made = 0
  return () => `guid-${++made}`
}
const testStep = { name: 'run the tests', instruction: 'Run npm test.', gate: 'self' as const, rules: ['test 1.1'], report: ['test result'] }
const testRule = { id: '1.1', rule: 'the tests run green before a PR', verified_by: 'the test output' }

describe('workflow operations', () => {
  it('grows workflow_0 into a first work stage with its work policy', () => {
    const next = applyWorkflowOps(
      w0,
      [
        { op: 'add_policy', name: 'test', rules: [testRule] },
        { op: 'add_stage', name: 'build', purpose: 'the change works', steps: [testStep] },
      ],
      sequentialGuids(),
    )
    expect(next.version).toBe('1.0.0')
    expect(next.policies).toEqual([{ guid: 'guid-1', name: 'test', rules: [{ guid: 'guid-2', ...testRule }] }])
    expect(next.stages).toEqual([{ guid: 'guid-3', n: 1, name: 'build', purpose: 'the change works', steps: [{ guid: 'guid-4', n: 1, ...testStep }] }])
  })

  it('renumbers after inserting and removing', () => {
    const next = applyWorkflowOps(WORKFLOW_3, [
      { op: 'add_step', stage: '1', after: '0', step: { name: 'read the issue', instruction: 'Read it.', gate: 'self', rules: [], report: [] } },
      { op: 'remove_step', step: '1.3' },
      { op: 'add_stage', name: 'refine', purpose: 'Owner and Agent agree', after: '0', steps: [{ name: 'write criteria', instruction: 'Write them.', gate: 'owner', rules: [], report: [] }] },
    ])
    expect(next.stages.map((s) => [s.n, s.name, s.steps.map((x) => `${x.n}:${x.name}`)])).toEqual([
      [1, 'refine', ['1:write criteria']],
      [2, 'build', ['1:read the issue', '2:run the tests']],
      [3, 'review', ['1:Owner approves']],
    ])
  })

  it('changes steps, rules and the objective', () => {
    const next = applyWorkflowOps(WORKFLOW_3, [
      { op: 'change_step', step: '1.2', gate: 'drillmaster' },
      { op: 'change_rule', rule: 'pr 1.1', verified_by: 'reading the PR' },
      { op: 'set_objective', measures: ['gate_rejections_per_item'] },
    ])
    expect(next.stages[0]!.steps[1]!.gate).toBe('drillmaster')
    expect(next.policies[1]!.rules[0]!.verified_by).toBe('reading the PR')
    expect(next.objective).toEqual({ text: OBJECTIVE.text, measures: ['gate_rejections_per_item'] })
  })

  it('refuses changes that leave the workflow invalid', () => {
    expect(() => applyWorkflowOps(WORKFLOW_3, [{ op: 'remove_rule', rule: 'pr 1.1' }])).toThrow(/unknown rule/)
    expect(() => applyWorkflowOps(w0, [{ op: 'remove_stage', stage: '1' }])).toThrow(InvalidChange)
    expect(() => applyWorkflowOps(WORKFLOW_3, [{ op: 'add_step', stage: '1', after: '2.1', step: testStep }])).toThrow(/not in stage 1/)
    expect(() => applyWorkflowOps(w0, [{ op: 'add_stage', name: 'b', purpose: 'p', steps: [{ ...testStep }] }])).toThrow(/unknown rule/)
  })

  it('keeps the GUIDs of what it changes, and keeps an input at its step when the step moves', () => {
    const size = { name: 'size', options: [{ value: 's', description: 'small' }, { value: 'l', description: 'large' }], set_at: '1.2', by: 'agent' as const, instruction: 'pick' }
    const withSize = applyWorkflowOps(WORKFLOW_3, [{ op: 'add_input', input: size }], sequentialGuids())
    const next = applyWorkflowOps(withSize, [
      { op: 'add_step', stage: '1', after: '0', step: { name: 'read the issue', instruction: 'Read it.', gate: 'self', rules: [], report: [] } },
      { op: 'change_step', step: 'step 1.3', name: 'describe the pull request' },
    ])
    expect(next.stages[0]!.steps[2]).toMatchObject({ name: 'describe the pull request', guid: WORKFLOW_3.stages[0]!.steps[1]!.guid })
    expect(next.inputs[0]).toMatchObject({ guid: 'guid-1', set_at: '1.3' })
    expect(() => applyWorkflowOps(next, [{ op: 'remove_step', step: '1.3' }])).toThrow(/Input "size" is set at work step 1.3, which this change removes/)
  })

  it('reads operations written before references', () => {
    expect(WorkflowOp.parse({ op: 'change_step', stage: 1, step: 2, gate: 'drillmaster' })).toEqual({ op: 'change_step', step: '1.2', gate: 'drillmaster' })
    expect(WorkflowOp.parse({ op: 'add_step', stage: 1, after: 2, step: testStep })).toEqual({ op: 'add_step', stage: '1', after: '1.2', step: testStep })
    expect(WorkflowOp.parse({ op: 'change_rule', ref: 'pr 1.1', rule: 'reworded' })).toEqual({ op: 'change_rule', rule: 'pr 1.1', text: 'reworded' })
    expect(WorkflowOp.parse({ op: 'remove_metric', name: 'size' })).toEqual({ op: 'remove_input', input: 'size' })
    expect(WorkflowOp.parse({ op: 'change_metric', metric: 'size', at_step: '1.2', categories: [{ value: 's', description: 'small' }, { value: 'l', description: 'large' }] })).toEqual({
      op: 'change_input',
      input: 'size',
      set_at: '1.2',
      options: [{ value: 's', description: 'small' }, { value: 'l', description: 'large' }],
    })
    expect(WorkflowOp.parse({ op: 'add_metric', metric: { name: 'size', categories: [{ value: 's', description: 'small' }, { value: 'l', description: 'large' }], at: { stage: 1, step: 1 }, by: 'agent', instruction: 'pick' } })).toMatchObject({ op: 'add_input', input: { set_at: '1.1', options: [{ value: 's' }, { value: 'l' }] } })
  })
})

describe('applying a proposal', () => {
  const items = [1, 2, 3].map((n) => ({
    work_item_id: `wi_${n}`,
    issue: `#${n}`,
    workflow_version: '0.0.0',
    delivered_at: `2026-11-0${n}T10:00:00Z`,
    inputs: {},
    passed_step_guids: [],
    rejections_by_rule: {},
    values: { gate_rejections_per_item: n, review_rounds_per_item: 0, minutes_per_item: 1, tool_calls_per_item: 5 },
  }))

  it("opens a workflow experiment with the measure's baseline", () => {
    const next = applyProposal(w0, { id: 1, change: 'add a test step', purpose: 'Owner had to ask for tests', measure: 'gate_rejections_per_item', hypothesis: 'a test step stops the asking', target: 1, judge_after: 2, ops: [{ op: 'add_policy', name: 'test', rules: [testRule] }, { op: 'add_stage', name: 'build', purpose: 'the change works', steps: [testStep] }] }, items, '2026-11-09')
    expect(next.level).toBe('major')
    expect(next.workflow.experiments).toEqual([
      {
        id: 1,
        change: 'add a test step',
        purpose: 'Owner had to ask for tests',
        hypothesis: 'a test step stops the asking',
        null_hypothesis: '"add a test step" makes no difference to gate_rejections_per_item.',
        measure: 'gate_rejections_per_item',
        baseline: 2,
        baseline_sd: 0.82,
        target: 1,
        judge_after: 2,
        affects: [next.workflow.stages[0]!.steps[0]!.guid],
        version: '1.0.0',
        started: '2026-11-09',
      },
    ])
  })

  it('judging an experiment ends it without opening a new one', () => {
    const withExperiment = { ...WORKFLOW_3, experiments: [{ ...EXPERIMENT_1, id: 4 }] }
    const next = applyProposal(withExperiment, { id: 1, change: 'keep experiment 4', purpose: 'it worked', measure: 'owner_friction_per_item', ops: [{ op: 'end_experiment', id: 4, outcome: 'kept' }] }, items, '2026-11-09')
    expect(next.workflow.experiments).toEqual([])
    expect(next).toMatchObject({ level: 'patch', workflow: { version: '3.0.1' } })
  })
})

describe("reading Drillmaster's answers", () => {
  const findings = { should: 's', did: 'd', why: 'w', keep: 'k', improve: 'i' }

  it('keeps valid proposals, renumbered, and drops the ones that would not apply', () => {
    const read = readRetroAnswer(w0, {
      findings,
      proposals: [
        { id: 7, change: 'bad', purpose: 'p', measure: 'owner_friction_per_item', ops: [{ op: 'remove_stage', stage: '3' }] },
        { id: 8, change: 'good', purpose: 'p', measure: 'owner_friction_per_item', ops: [{ op: 'add_policy', name: 'test', rules: [testRule] }] },
      ],
    })
    expect(read.proposals.map((p) => [p.id, p.change])).toEqual([[1, 'good']])
    expect(read.dropped).toEqual([{ change: 'bad', error: 'There is no stage 3 in workflow 0.0.0.' }])
  })

  it('keeps a proposal that builds on an earlier one, and says so', () => {
    const read = readRetroAnswer(w0, {
      findings,
      proposals: [
        { change: 'policy', purpose: 'p', measure: 'owner_friction_per_item', ops: [{ op: 'add_policy', name: 'test', rules: [testRule] }] },
        { change: 'stage', purpose: 'p', measure: 'owner_friction_per_item', ops: [{ op: 'add_stage', name: 'build', purpose: 'the change works', steps: [testStep] }] },
        { change: 'objective', purpose: 'p', measure: 'minutes_per_item', ops: [{ op: 'set_objective', measures: ['minutes_per_item'] }] },
      ],
    })
    expect(read.proposals.map((p) => [p.id, p.depends_on])).toEqual([[1, undefined], [2, [1]], [3, undefined]])
    expect(read.dropped).toEqual([])
  })

  it('keeps at most four proposals, with their hypotheses', () => {
    const proposal = (n: number) => ({ change: `objective ${n}`, purpose: 'p', measure: 'minutes_per_item', hypothesis: 'faster', target: 5, judge_after: 2, ops: [{ op: 'set_objective', text: `objective ${n}` }] })
    const read = readRetroAnswer(w0, { findings, proposals: [1, 2, 3, 4, 5].map(proposal) })
    expect(read.proposals).toHaveLength(4)
    expect(read.proposals[0]).toMatchObject({ hypothesis: 'faster', target: 5, judge_after: 2 })
    expect(read.dropped).toEqual([{ change: 'objective 5', error: 'A retrospective makes at most 4 proposals.' }])
  })

  it('sets the version level from what changes', () => {
    expect(levelOfOps([{ op: 'add_step', stage: '1', step: { ...testStep } }])).toBe('major')
    expect(levelOfOps([{ op: 'change_step', step: '1.1', rules: [] }])).toBe('major')
    expect(levelOfOps([{ op: 'change_step', step: '1.1', instruction: 'Run it twice.' }])).toBe('minor')
    expect(levelOfOps([{ op: 'change_rule', rule: 'pr 1.1', text: 'reworded' }])).toBe('minor')
    expect(levelOfOps([{ op: 'end_experiment', id: 1, outcome: 'kept' }])).toBe('patch')
    expect(applyWorkflowOps(WORKFLOW_3, [{ op: 'change_stage', stage: '1', purpose: 'it works' }]).version).toBe('3.1.0')
  })

  it('refuses a retrospective without findings, and reads post mortems from text', () => {
    expect(() => readRetroAnswer(w0, 'nothing to say')).toThrow(/no findings/)
    expect(readPostMortemAnswer('Here: {"keep":"k","change":[{"refs":["step 1.2","step 9.9"],"text":"c"}],"experiment_reflections":"none"}', WORKFLOW_3, [])).toEqual({
      keep: [{ refs: [], text: 'k' }],
      change: [{ refs: [{ ref: 'step 1.2', guid: WORKFLOW_3.stages[0]!.steps[1]!.guid }], text: 'c' }],
      experiment_reflections: [],
      measured: [{ measure: 'owner_friction_per_item', occurrences: [] }],
    })
  })

  it('resolves the references in the findings, and keeps feedback on a tool', () => {
    const read = readRetroAnswer(WORKFLOW_3, { findings: { ...findings, keep: [{ refs: ['step 1.1'], text: 'tests first' }], improve: [{ refs: ['tool work_deliver', 'policy nowhere'], text: 'take .js files' }] }, proposals: [] }, ['work_deliver'])
    expect(read.findings.keep).toEqual([{ refs: [{ ref: 'step 1.1', guid: WORKFLOW_3.stages[0]!.steps[0]!.guid }], text: 'tests first' }])
    expect(read.findings.improve).toEqual([{ refs: [{ ref: 'tool work_deliver', guid: null }], text: 'take .js files' }])
  })

  it('makes a proposal depend on the earlier one that adds what it relies on', () => {
    const lintRule = { op: 'add_policy', name: 'lint', rules: [{ id: '1.1', rule: 'no lint errors', verified_by: 'npm run lint' }] }
    const read = readRetroAnswer(WORKFLOW_3, {
      findings,
      proposals: [
        { change: 'time it', purpose: 'p', measure: 'minutes_per_item', ops: [{ op: 'set_objective', measures: ['minutes_per_item'] }] },
        { change: 'lint rule', purpose: 'p', measure: 'gate_rejections_per_item', ops: [lintRule] },
        { change: 'lint step', purpose: 'p', measure: 'gate_rejections_per_item', relies_on: ['rule lint 1.1', 'step 1.1'], ops: [{ op: 'change_step', step: '1.1', rules: ['test 1.1', 'lint 1.1'] }] },
        { change: 'own rule', purpose: 'p', measure: 'gate_rejections_per_item', relies_on: ['rule own 1.1'], ops: [{ op: 'add_policy', name: 'own', rules: [{ id: '1.1', rule: 'r', verified_by: 'v' }] }] },
      ],
    })
    expect(read.proposals.map((p) => [p.change, p.depends_on])).toEqual([['time it', undefined], ['lint rule', undefined], ['lint step', [2]], ['own rule', undefined]])
    const nothing = { change: 'nothing there', purpose: 'p', measure: 'gate_rejections_per_item', relies_on: ['step 7.1'], ops: [{ op: 'set_objective', text: 'x' }] }
    expect(readRetroAnswer(WORKFLOW_3, { findings, proposals: [nothing] }).dropped).toEqual([{ change: 'nothing there', error: "It relies on step 7.1, which workflow 3.0.0 doesn't have and no earlier proposal adds." }])
  })
})

describe('measures', () => {
  const at = (m: number) => `2026-11-09T10:${String(m).padStart(2, '0')}:00.000Z`
  const events: DrillmasterEvent[] = [
    { id: 'a', at: at(0), type: 'work_item_started', work_item_id: 'wi_1', issue: '#1', workflow_version: '0.0.0', token_hash: 'h', stage: null, step: null },
    { id: 'b', at: at(1), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'UserPromptSubmit', prompt: 'you forgot the tests' },
    { id: 'c', at: at(2), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'PostToolUse', tool: 'Bash' },
    { id: 'e', at: at(3), type: 'gate_verdict', work_item_id: 'wi_1', stage: 1, step: 1, accepted: true, by: 'owner', via: 'question', why: 'Owner approved.', rule: null, next: { stage: null, step: null }, done: true },
    { id: 'f', at: at(10), type: 'work_item_delivered', work_item_id: 'wi_1', pr: '#2' },
    // After delivery: a correction that makes Agent change the work counts once...
    { id: 'g', at: at(11), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'UserPromptSubmit', prompt: 'you forgot CHANGES.md' },
    { id: 'g2', at: at(11), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'PostToolUse', tool: 'Edit' },
    { id: 'g3', at: at(11), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'PostToolUse', tool: 'Bash' },
    // ...while the next instruction, followed only by Drillmaster's tools, does not.
    { id: 'g4', at: at(12), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'UserPromptSubmit', prompt: 'now do issue #2' },
    { id: 'g5', at: at(12), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'PostToolUse', tool: 'mcp__plugin_devops-drillmaster_drillmaster__work_report' },
    { id: 'h', at: at(12), type: 'work_item_started', work_item_id: 'wi_2', issue: '#2', workflow_version: '0.0.0', token_hash: 'h2', stage: null, step: null },
  ]

  it('counts per delivered work item: each prompt and no approval, and after delivery only prompts that changed the work', () => {
    expect(measureDeliveredItems(events)).toEqual([
      {
        work_item_id: 'wi_1',
        issue: '#1',
        workflow_version: '0.0.0',
        delivered_at: at(10),
        inputs: {},
        passed_step_guids: [],
        rejections_by_rule: {},
        values: { owner_friction_per_item: 2, gate_rejections_per_item: 0, review_rounds_per_item: 0, minutes_per_item: 10, tool_calls_per_item: 1 },
      },
    ])
  })

  it('averages, with a baseline of 0 before any work item is delivered', () => {
    expect(averageMeasure([], 'minutes_per_item')).toBeNull()
    expect(measureBaseline([], 'minutes_per_item')).toBe(0)
    expect(averageMeasure(measureDeliveredItems(events), 'minutes_per_item')).toBe(10)
  })
})

describe('the measures a retrospective defines', () => {
  const policyFriction = { name: 'policy friction', short: 'PF', color: 'orange' as const, definition: 'Owner caught what a rule should have caught.', show: true }

  it('adds, changes and removes a measure, as a patch that opens no experiment', () => {
    const added = applyWorkflowOps(w0, [{ op: 'add_measure', measure: policyFriction }])
    expect(added).toMatchObject({ version: '0.0.1', measures: [policyFriction] })
    expect(levelOfOps([{ op: 'add_measure', measure: policyFriction }])).toBe('patch')
    const proposal = { id: 1, change: 'measure policy friction', purpose: 'see where rules miss', measure: 'gate_rejections_per_item', ops: [{ op: 'add_measure', measure: policyFriction }] }
    expect(applyProposal(w0, proposal, [], '2026-11-24').workflow.experiments).toEqual([])
    const changed = applyWorkflowOps(added, [{ op: 'change_measure', measure: 'policy friction', show: false }])
    expect(changed.measures).toEqual([{ ...policyFriction, show: false }])
    expect(applyWorkflowOps(changed, [{ op: 'remove_measure', measure: 'policy friction' }]).measures).toEqual([])
  })

  it('refuses a measure defined twice, one it does not define, and removing one the objective uses', () => {
    const added = applyWorkflowOps(w0, [{ op: 'add_measure', measure: policyFriction }])
    expect(() => applyWorkflowOps(added, [{ op: 'add_measure', measure: policyFriction }])).toThrow(/already exists/)
    expect(() => applyWorkflowOps(added, [{ op: 'change_measure', measure: 'happiness', show: false }])).toThrow(/defines no measure "happiness"/)
    const inObjective = applyWorkflowOps(added, [{ op: 'set_objective', measures: ['policy friction'] }])
    expect(() => applyWorkflowOps(inObjective, [{ op: 'remove_measure', measure: 'policy friction' }])).toThrow(/neither counted by Drillmaster nor defined/)
  })
})
