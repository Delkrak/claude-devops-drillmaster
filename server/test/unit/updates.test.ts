import { describe, expect, it } from 'vitest'
import { applyWorkflowOps } from '../../src/core/retro.js'
import { describeWorkflowChange, levelBetween, stepUnchanged } from '../../src/core/updates.js'
import { WORKFLOW_3 } from '../helpers.js'

const guidOf = (stage: number, step: number) => WORKFLOW_3.stages[stage - 1]!.steps[step - 1]!.guid

describe('what an update compares', () => {
  it('names the highest part of the version that changed', () => {
    expect(levelBetween('3.0.0', '4.0.0')).toBe('major')
    expect(levelBetween('3.0.0', '3.2.0')).toBe('minor')
    expect(levelBetween('3.0.0', '3.0.1')).toBe('patch')
    expect(levelBetween('3.0.0', '3.0.0')).toBeNull()
  })

  it('counts a change to the step, its stage or the policy of its rules as a change, and nothing else', () => {
    const renamedStage = applyWorkflowOps(WORKFLOW_3, [{ op: 'change_stage', stage: '1', name: 'make' }])
    expect(stepUnchanged(WORKFLOW_3, renamedStage, guidOf(1, 1))).toBe(false)
    const reworded = applyWorkflowOps(WORKFLOW_3, [{ op: 'change_rule', rule: 'pr 1.1', text: 'the PR says what and why' }])
    expect(stepUnchanged(WORKFLOW_3, reworded, guidOf(1, 1))).toBe(true)
    expect(stepUnchanged(WORKFLOW_3, reworded, guidOf(1, 2))).toBe(false)
    const moved = applyWorkflowOps(WORKFLOW_3, [{ op: 'add_step', stage: '1', after: '0', step: { name: 'read', instruction: 'Read it.', gate: 'self', rules: [], report: [] } }])
    expect(stepUnchanged(WORKFLOW_3, moved, guidOf(1, 1))).toBe(true)
  })

  it('describes what changed in the steps, by GUID', () => {
    const next = applyWorkflowOps(WORKFLOW_3, [
      { op: 'add_step', stage: '1', after: '0', step: { name: 'read', instruction: 'Read it.', gate: 'self', rules: [], report: [] } },
      { op: 'change_step', step: '1.3', name: 'describe the PR' },
      { op: 'remove_step', step: '2.1' },
    ])
    expect(describeWorkflowChange(WORKFLOW_3, next)).toEqual([
      '- new: step 1.1 "read" (self gate)',
      '- moved: step 1.2 "run the tests" (was 1.1)',
      '- changed: step 1.3 "describe the PR" (was 1.2)',
      '- removed: step 2.1 "Owner approves"',
    ])
  })
})
