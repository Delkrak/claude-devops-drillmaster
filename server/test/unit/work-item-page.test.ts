import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { workItemPageView, workItemsListView, type WorkItemPage } from '../../src/core/workItemPage.js'

const fixture = JSON.parse(readFileSync(new URL('../viewer/fixtures/reviewed-run.json', import.meta.url), 'utf8')) as DrillmasterEvent[]
/** The moment the Workflow mock shows. */
const MOMENT = '2026-11-20T19:10:16.785Z'
const idOf = (issue: string) => workItemsListView(fixture).find((item) => item.issue === issue)!.work_item_id
const stepOf = (page: WorkItemPage, ref: string) => {
  const [stage, step] = ref.split('.').map(Number)
  return page.stages.find((candidate) => candidate.n === stage)!.steps.find((candidate) => candidate.n === step)!
}

describe('the work item page', () => {
  const bug = workItemPageView(fixture, idOf('#2'))!

  it("draws a delivered bug's route: what it passed, what it skipped and why, on the workflow it ran on", () => {
    expect(bug).toMatchObject({ issue: '#2', kind: 'bug', status: 'delivered', workflow_version: '1.0.0' })
    expect(bug.stages.flatMap((stage) => stage.steps.map((step) => `${stage.n}.${step.n} ${step.status}`))).toEqual([
      '1.1 passed',
      '2.1 passed',
      '2.2 skipped',
      '3.1 passed',
      '3.2 passed',
      '3.3 passed',
      '4.1 passed',
      '4.2 skipped',
      '4.3 passed',
      '4.4 passed',
    ])
    expect(stepOf(bug, '2.2').happened.skip).toEqual({ by: 'condition', why: 'only when kind is feature; kind is bug' })
    expect(stepOf(bug, '4.4').happened.verdicts).toMatchObject([{ by: 'drillmaster', accepted: true }])
    expect(bug.delivered).toMatchObject({ at: '2026-11-20T18:56:40.403Z', post_mortems: [{ author: 'agent' }, { author: 'drillmaster' }] })
  })

  it('pins a step-in at the step Drillmaster placed it, with why it is friction and why that step should have caught it', () => {
    expect(stepOf(bug, '3.1').step_ins).toMatchObject([{ after_delivery: true, prompt: expect.stringContaining('Show me the actual failing test output'), why: expect.stringContaining('missing evidence'), placed_why: expect.stringContaining('Step 3.1') }])
    expect(bug.step_ins_unplaced).toEqual([])
    const unplaced = workItemPageView(fixture, idOf('#4'))!
    expect(unplaced.step_ins_unplaced).toMatchObject([{ prompt: expect.any(String), placed_why: null }])
  })

  it('keeps the evidence of a step: the rules Agent checked and the output the tool kept, each line once', () => {
    const failingTest = stepOf(bug, '3.1')
    expect(failingTest.evidence.self_check).toMatchObject([{ rule: 'test 1.2', accepted: true }])
    expect(failingTest.evidence.kept_output.map((output) => [output.name, output.lines.length])).toEqual([
      ['tests', 3],
      ['failures', 2],
    ])
  })

  it('says every tool call at a step in one line, inside the project, with each gate call at the step it submitted', () => {
    expect(stepOf(bug, '3.1').calls.map((call) => `${call.tool}: ${call.did}`)).toEqual([
      'Write: test/summary.test.js',
      "Bash: npm test 2>&1 | grep -vE '^\\s+at ' | tail -40",
      'work_gate: step 3.1',
    ])
  })

  it('shows a work item in flight at a moment: where it is now, and the bug-only steps it went past', () => {
    const feature = workItemPageView(fixture, idOf('#5'), MOMENT)!
    expect(feature).toMatchObject({ status: 'active', kind: 'feature', workflow_version: '2.1.0', delivered: null })
    expect(stepOf(feature, '4.4')).toMatchObject({ status: 'here', happened: { waiting_for: null } })
    expect(stepOf(feature, '4.3')).toMatchObject({ status: 'skipped', happened: { skip: { by: 'condition', why: 'only when kind is bug; kind is feature' } } })
    expect(stepOf(feature, '2.2').happened.verdicts).toMatchObject([{ by: 'owner', accepted: true }])
  })

  it('has no page for a work item it does not know', () => {
    expect(workItemPageView(fixture, 'wi_unknown')).toBeUndefined()
  })
})

describe('the work items list', () => {
  it('lists every work item latest first, with where it is and how often Owner stepped in', () => {
    const list = workItemsListView(fixture)
    expect(list.map((item) => item.issue)).toEqual(['#8', '#7', '#6', '#5', '#4', '#3', '#2', '#1'])
    expect(list.find((item) => item.issue === '#2')).toMatchObject({ status: 'delivered', at_step: null, friction: 1, summary: 'totalUnits(rows) in src/summary.js sums row.price instead of row.units, so it returns the…' })
    expect(workItemsListView(fixture, MOMENT).find((item) => item.issue === '#5')).toMatchObject({ status: 'active', at_step: 'have the change reviewed' })
  })
})
