import { describe, expect, it } from 'vitest'
import { buildFrictionPlacementPrompt, frictionPlacementsOf, readFrictionPlacementAnswer } from '../../src/core/frictionPlacement.js'
import type { OwnerInput } from '../../src/core/ownerInputs.js'
import type { WorkItemState } from '../../src/core/state.js'
import { WORKFLOW_3 } from '../helpers.js'

const [runTests, describePr] = WORKFLOW_3.stages[0]!.steps
const item = { issue: '#1', description: 'CSV export', passed_step_guids: [runTests!.guid], skipped_step_guids: [] } as unknown as WorkItemState
const input = { event_id: 'ev_1', prompt: 'show me the failing test', after_delivery: true } as OwnerInput

describe("Drillmaster's placement of friction", () => {
  it('shows Drillmaster the workflow and how the work item went through it, with each step-in and why it is friction', () => {
    const prompt = buildFrictionPlacementPrompt(WORKFLOW_3, item, [{ input, judgement: { event: 'ev_1', friction: true, why: 'the proof was missing' } }])
    expect(prompt).toContain('- 1.1 run the tests: passed')
    expect(prompt).toContain('- 1.2 say what the pull request changes: not reached')
    expect(prompt).toContain('- ev_1 (after delivery): "show me the failing test" (why friction: the proof was missing)')
  })

  it('places an input at the step it names, nowhere for a step the workflow lacks, and drops inputs it was not asked about', () => {
    const answer = {
      inputs: [
        { event: 'ev_1', step: '1.2', why: 'describing the PR should have shown it' },
        { event: 'ev_2', step: '9.9', why: 'no such step' },
        { event: 'ev_3', step: null, why: 'no step covers it' },
        { event: 'ev_unasked', step: '1.1', why: 'not asked' },
      ],
    }
    expect(readFrictionPlacementAnswer(WORKFLOW_3, ['ev_1', 'ev_2', 'ev_3'], answer)).toEqual([
      { event: 'ev_1', step_guid: describePr!.guid, why: 'describing the PR should have shown it' },
      { event: 'ev_2', step_guid: null, why: 'no such step' },
      { event: 'ev_3', step_guid: null, why: 'no step covers it' },
    ])
    expect(readFrictionPlacementAnswer(WORKFLOW_3, ['ev_1'], 'no json here')).toEqual([])
  })

  it('reads the latest placement of each input from the events', () => {
    const placed = (step_guid: string | null, at: string) => ({ type: 'friction_placed', at, work_item_id: 'wi_1', inputs: [{ event: 'ev_1', step_guid, why: '' }] }) as never
    expect(frictionPlacementsOf([placed(null, '1'), placed(runTests!.guid, '2')]).get('ev_1')!.step_guid).toBe(runTests!.guid)
  })
})
