import { describe, expect, it } from 'vitest'
import { guidFromSeed, InvalidReference, parseRef, refOfGuid, resolveRef } from '../../src/core/refs.js'
import { applyWorkflowOps } from '../../src/core/retro.js'
import { WORKFLOW_3 } from '../helpers.js'

describe('references', () => {
  it('reads <kind> <name>, and leaves the kind out where the field fixes it', () => {
    expect(parseRef('step 1.2')).toEqual({ kind: 'step', name: '1.2' })
    expect(parseRef('rule pr 1.1')).toEqual({ kind: 'rule', name: 'pr 1.1' })
    expect(parseRef('1.2', 'step')).toEqual({ kind: 'step', name: '1.2' })
    expect(parseRef('step 1.2', 'step')).toEqual({ kind: 'step', name: '1.2' })
    expect(parseRef('pr 1.1', 'rule')).toEqual({ kind: 'rule', name: 'pr 1.1' })
    expect(() => parseRef('1.2')).toThrow(InvalidReference)
    expect(() => parseRef('experiment 1')).toThrow(/the kinds are step, stage, rule, policy, input, capture, tool/)
  })

  it('resolves every kind to its GUID, and back', () => {
    const tools = { toolNames: ['work_gate'] }
    const resolved = ['step 1.2', 'stage 2', 'rule pr 1.1', 'policy test', 'tool work_gate'].map((text) => resolveRef(WORKFLOW_3, text, tools))
    expect(resolved.map((ref) => [ref.ref, ref.title])).toEqual([
      ['step 1.2', 'say what the pull request changes'],
      ['stage 2', 'review'],
      ['rule pr 1.1', 'the PR says what it changes'],
      ['policy test', 'test'],
      ['tool work_gate', 'work_gate'],
    ])
    expect(resolved[0]!.guid).toBe(WORKFLOW_3.stages[0]!.steps[1]!.guid)
    expect(resolved.at(-1)!.guid).toBeNull()
    for (const ref of resolved.slice(0, -1)) expect(refOfGuid(WORKFLOW_3, ref.guid!)?.ref).toBe(ref.ref)
  })

  it('refuses what is not there, saying which version it looked in', () => {
    expect(() => resolveRef(WORKFLOW_3, 'step 1.9')).toThrow('There is no step 1.9 in workflow 3.0.0.')
    expect(() => resolveRef(WORKFLOW_3, 'step one')).toThrow(/write it as <stage>.<step>/)
    expect(() => resolveRef(WORKFLOW_3, 'rule pr 9.9')).toThrow(/no rule "pr 9.9"/)
    expect(() => resolveRef(WORKFLOW_3, 'tool rm_rf', { toolNames: ['work_gate'] })).toThrow(/the tools are work_gate/)
  })

  it('follows a step across versions: the same GUID under a new number', () => {
    const next = applyWorkflowOps(WORKFLOW_3, [{ op: 'add_step', stage: '1', after: '0', step: { name: 'read the issue', instruction: 'Read it.', gate: 'self', rules: [], report: [] } }])
    const before = resolveRef(WORKFLOW_3, 'step 1.1')
    expect(refOfGuid(next, before.guid!)?.ref).toBe('step 1.2')
    expect(refOfGuid(next, guidFromSeed('nothing'))).toBeUndefined()
  })
})
