import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { changesView, workflowEdits } from '../../src/core/changesPage.js'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { WORKFLOW_3 } from '../helpers.js'

const fixture = JSON.parse(readFileSync(new URL('../viewer/fixtures/reviewed-run.json', import.meta.url), 'utf8')) as DrillmasterEvent[]

describe('the changes page', () => {
  it('lists every change to the workflow, latest first, with its measure before and after and its verdict', () => {
    expect(changesView(fixture).map((row) => [row.version, row.before, row.after, row.counted, row.judge_after, row.outcome])).toEqual([
      ['3.0.0', 0.4, 0, 2, 3, 'insufficient data'],
      ['2.1.0', 0.67, 0.33, 3, 3, 'not significant'],
      ['2.0.0', 0.67, 0.33, 3, 3, 'not significant'],
    ])
  })

  it('says why each change was made and what it did to the steps and rules', () => {
    const [handOver, failingTest] = changesView(fixture)
    expect(failingTest).toMatchObject({ from_version: '2.0.0', measure: 'owner_friction_per_item', purpose: expect.stringContaining('Removes the friction from #2') })
    expect(handOver!.edits).toEqual([
      { what: 'new', kind: 'step', ref: 'step 5.1', name: 'hand the work item over to Owner', was: null },
      { what: 'new', kind: 'rule', ref: 'rule handover 1.1', name: expect.stringContaining('the delivery summary restates'), was: null },
    ])
  })

  it('shows the changes made by a moment, with the verdict as it stood then', () => {
    expect(changesView(fixture, '2026-11-20T19:10:16.785Z').map((row) => [row.version, row.counted, row.outcome])).toEqual([
      ['2.1.0', 1, 'insufficient data'],
      ['2.0.0', 1, 'insufficient data'],
    ])
  })

  it('names a step that moved, and a step or rule that went away', () => {
    const [build, review] = WORKFLOW_3.stages
    const moved = { ...WORKFLOW_3, stages: [{ ...build!, steps: [{ ...build!.steps[1]!, n: 1 }] }, review!], policies: WORKFLOW_3.policies.slice(1) }
    expect(workflowEdits(WORKFLOW_3, moved)).toEqual([
      { what: 'moved', kind: 'step', ref: 'step 1.1', name: 'say what the pull request changes', was: 'step 1.2' },
      { what: 'removed', kind: 'step', ref: 'step 1.1', name: 'run the tests', was: null },
      { what: 'removed', kind: 'rule', ref: 'rule test 1.1', name: 'the tests run green before a PR', was: null },
    ])
  })
})
