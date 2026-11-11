import { describe, expect, it } from 'vitest'
import { judgeExperiment, judgeExperiments } from '../../src/core/experiments.js'
import { measureBaselineSd, splitMeasureByInput, standardDeviation, type ItemMeasures } from '../../src/core/measures.js'
import { EXPERIMENT_1, WORKFLOW_2 } from '../helpers.js'

const item = (n: number, corrections: number, version = '2.0.0', inputs: Record<string, string> = {}): ItemMeasures => ({
  work_item_id: `wi_${n}`,
  issue: `#${n}`,
  workflow_version: version,
  delivered_at: `2026-11-1${n}T10:00:00Z`,
  inputs,
  values: { owner_corrections_per_item: corrections, gate_rejections_per_item: 0, review_rounds_per_item: 0, minutes_per_item: n, tool_calls_per_item: 1 },
})

describe("an experiment's verdict", () => {
  // Baseline 2 with sd 0.5: the null hypothesis falls when the mean drops below 1.5; the target is 0.5.

  it('keeps running until judge_after items ran on its version or later', () => {
    const verdict = judgeExperiment(EXPERIMENT_1, [item(1, 0, '1.0.0'), item(2, 0), item(3, 0)])
    expect(verdict).toMatchObject({ status: 'running', counted: 2, null_rejected: null })
  })

  it('keeps the change when the null hypothesis is rejected and the target is met', () => {
    expect(judgeExperiment(EXPERIMENT_1, [item(1, 0), item(2, 1), item(3, 0)])).toMatchObject({ status: 'keep', mean: 0.33, null_rejected: true, target_met: true })
  })

  it('rethinks the change when it is no better than the baseline spread, or misses the target', () => {
    expect(judgeExperiment(EXPERIMENT_1, [item(1, 2), item(2, 1), item(3, 2)])).toMatchObject({ status: 'rethink', null_rejected: false })
    expect(judgeExperiment(EXPERIMENT_1, [item(1, 1), item(2, 1), item(3, 1)])).toMatchObject({ status: 'rethink', null_rejected: true, target_met: false })
  })

  it('names other experiments on the same measure, because their effects mix', () => {
    const workflow = { ...WORKFLOW_2, experiments: [EXPERIMENT_1, { ...EXPERIMENT_1, id: 2 }, { ...EXPERIMENT_1, id: 3, measure: 'minutes_per_item' as const }] }
    expect(judgeExperiments(workflow, []).map((verdict) => [verdict.id, verdict.overlapping])).toEqual([
      [1, [2]],
      [2, [1]],
      [3, []],
    ])
  })
})

describe('measure helpers', () => {
  it('takes the spread of the baseline window', () => {
    expect(standardDeviation([1, 2, 3])).toBe(0.82)
    expect(standardDeviation([])).toBe(0)
    expect(measureBaselineSd([item(1, 2), item(2, 2)], 'owner_corrections_per_item')).toBe(0)
  })

  it('splits a measure by a work item input', () => {
    const items = [item(1, 2, '2.0.0', { size: 'small' }), item(2, 4, '2.0.0', { size: 'large' }), item(3, 0, '2.0.0', { size: 'small' }), item(4, 1)]
    expect(splitMeasureByInput(items, 'owner_corrections_per_item', 'size')).toEqual([
      { option: 'small', items: 2, mean: 1 },
      { option: 'large', items: 1, mean: 4 },
      { option: 'not set', items: 1, mean: 1 },
    ])
  })
})
