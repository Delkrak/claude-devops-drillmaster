import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { foldState, viewWorkflow } from '../../src/core/state.js'
import { workflowZero } from '../../src/core/workflow.js'
import { OBJECTIVE, WORKFLOW_2 } from '../helpers.js'

const W0 = workflowZero(OBJECTIVE as never)
const EVENTS: DrillmasterEvent[] = [
  { id: 'ev_1', at: '2026-11-09T10:00:00Z', type: 'project_initialized', dir: '/p', workflow: W0 },
  { id: 'ev_2', at: '2026-11-09T11:00:00Z', type: 'workflow_changed', workflow: { ...W0, version: '1.0.0' }, reason: 'retro 1' },
  { id: 'ev_3', at: '2026-11-09T12:00:00Z', type: 'workflow_changed', workflow: WORKFLOW_2, reason: 'retro 2' },
]

describe('folding events', () => {
  it('knows nothing before the project is initialized', () => {
    expect(foldState([])).toEqual({
      initialized: false,
      retros: {},
      latestRetroId: null,
      versions: [],
      sessions: {},
      workItems: {},
      ownerAsked: {},
      ownerComments: {},
      traceCount: 0,
      eventCount: 0,
    })
  })

  it('keeps every workflow version and the latest as current', () => {
    const state = foldState(EVENTS)
    expect(state.initialized).toBe(true)
    expect(state.workflow).toEqual(WORKFLOW_2)
    expect(state.versions.map((v) => v.version)).toEqual(['0.0.0', '1.0.0', '2.0.0'])
  })
})

describe('workflow_get views', () => {
  const state = foldState(EVENTS)

  it('gives an overview by default', () => {
    expect(viewWorkflow(state, {})).toEqual({
      kind: 'overview',
      version: '2.0.0',
      objective: WORKFLOW_2.objective,
      stages: [{ n: 1, name: 'build', purpose: 'the change works and is described', steps: 2 }],
      inputs: [],
      tool_captures: [],
      experiments: WORKFLOW_2.experiments,
    })
  })

  it('gives a work stage with its rules in full', () => {
    const view = viewWorkflow(state, { stage: 1 })
    expect(view).toMatchObject({ kind: 'stage', stage: { n: 1, name: 'build' } })
    if (view.kind !== 'stage') throw new Error()
    expect(view.steps[1]).toEqual({
      n: '1.2',
      name: 'say what the pull request changes',
      instruction: 'Write the PR description.',
      gate: 'owner',
      rules: [{ ref: 'pr 1.1', rule: 'the PR says what it changes', verified_by: 'reading the PR description' }],
      report: ['what the PR changes'],
    })
  })

  it('reads back an earlier version', () => {
    expect(viewWorkflow(state, { version: '0.0.0', full: true })).toEqual({ kind: 'full', workflow: W0 })
  })

  it('explains what is missing', () => {
    expect(() => viewWorkflow(foldState([]), {})).toThrow(/no workflow yet/)
    expect(() => viewWorkflow(state, { stage: 2 })).toThrow(/work stages are 1-1/)
    expect(() => viewWorkflow(state, { version: '0.0.0', stage: 1 })).toThrow(/no work stages yet/)
    expect(() => viewWorkflow(state, { version: '7.0.0' })).toThrow(/no workflow version 7.0.0/)
  })
})
