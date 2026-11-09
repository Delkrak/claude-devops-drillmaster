import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { averageMeasure, measureBaseline, measureDeliveredItems } from '../../src/core/measures.js'
import { decideProposals } from '../../src/core/owner.js'
import { applyWorkflowOps, applyProposal, InvalidChange, readPostMortemAnswer, readRetroAnswer } from '../../src/core/retro.js'
import { workflowZero } from '../../src/core/workflow.js'
import { OBJECTIVE, WORKFLOW_3 } from '../helpers.js'

const w0 = workflowZero(OBJECTIVE as never)
const testStep = { name: 'run the tests', gate: 'self' as const, rules: ['test 1.1'], report: ['test result'] }
const testRule = { id: '1.1', rule: 'the tests run green before a PR', verified_by: 'the test output' }

describe('workflow operations', () => {
  it('grows workflow_0 into a first work stage with its work policy', () => {
    const next = applyWorkflowOps(w0, [
      { op: 'add_policy', name: 'test', rules: [testRule] },
      { op: 'add_stage', name: 'build', steps: [testStep] },
    ])
    expect(next.version).toBe(1)
    expect(next.stages).toEqual([{ n: 1, name: 'build', steps: [{ n: 1, ...testStep }] }])
  })

  it('renumbers after inserting and removing', () => {
    const next = applyWorkflowOps(WORKFLOW_3, [
      { op: 'add_step', stage: 1, after: 0, step: { name: 'read the issue', gate: 'self', rules: [], report: [] } },
      { op: 'remove_step', stage: 1, step: 3 },
      { op: 'add_stage', name: 'refine', after: 0, steps: [{ name: 'write criteria', gate: 'owner', rules: [], report: [] }] },
    ])
    expect(next.stages.map((s) => [s.n, s.name, s.steps.map((x) => `${x.n}:${x.name}`)])).toEqual([
      [1, 'refine', ['1:write criteria']],
      [2, 'build', ['1:read the issue', '2:run the tests']],
      [3, 'review', ['1:Owner approves']],
    ])
  })

  it('changes steps, rules and the objective', () => {
    const next = applyWorkflowOps(WORKFLOW_3, [
      { op: 'change_step', stage: 1, step: 2, gate: 'drillmaster' },
      { op: 'change_rule', ref: 'pr 1.1', verified_by: 'reading the PR' },
      { op: 'set_objective', measures: ['gate_rejections_per_item'] },
    ])
    expect(next.stages[0]!.steps[1]!.gate).toBe('drillmaster')
    expect(next.policies[1]!.rules[0]!.verified_by).toBe('reading the PR')
    expect(next.objective).toEqual({ text: OBJECTIVE.text, measures: ['gate_rejections_per_item'] })
  })

  it('refuses changes that leave the workflow invalid', () => {
    expect(() => applyWorkflowOps(WORKFLOW_3, [{ op: 'remove_rule', ref: 'pr 1.1' }])).toThrow(/unknown rule/)
    expect(() => applyWorkflowOps(w0, [{ op: 'remove_stage', stage: 1 }])).toThrow(InvalidChange)
    expect(() => applyWorkflowOps(w0, [{ op: 'add_stage', name: 'b', steps: [{ ...testStep }] }])).toThrow(/unknown rule/)
  })
})

describe('applying a proposal', () => {
  const items = [1, 2, 3].map((n) => ({
    work_item_id: `wi_${n}`,
    issue: `#${n}`,
    delivered_at: `2026-11-0${n}T10:00:00Z`,
    values: { owner_corrections_per_item: n, gate_rejections_per_item: 0, review_rounds_per_item: 0, minutes_per_item: 1, tool_calls_per_item: 5 },
  }))

  it("opens a workflow experiment with the measure's baseline", () => {
    const next = applyProposal(w0, { id: 1, change: 'add a test step', purpose: 'Owner had to ask for tests', measure: 'owner_corrections_per_item', ops: [{ op: 'add_policy', name: 'test', rules: [testRule] }, { op: 'add_stage', name: 'build', steps: [testStep] }] }, items, '2026-11-09')
    expect(next.experiments).toEqual([{ id: 1, change: 'add a test step', purpose: 'Owner had to ask for tests', measure: 'owner_corrections_per_item', baseline: 2, started: '2026-11-09' }])
  })

  it('judging an experiment ends it without opening a new one', () => {
    const withExperiment = { ...WORKFLOW_3, experiments: [{ id: 4, change: 'x', purpose: 'y', measure: 'owner_corrections_per_item' as const, baseline: 2, started: '2026-11-01' }] }
    const next = applyProposal(withExperiment, { id: 1, change: 'keep experiment 4', purpose: 'it worked', measure: 'owner_corrections_per_item', ops: [{ op: 'end_experiment', id: 4, outcome: 'kept' }] }, items, '2026-11-09')
    expect(next.experiments).toEqual([])
  })
})

describe("reading Drillmaster's answers", () => {
  const findings = { should: 's', did: 'd', why: 'w', keep: 'k', improve: 'i' }

  it('keeps valid proposals, renumbered, and drops the ones that would not apply', () => {
    const read = readRetroAnswer(w0, {
      findings,
      proposals: [
        { id: 7, change: 'bad', purpose: 'p', measure: 'owner_corrections_per_item', ops: [{ op: 'remove_stage', stage: 3 }] },
        { id: 8, change: 'good', purpose: 'p', measure: 'owner_corrections_per_item', ops: [{ op: 'add_policy', name: 'test', rules: [testRule] }] },
      ],
    })
    expect(read.proposals.map((p) => [p.id, p.change])).toEqual([[1, 'good']])
    expect(read.dropped).toEqual([{ change: 'bad', error: 'There is no work stage 3.' }])
  })

  it('keeps a proposal that builds on an earlier one, and says so', () => {
    const read = readRetroAnswer(w0, {
      findings,
      proposals: [
        { change: 'policy', purpose: 'p', measure: 'owner_corrections_per_item', ops: [{ op: 'add_policy', name: 'test', rules: [testRule] }] },
        { change: 'stage', purpose: 'p', measure: 'owner_corrections_per_item', ops: [{ op: 'add_stage', name: 'build', steps: [testStep] }] },
        { change: 'objective', purpose: 'p', measure: 'minutes_per_item', ops: [{ op: 'set_objective', measures: ['minutes_per_item'] }] },
      ],
    })
    expect(read.proposals.map((p) => [p.id, p.depends_on])).toEqual([[1, undefined], [2, [1]], [3, undefined]])
    expect(read.dropped).toEqual([])
  })

  it('refuses a retrospective without findings, and reads post mortems from text', () => {
    expect(() => readRetroAnswer(w0, 'nothing to say')).toThrow(/no findings/)
    expect(readPostMortemAnswer('Here: {"keep":"k","change":"c","experiment_reflections":"none","free_text":"f"}')).toMatchObject({ keep: 'k' })
  })
})

describe("Owner's words on proposals", () => {
  it.each([
    ['approve 1 and 3', { approved: [1, 3], declined: [] }],
    ['yes', { approved: [1, 2, 3], declined: [] }],
    ['approve all but not 2', { approved: [1, 3], declined: [2] }],
    ['ok 2', { approved: [2], declined: [] }],
    ['no', { approved: [], declined: [1, 2, 3] }],
    ['reject 3', { approved: [], declined: [3] }],
  ])('%s', (prompt, expected) => {
    expect(decideProposals(prompt, [1, 2, 3])).toEqual(expected)
  })

  it('decides nothing on unclear words, or with nothing open', () => {
    expect(decideProposals('what does 2 change?', [1, 2])).toBeUndefined()
    expect(decideProposals('yes', [])).toBeUndefined()
  })
})

describe('measures', () => {
  const at = (m: number) => `2026-11-09T10:${String(m).padStart(2, '0')}:00.000Z`
  const events: DrillmasterEvent[] = [
    { id: 'a', at: at(0), type: 'work_item_started', work_item_id: 'wi_1', issue: '#1', workflow_version: 0, token_hash: 'h', stage: null, step: null },
    { id: 'b', at: at(1), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'UserPromptSubmit', prompt: 'you forgot the tests' },
    { id: 'c', at: at(2), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'PostToolUse', tool: 'Bash' },
    { id: 'd', at: at(3), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'UserPromptSubmit', prompt: 'looks good' },
    { id: 'e', at: at(3), type: 'gate_verdict', work_item_id: 'wi_1', stage: 1, step: 1, accepted: true, by: 'owner', why: 'Owner: "looks good"', rule: null, next: { stage: null, step: null }, done: true },
    { id: 'f', at: at(10), type: 'work_item_delivered', work_item_id: 'wi_1', pr: '#2' },
    // After delivery: a correction that makes Agent change the work counts once...
    { id: 'g', at: at(11), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'UserPromptSubmit', prompt: 'you forgot CHANGES.md' },
    { id: 'g2', at: at(11), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'PostToolUse', tool: 'Edit' },
    { id: 'g3', at: at(11), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'PostToolUse', tool: 'Bash' },
    // ...while the next instruction, followed only by Drillmaster's tools, does not.
    { id: 'g4', at: at(12), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'UserPromptSubmit', prompt: 'now do issue #2' },
    { id: 'g5', at: at(12), type: 'work_trace', session_id: 's', work_item_id: 'wi_1', stage: null, step: null, hook: 'PostToolUse', tool: 'mcp__plugin_devops-drillmaster_drillmaster__work_report' },
    { id: 'h', at: at(12), type: 'work_item_started', work_item_id: 'wi_2', issue: '#2', workflow_version: 0, token_hash: 'h2', stage: null, step: null },
  ]

  it('counts per delivered work item: Owner approvals are not corrections, changes after delivery are', () => {
    expect(measureDeliveredItems(events)).toEqual([
      {
        work_item_id: 'wi_1',
        issue: '#1',
        delivered_at: at(10),
        values: { owner_corrections_per_item: 2, gate_rejections_per_item: 0, review_rounds_per_item: 0, minutes_per_item: 10, tool_calls_per_item: 1 },
      },
    ])
  })

  it('averages, with a baseline of 0 before any work item is delivered', () => {
    expect(averageMeasure([], 'minutes_per_item')).toBeNull()
    expect(measureBaseline([], 'minutes_per_item')).toBe(0)
    expect(averageMeasure(measureDeliveredItems(events), 'minutes_per_item')).toBe(10)
  })
})
