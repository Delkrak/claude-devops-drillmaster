import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { foldState } from '../../src/core/state.js'
import { deliverWorkItem, handInGate, nextPosition, recordPostMortem, recordReport, Refused } from '../../src/core/work.js'
import { workflowZero } from '../../src/core/workflow.js'
import { OBJECTIVE, WORKFLOW_3 } from '../helpers.js'

const at = '2026-11-09T10:00:00Z'
const w0 = workflowZero(OBJECTIVE as never)
const seed = (workflow = WORKFLOW_3): DrillmasterEvent[] => [
  { id: 'e0', at, type: 'project_initialized', dir: '/p', workflow: w0 },
  ...(workflow.version !== '0.0.0' ? [{ id: 'e1', at, type: 'workflow_changed' as const, workflow, reason: 'r' }] : []),
]
const started = (version: string, stage: number | null, step: number | null): DrillmasterEvent => ({
  id: 's',
  at,
  type: 'work_item_started',
  work_item_id: 'wi_1',
  issue: '#1',
  workflow_version: version,
  token_hash: 'h',
  stage,
  step,
})
const SIZE = {
  name: 'size',
  categories: [
    { value: 'small', description: 'one file' },
    { value: 'large', description: 'several files' },
  ],
  guid: 'guid-metric',
  at_step: '1.1',
  by: 'agent' as const,
  instruction: 'How big is the change?',
}
const W = WORKFLOW_3
const run = (extra: DrillmasterEvent[] = [], workflow = W) => foldState([...seed(workflow), started(workflow.version, 1, 1), ...extra])
const check = (rule: string, accepted = true) => ({ rule, accepted, evidence: `checked ${rule}` })
const asEvents = (events: unknown[]) => events.map((e, i) => ({ id: `x${i}`, at, ...(e as object) })) as DrillmasterEvent[]

describe('progression', () => {
  it('goes step by step, then stage by stage, then done', () => {
    expect(nextPosition(W, 1, 1)).toEqual({ next: { stage: 1, step: 2 }, done: false })
    expect(nextPosition(W, 1, 2)).toEqual({ next: { stage: 2, step: 1 }, done: false })
    expect(nextPosition(W, 2, 1)).toEqual({ next: { stage: null, step: null }, done: true })
  })
})

describe('work gates', () => {
  it('accepts a passing self gate and moves on', () => {
    const state = run()
    const decision = handInGate(state, state.workItems.wi_1!, { stage: 1, step: 1, self_check: [check('test 1.1')], text: 'green' })
    expect(decision.events.map((e) => e.type)).toEqual(['gate_submitted', 'gate_verdict'])
    expect(decision.answer).toMatchObject({ verdict: 'accepted', by: 'agent', next: { stage: 1, step: 2 } })
  })

  it('rejects a failed self check and keeps the work at the same step', () => {
    const state = run()
    const decision = handInGate(state, state.workItems.wi_1!, { stage: 1, step: 1, self_check: [check('test 1.1', false)], text: 'red' })
    expect(decision.answer).toMatchObject({ verdict: 'rejected', rule: 'test 1.1', next: { stage: 1, step: 1 } })
    const after = foldState([...seed(W), started(W.version, 1, 1), ...asEvents(decision.events)])
    expect(after.workItems.wi_1).toMatchObject({ stage: 1, step: 1, rejections: 1 })
  })

  it('needs exactly one self check per referenced rule', () => {
    const state = run()
    const item = state.workItems.wi_1!
    expect(() => handInGate(state, item, { stage: 1, step: 1, self_check: [], text: 't' })).toThrow(/Missing: test 1.1/)
    expect(() => handInGate(state, item, { stage: 1, step: 1, self_check: [check('test 1.1'), check('pr 1.1')], text: 't' })).toThrow(/Not referenced: pr 1.1/)
    expect(() => handInGate(state, item, { stage: 1, step: 1, self_check: [check('test 1.1'), check('test 1.1')], text: 't' })).toThrow(Refused)
  })

  it('keeps work steps in order', () => {
    const state = run()
    expect(() => handInGate(state, state.workItems.wi_1!, { stage: 1, step: 2, self_check: [check('pr 1.1')], text: 't' })).toThrow(/at work step 1.1/)
  })

  it('leaves an Owner gate pending, and blocks the next gate and delivery', () => {
    const toReview = asEvents([{ type: 'gate_verdict', work_item_id: 'wi_1', stage: 1, step: 2, accepted: true, by: 'agent', why: 'ok', rule: null, next: { stage: 2, step: 1 }, done: false }])
    const state = run(toReview)
    const decision = handInGate(state, state.workItems.wi_1!, { stage: 2, step: 1, self_check: [check('pr 1.1')], text: 'PR #40' })
    expect(decision.answer).toMatchObject({ verdict: 'pending', gate: 'owner' })
    const pending = run([...toReview, ...asEvents(decision.events)])
    expect(pending.workItems.wi_1!.pending_gate).toEqual({ stage: 2, step: 1, gate: 'owner' })
    expect(() => handInGate(pending, pending.workItems.wi_1!, { stage: 2, step: 1, self_check: [check('pr 1.1')], text: 'again' })).toThrow(/pending/)
    expect(() => deliverWorkItem(pending.workItems.wi_1!, DELIVERY)).toThrow(/pending/)
  })

  it("refuses the gate without Agent's metrics, and records them with it", () => {
    const withSize = { ...W, metrics: [SIZE] }
    const state = run([], withSize)
    const item = state.workItems.wi_1!
    const gate = { stage: 1, step: 1, self_check: [check('test 1.1')], text: 'green' }
    expect(() => handInGate(state, item, gate)).toThrow(/Take metric "size"/)
    expect(() => handInGate(state, item, { ...gate, metrics: [{ name: 'size', value: 'huge' }] })).toThrow(/small, large/)
    expect(() => handInGate(state, item, { ...gate, metrics: [{ name: 'mood', value: 'x' }] })).toThrow(/No metric mood/)
    const decision = handInGate(state, item, { ...gate, metrics: [{ name: 'size', value: 'small', explanation: 'one file' }] })
    expect(decision.events.map((e) => e.type)).toEqual(['gate_submitted', 'metric_recorded', 'gate_verdict'])
    const after = run(asEvents(decision.events), withSize)
    expect(after.workItems.wi_1!.metrics).toEqual({ size: { value: 'small', by: 'agent', explanation: 'one file' } })
  })
})

const DELIVERY = { pr: '#40', summary: 'adds the export', artifacts: [] }

describe('reports, delivery and the post mortem', () => {
  it('requires the extra fields of decisions and questions', () => {
    const item = run().workItems.wi_1!
    expect(() => recordReport(W, item, { kind: 'decision', text: 't' })).toThrow(/chosen/)
    expect(() => recordReport(W, item, { kind: 'question', text: 't' })).toThrow(/asked/)
    expect(recordReport(W, item, { kind: 'decision', text: 't', chosen: 'a', by: 'Agent', why: 'b' }).events[0]).toMatchObject({ kind: 'decision', chosen: 'a', stage: 1, step: 1 })
  })

  it('delivers right away on workflow_0, and only after every gate otherwise', () => {
    const zero = foldState([...seed(w0), started('0.0.0', null, null)])
    expect(zero.workItems.wi_1!.gates_done).toBe(true)
    expect(deliverWorkItem(zero.workItems.wi_1!, { ...DELIVERY, pr: '#2' }).events[0]).toMatchObject({ type: 'work_item_delivered', pr: '#2', summary: 'adds the export' })
    expect(() => handInGate(zero, zero.workItems.wi_1!, { stage: 1, step: 1, self_check: [], text: 't' })).toThrow(/no work stages/)
    expect(() => deliverWorkItem(run().workItems.wi_1!, DELIVERY)).toThrow(/Every work gate must pass/)
  })

  it('takes added steps only after delivery, with the correction that asked for them', () => {
    const active = foldState([...seed(w0), started('0.0.0', null, null)])
    expect(() => recordReport(w0, active.workItems.wi_1!, { kind: 'added_step', text: 'added CHANGES.md', why: 'Owner: add CHANGES.md' })).toThrow(/fix to delivered work/)
    const delivered = foldState([...seed(w0), started('0.0.0', null, null), ...asEvents([{ type: 'work_item_delivered', work_item_id: 'wi_1', pr: '#2' }])])
    expect(() => recordReport(w0, delivered.workItems.wi_1!, { kind: 'added_step', text: 'added CHANGES.md' })).toThrow(/needs `why`/)
    expect(recordReport(w0, delivered.workItems.wi_1!, { kind: 'added_step', text: 'added CHANGES.md', why: 'Owner: add CHANGES.md' }).events[0]).toMatchObject({
      type: 'work_reported',
      kind: 'added_step',
      why: 'Owner: add CHANGES.md',
    })
  })

  it('takes one post mortem from Agent, after delivery only', () => {
    const pm = { keep: 'k', change: 'c', experiment_reflections: 'none running', free_text: 'f' }
    const active = foldState([...seed(w0), started('0.0.0', null, null)])
    expect(() => recordPostMortem(active.workItems.wi_1!, pm)).toThrow(/once the work item is delivered/)
    const delivered = foldState([...seed(w0), started('0.0.0', null, null), ...asEvents([{ type: 'work_item_delivered', work_item_id: 'wi_1', pr: '#2' }])])
    expect(() => recordReport(w0, delivered.workItems.wi_1!, { kind: 'impediment', text: 'late' })).toThrow(/delivered/)
    const written = recordPostMortem(delivered.workItems.wi_1!, pm)
    const after = foldState([...seed(w0), started('0.0.0', null, null), ...asEvents([{ type: 'work_item_delivered', work_item_id: 'wi_1', pr: '#2' }, ...written.events])])
    expect(() => recordPostMortem(after.workItems.wi_1!, pm)).toThrow(/already/)
  })
})
