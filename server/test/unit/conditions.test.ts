import { describe, expect, it } from 'vitest'
import { conditionInWords, describeInputsOf, evaluateCondition, InvalidCondition, parseCondition } from '../../src/core/conditions.js'
import { migrateWorkflow, WorkflowDocument } from '../../src/core/workflow.js'
import { WORKFLOW_3 } from '../helpers.js'

const evaluate = (text: string, inputs: Record<string, string>) => evaluateCondition(parseCondition(text), inputs)

describe('the if of a stage or step', () => {
  it('says a condition in plain words, with brackets where parts join the other way', () => {
    const words = (text: string) => conditionInWords(parseCondition(text))
    expect(words("kind == 'feature' || user_visible == 'yes'")).toBe('kind is feature or user visible is yes')
    expect(words("kind == 'feature' && (user_visible == 'yes' || risk == 'high')")).toBe('kind is feature and (user visible is yes or risk is high)')
    expect(words("(kind == 'bug' && size == 'large') || risk == 'high'")).toBe('(kind is bug and size is large) or risk is high')
    expect(words("kind == 'a' || kind == 'b' || kind == 'c'")).toBe('kind is a or kind is b or kind is c')
  })


  it('reads comparisons joined with &&, || and !, grouped with parentheses', () => {
    expect(evaluate("kind == 'bug'", { kind: 'bug' })).toBe(true)
    expect(evaluate("kind != 'bug'", { kind: 'bug' })).toBe(false)
    expect(evaluate("kind in ['bug', 'chore']", { kind: 'chore' })).toBe(true)
    expect(evaluate(`kind == "feature" || user_visible == 'yes'`, { kind: 'bug', user_visible: 'yes' })).toBe(true)
    expect(evaluate("kind == 'feature' && !(size == 'small')", { kind: 'feature', size: 'large' })).toBe(true)
    expect(evaluate("!(kind == 'feature' && size == 'small')", { kind: 'feature', size: 'small' })).toBe(false)
  })

  it('needs an unset input only where it decides the outcome', () => {
    expect(evaluate("kind == 'bug'", {})).toEqual({ missing: ['kind'] })
    expect(evaluate("kind == 'bug' || size == 'large'", { kind: 'bug' })).toBe(true)
    expect(evaluate("kind == 'bug' && size == 'large'", { kind: 'feature' })).toBe(false)
    expect(evaluate("kind == 'bug' && size == 'large'", { kind: 'bug' })).toEqual({ missing: ['size'] })
    expect(evaluate("!(kind == 'bug')", {})).toEqual({ missing: ['kind'] })
  })

  it('says why a condition is not met by the inputs it reads', () => {
    expect(describeInputsOf(parseCondition("kind == 'bug' || size == 'large'"), { kind: 'feature' })).toBe('kind is feature, size is not set')
  })

  it('refuses what it cannot read, saying where', () => {
    expect(() => parseCondition('')).toThrow(InvalidCondition)
    expect(() => parseCondition("kind = 'bug'")).toThrow(/unexpected "="/)
    expect(() => parseCondition('kind == bug')).toThrow(/expected a quoted value at "bug"/)
    expect(() => parseCondition("kind == 'bug' size == 'large'")).toThrow(/expected &&, \|\| or the end at "size"/)
    expect(() => parseCondition("(kind == 'bug'")).toThrow(/expected "\)" at the end/)
    expect(() => parseCondition("inputs.kind == 'bug'")).toThrow(/unexpected "\."/)
  })
})

describe('a workflow with conditions', () => {
  const kind = { guid: 'guid-kind', name: 'kind', options: [{ value: 'bug', description: 'wrong' }, { value: 'feature', description: 'new' }], set_at: 'start', by: 'agent' as const, instruction: 'Bug or feature?' }
  const withIf = (stageIf: string | undefined, stepIf: string | undefined, input = kind) => {
    const workflow = structuredClone(WORKFLOW_3)
    if (stageIf) workflow.stages[1]!.if = stageIf
    if (stepIf) workflow.stages[0]!.steps[1]!.if = stepIf
    return { ...workflow, inputs: [input] }
  }

  it('takes a condition on inputs set at start or before it', () => {
    expect(() => WorkflowDocument.parse(withIf("kind == 'feature'", "kind == 'bug'"))).not.toThrow()
    expect(() => WorkflowDocument.parse(withIf("kind == 'feature'", undefined, { ...kind, set_at: '1.2' }))).not.toThrow()
  })

  it('refuses one that reads an unknown input, an unknown option, or an input set at or after it', () => {
    const problems = (workflow: unknown) => WorkflowDocument.safeParse(workflow).error?.issues.map((issue) => issue.message)
    expect(problems(withIf("size == 'large'", undefined))).toEqual(['the if of work stage 2: it reads input "size", which does not exist'])
    expect(problems(withIf(undefined, "kind == 'chore'"))).toEqual(['the if of work step 1.2: input "kind" has no option "chore"; its options are bug, feature'])
    expect(problems(withIf(undefined, "kind == 'bug'", { ...kind, set_at: '1.2' }))).toEqual(['the if of work step 1.2: it reads input "kind", which is set at work step 1.2, not before'])
    expect(problems(withIf("kind == 'bug'", undefined, { ...kind, set_at: '2.1' }))).toEqual(['the if of work stage 2: it reads input "kind", which is set at work step 2.1, not before'])
    expect(problems(withIf(undefined, 'kind ='))).toEqual(['the if of work step 1.2: "kind =": unexpected "=" at 6.'])
  })

  it('reads metrics written before they were inputs, keeping their GUIDs', () => {
    const migrated = migrateWorkflow({ ...WORKFLOW_3, inputs: undefined, metrics: [{ guid: 'guid-size', name: 'size', categories: kind.options, at_step: '1.1', by: 'agent', instruction: 'How big?' }] })
    expect(migrated.inputs).toEqual([{ guid: 'guid-size', name: 'size', options: kind.options, set_at: '1.1', by: 'agent', instruction: 'How big?' }])
    expect(migrated).not.toHaveProperty('metrics')
  })
})
