import { describe, expect, it } from 'vitest'
import { findRule, WorkflowDocument, workflowZero } from '../../src/core/workflow.js'
import { OBJECTIVE, WORKFLOW_2 } from '../helpers.js'

describe('workflow document', () => {
  it('workflow_0 holds only Owner\'s objective', () => {
    expect(workflowZero(OBJECTIVE as never)).toEqual({
      version: 0,
      objective: OBJECTIVE,
      stages: [],
      policies: [],
      experiments: [],
    })
  })

  it('accepts a valid grown workflow', () => {
    expect(WorkflowDocument.parse(WORKFLOW_2)).toEqual(WORKFLOW_2)
  })

  it('rejects an objective with a measure v1 cannot compute', () => {
    expect(() => workflowZero({ text: 'x', measures: ['happiness' as never] })).toThrow()
  })

  it('rejects work stages and work steps out of order', () => {
    const bad = structuredClone(WORKFLOW_2)
    bad.stages[0]!.steps[1]!.n = 3
    expect(() => WorkflowDocument.parse(bad)).toThrow(/work step 1.2 is numbered 1.3/)
  })

  it('rejects a work gate referencing a rule that does not exist', () => {
    const bad = structuredClone(WORKFLOW_2)
    bad.stages[0]!.steps[0]!.rules = ['pr 9.9']
    expect(() => WorkflowDocument.parse(bad)).toThrow(/unknown rule \\"pr 9.9\\"/)
  })

  it('resolves a rule reference', () => {
    expect(findRule(WORKFLOW_2, 'pr 1.1')).toMatchObject({ policy: 'pr', id: '1.1', rule: 'the PR says what it changes' })
    expect(findRule(WORKFLOW_2, 'pr 2.1')).toBeUndefined()
  })
})
