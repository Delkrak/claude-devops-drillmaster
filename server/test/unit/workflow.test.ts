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
      metrics: [],
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

  it('rejects a metric at a work step that does not exist, or with a repeated category', () => {
    const metric = { name: 'size', categories: [{ value: 's', description: 'small' }, { value: 'l', description: 'large' }], at: { stage: 1, step: 1 }, by: 'agent' as const, instruction: 'pick' }
    expect(() => WorkflowDocument.parse({ ...WORKFLOW_2, metrics: [metric] })).not.toThrow()
    expect(() => WorkflowDocument.parse({ ...WORKFLOW_2, metrics: [{ ...metric, at: { stage: 1, step: 9 } }] })).toThrow(/work step 1.9, which does not exist/)
    expect(() => WorkflowDocument.parse({ ...WORKFLOW_2, metrics: [{ ...metric, categories: [metric.categories[0], metric.categories[0]] }] })).toThrow(/repeats a category/)
  })

  it('reads an old document: whole-number version, no purpose, instruction, metrics or hypotheses', () => {
    const old = {
      version: 2,
      objective: OBJECTIVE,
      stages: [{ n: 1, name: 'build', steps: [{ n: 1, name: 'test', gate: 'self', rules: [], report: [] }] }],
      policies: [],
      experiments: [{ id: 1, change: 'c', purpose: 'p', measure: 'owner_corrections_per_item', baseline: 1, started: '2026-11-01' }],
    }
    const migrated = WorkflowDocument.parse(migrateWorkflow(old))
    expect(migrated).toMatchObject({ version: '2.0.0', metrics: [], stages: [{ purpose: '', steps: [{ instruction: '' }] }] })
    expect(migrated.experiments[0]).toMatchObject({ hypothesis: '', baseline_sd: 0, target: null, judge_after: 3, version: '2.0.0' })
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
