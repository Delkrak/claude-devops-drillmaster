import { describe, expect, it } from 'vitest'
import { bumpVersion, compareVersions, findRule, migrateWorkflow, WorkflowDocument, workflowZero } from '../../src/core/workflow.js'
import { OBJECTIVE, WORKFLOW_2 } from '../helpers.js'

describe('workflow document', () => {
  it('workflow_0 holds only Owner\'s objective', () => {
    expect(workflowZero(OBJECTIVE as never)).toEqual({
      version: '0.0.0',
      objective: OBJECTIVE,
      stages: [],
      policies: [],
      inputs: [],
      tool_captures: [],
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

  it('rejects an input at a work step that does not exist, or with a repeated option', () => {
    const input = { guid: 'guid-size', name: 'size', options: [{ value: 's', description: 'small' }, { value: 'l', description: 'large' }], set_at: '1.1', by: 'agent' as const, instruction: 'pick' }
    expect(() => WorkflowDocument.parse({ ...WORKFLOW_2, inputs: [input] })).not.toThrow()
    expect(() => WorkflowDocument.parse({ ...WORKFLOW_2, inputs: [{ ...input, set_at: 'start' }] })).not.toThrow()
    expect(() => WorkflowDocument.parse({ ...WORKFLOW_2, inputs: [{ ...input, set_at: '1.9' }] })).toThrow(/work step 1.9, which does not exist/)
    expect(() => WorkflowDocument.parse({ ...WORKFLOW_2, inputs: [{ ...input, options: [input.options[0], input.options[0]] }] })).toThrow(/repeats an option/)
  })

  it('reads an old document: whole-number version, no purpose, instruction, inputs or hypotheses', () => {
    const old = {
      version: 2,
      objective: OBJECTIVE,
      stages: [{ n: 1, name: 'build', steps: [{ n: 1, name: 'test', gate: 'self', rules: [], report: [] }] }],
      policies: [],
      experiments: [{ id: 1, change: 'c', purpose: 'p', measure: 'owner_friction_per_item', baseline: 1, started: '2026-11-01' }],
    }
    const migrated = WorkflowDocument.parse(migrateWorkflow(old))
    expect(migrated).toMatchObject({ version: '2.0.0', inputs: [], stages: [{ purpose: '', steps: [{ instruction: '' }] }] })
    expect(migrated.experiments[0]).toMatchObject({ hypothesis: '', baseline_sd: 0, target: null, judge_after: 3, version: '2.0.0' })
  })

  it('gives an old document GUIDs that follow its components through the versions, by name', () => {
    const stage = (steps: string[]) => ({ n: 1, name: 'build', steps: steps.map((name, index) => ({ n: index + 1, name, gate: 'self', rules: [], report: [] })) })
    const first = migrateWorkflow({ version: 1, objective: OBJECTIVE, stages: [stage(['test', 'describe'])], policies: [{ name: 'pr', rules: [{ id: '1.1', rule: 'r', verified_by: 'v' }] }] })
    const second = migrateWorkflow({ version: 2, objective: OBJECTIVE, stages: [stage(['read', 'test', 'describe'])], policies: [{ name: 'pr', rules: [{ id: '1.1', rule: 'r', verified_by: 'v' }] }] }, first)
    expect(second.stages[0]!.steps[1]!.guid).toBe(first.stages[0]!.steps[0]!.guid)
    expect(second.stages[0]!.steps[2]!.guid).toBe(first.stages[0]!.steps[1]!.guid)
    expect(second.policies[0]!.rules[0]!.guid).toBe(first.policies[0]!.rules[0]!.guid)
    expect(new Set(second.stages[0]!.steps.map((step) => step.guid)).size).toBe(3)
    expect(migrateWorkflow({ version: 1, objective: OBJECTIVE, stages: [stage(['test', 'describe'])], policies: [] })).toEqual(migrateWorkflow({ version: 1, objective: OBJECTIVE, stages: [stage(['test', 'describe'])], policies: [] }))
    expect(() => WorkflowDocument.parse({ ...second, stages: [{ ...second.stages[0]!, guid: second.stages[0]!.steps[0]!.guid }] })).toThrow(/used twice/)
  })

  it('counts versions in semver', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
  })

  it('resolves a rule reference', () => {
    expect(findRule(WORKFLOW_2, 'pr 1.1')).toMatchObject({ policy: 'pr', id: '1.1', rule: 'the PR says what it changes' })
    expect(findRule(WORKFLOW_2, 'pr 2.1')).toBeUndefined()
  })
})
