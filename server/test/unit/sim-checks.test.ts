import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { migrateWorkflow, workflowZero } from '../../src/core/workflow.js'
import { checkRun } from '../sim/assertions.js'
import { EXPERIMENT_1, OBJECTIVE } from '../helpers.js'

const at = (m: number) => `2026-11-09T10:${String(m).padStart(2, '0')}:00.000Z`
const item = (n: number, m: number, corrections: number): DrillmasterEvent[] => [
  { id: `s${n}`, at: at(m), type: 'work_item_started', work_item_id: `wi_${n}`, issue: `#${n}`, workflow_version: '0.0.0', token_hash: `h${n}`, stage: null, step: null },
  { id: `b${n}`, at: at(m), type: 'session_bound', session_id: 'S', work_item_id: `wi_${n}` },
  ...Array.from({ length: corrections }, (_, i): DrillmasterEvent => ({ id: `p${n}${i}`, at: at(m + 1), type: 'work_trace', session_id: 'S', work_item_id: `wi_${n}`, stage: null, step: null, hook: 'UserPromptSubmit', prompt: 'fix it' })),
  { id: `t${n}`, at: at(m + 1), type: 'work_trace', session_id: 'S', work_item_id: `wi_${n}`, stage: null, step: null, hook: 'PostToolUse', tool: 'Bash', input: '{"token":"[redacted]"}' },
  { id: `d${n}`, at: at(m + 2), type: 'work_item_delivered', work_item_id: `wi_${n}`, pr: 'local' },
  { id: `ma${n}`, at: at(m + 2), type: 'post_mortem_written', work_item_id: `wi_${n}`, author: 'agent', keep: [{ refs: [], text: 'k' }], change: [{ refs: [], text: 'c' }], experiment_reflections: [] },
  { id: `md${n}`, at: at(m + 2), type: 'post_mortem_written', work_item_id: `wi_${n}`, author: 'drillmaster', keep: [{ refs: [], text: 'k' }], change: [{ refs: [], text: 'c' }], experiment_reflections: [] },
]
const w0 = workflowZero(OBJECTIVE as never)
const w1 = { ...w0, version: '1.0.0', experiments: [{ ...EXPERIMENT_1, version: '1.0.0' }] }
const events: DrillmasterEvent[] = [
  { id: 'i', at: at(0), type: 'project_initialized', dir: '/p', workflow: w0 },
  ...item(1, 1, 2),
  { id: 'r', at: at(10), type: 'retrospective_ran', retro_id: 'retro_1', work_items: ['wi_1'], findings: { should: '', did: '', why: '', keep: [], improve: [] }, proposals: [] },
  { id: 'o', at: at(10), type: 'owner_decided', retro_id: 'retro_1', approved: [1], declined: [], prompt: 'Approve', via: 'question' },
  { id: 'c', at: at(11), type: 'workflow_changed', workflow: w1, reason: 'c' },
  ...item(2, 20, 0),
]

describe('simulation run checks', () => {
  it('passes a run that shows the whole loop', () => {
    const { checks, metrics } = checkRun(events, { ownerMessages: 2, issues: 2, retros: 1 })
    expect(checks.filter((c) => !c.ok)).toEqual([])
    expect(metrics).toMatchObject({ corrections_before: 2, corrections_after: 0, workflow_version: '1.0.0' })
  })

  it('fails a run with a leaked token or a missing post mortem', () => {
    const leaked: DrillmasterEvent[] = [...events, { id: 'x', at: at(30), type: 'work_trace', session_id: 'S', work_item_id: 'wi_2', stage: null, step: null, hook: 'PreToolUse', input: '{"token":"abcdefghijklmnopqrstuvwx"}' }]
    expect(checkRun(leaked, { ownerMessages: 2, issues: 2, retros: 1 }).checks.find((c) => c.name.includes('token'))!.ok).toBe(false)
    const missing = events.filter((e) => e.id !== 'md2')
    expect(checkRun(missing, { ownerMessages: 2, issues: 2, retros: 1 }).checks.find((c) => c.name.includes('post mortems'))!.ok).toBe(false)
  })
})

describe('the checks of a pipeline run', () => {
  const pipeline = migrateWorkflow({
    ...w0,
    version: '1.0.0',
    stages: [{ n: 1, name: 'build', purpose: 'p', steps: [{ n: 1, name: 'reproduce', instruction: 'i', gate: 'self', rules: [], report: [], if: "kind == 'bug'" }, { n: 2, name: 'code', instruction: 'i', gate: 'self', rules: [], report: [] }] }],
    inputs: [{ name: 'kind', options: [{ value: 'bug', description: 'b' }, { value: 'feature', description: 'f' }], set_at: 'start', by: 'agent', instruction: 'which?' }],
  })
  const [reproduce, code] = pipeline.stages[0]!.steps
  const run = (passedReproduce: boolean): DrillmasterEvent[] => [
    { id: 'i', at: at(0), type: 'project_initialized', dir: '/p', workflow: pipeline },
    { id: 's', at: at(1), type: 'work_item_started', work_item_id: 'wi_1', issue: '#1', workflow_version: '1.0.0', token_hash: 'h', stage: 1, step: 1 },
    { id: 'k', at: at(1), type: 'input_set', work_item_id: 'wi_1', stage: null, step: null, name: 'kind', value: 'feature', by: 'agent' },
    passedReproduce
      ? { id: 'v1', at: at(2), type: 'gate_verdict', work_item_id: 'wi_1', stage: 1, step: 1, step_guid: reproduce!.guid, accepted: true, by: 'agent', why: 'ok', rule: null, next: { stage: 1, step: 2 }, done: false }
      : { id: 'v1', at: at(2), type: 'step_skip_decided', work_item_id: 'wi_1', stage: 1, step: 1, step_guid: reproduce!.guid, accepted: true, by: 'condition', why: 'kind is feature', next: { stage: 1, step: 2 }, done: false },
    { id: 't', at: at(3), type: 'work_trace', session_id: 'S', work_item_id: 'wi_1', stage: 1, step: 2, hook: 'PostToolUse', tool: 'Bash', captures: [{ name: 'tests', lines: ['# pass 3'], fields: [{ what: 'pass', count: '3' }] }] },
    { id: 'g', at: at(4), type: 'gate_submitted', work_item_id: 'wi_1', stage: 1, step: 2, step_guid: code!.guid, gate: 'self', self_check: [], text: 't', capture_traces: ['t'] },
    { id: 'v2', at: at(4), type: 'gate_verdict', work_item_id: 'wi_1', stage: 1, step: 2, step_guid: code!.guid, accepted: true, by: 'agent', why: 'ok', rule: null, next: { stage: null, step: null }, done: true },
    { id: 'd', at: at(5), type: 'work_item_delivered', work_item_id: 'wi_1', pr: 'local' },
    { id: 'j', at: at(6), type: 'owner_inputs_judged', work_item_id: 'wi_1', inputs: [{ event: 'p', friction: false, why: 'w' }] },
  ]
  const expects = { condition_skip: true, capture: 'tests', friction: true }
  const named = (events: DrillmasterEvent[], name: string) => checkRun(events, { ownerMessages: 1, issues: 1, retros: 0, expects, ownerGates: { asked: 2, withPreview: 1 } }).checks.find((check) => check.name === name)!

  it('sees steps skipped by condition, captures linked from gates, the friction judge, and Owner gates without their preview', () => {
    expect(named(run(false), 'steps were skipped by their if').ok).toBe(true)
    expect(named(run(false), 'no work item went through a step whose if it does not meet').ok).toBe(true)
    expect(named(run(false), 'the tool capture "tests" kept output').ok).toBe(true)
    expect(named(run(false), 'gates link the captures at their step').ok).toBe(true)
    expect(named(run(false), "the friction judge judged Owner's inputs").ok).toBe(true)
    expect(named(run(false), 'Owner gates showed what Owner approves beside the question')).toMatchObject({ ok: false, detail: '1 of 2' })
  })

  it('fails a run where a work item went through a step whose if it does not meet', () => {
    expect(named(run(true), 'no work item went through a step whose if it does not meet')).toMatchObject({ ok: false, detail: '#1 passed step 1.1' })
  })
})
