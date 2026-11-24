import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { OLD_FRICTION } from '../../src/core/marks.js'
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

  it('pins old friction at the step Drillmaster placed it, with why it is friction and why that step should have caught it', () => {
    expect(stepOf(bug, '3.1').marks).toMatchObject([
      { measure: OLD_FRICTION, after_delivery: true, prompts: [expect.stringContaining('Show me the actual failing test output')], why: expect.stringContaining('missing evidence'), placed_why: expect.stringContaining('Step 3.1') },
    ])
    expect(bug.marks_no_step).toEqual([])
    const unplaced = workItemPageView(fixture, idOf('#4'))!
    expect(unplaced.marks_no_step).toMatchObject([{ measure: OLD_FRICTION, prompts: [expect.any(String)], placed_why: expect.stringContaining('no step of this workflow covers') }])
  })

  it("pins each occurrence of a shown measure at its step, with what Owner said, and leaves out a measure the workflow doesn't show", () => {
    const id = idOf('#2')
    const ownerPrompt = fixture.find((event) => event.type === 'work_trace' && event.work_item_id === id && event.hook === 'UserPromptSubmit')!
    const workflow = { ...(fixture.findLast((event) => event.type === 'workflow_changed') as Extract<DrillmasterEvent, { type: 'workflow_changed' }>).workflow }
    const measures = [
      { name: 'policy friction', definition: 'd', show: true },
      { name: 'retries', definition: 'd', show: false },
    ]
    const events = [
      ...fixture,
      { id: 'ev_measures', at: '2026-11-20T23:00:00.000Z', type: 'workflow_changed', workflow: { ...workflow, version: '3.0.1', measures }, reason: 'measures' },
      {
        id: 'ev_late',
        at: '2026-11-20T23:00:01.000Z',
        type: 'late_measures_judged',
        work_item_id: id,
        through: ownerPrompt.id,
        measured: [{ measure: 'policy friction', occurrences: [{ step_guid: stepOf(bug, '3.1').guid, events: [ownerPrompt.id], why: 'a rule should have caught it' }] }],
      },
    ] as DrillmasterEvent[]
    const judgedPostMortem = {
      id: 'ev_pm',
      at: '2026-11-20T22:00:00.000Z',
      type: 'post_mortem_written',
      work_item_id: id,
      author: 'drillmaster',
      keep: [],
      change: [],
      experiment_reflections: [],
      measured: [
        { measure: 'policy friction', occurrences: [{ step_guid: null, events: [], why: 'no rule covers it' }] },
        { measure: 'retries', occurrences: [{ step_guid: stepOf(bug, '3.1').guid, events: [], why: 'ran the tests twice' }] },
      ],
    } as DrillmasterEvent
    // A late judgement adds to the post mortem's; without a post mortem that judged the measures, there is nothing to add to.
    expect(stepOf(workItemPageView(events, id)!, '3.1').marks.map((mark) => mark.measure)).toEqual([OLD_FRICTION])
    const page = workItemPageView([...events, judgedPostMortem], id)!
    expect(page.measures.map((measure) => measure.name)).toEqual(['policy friction', 'owner_friction_per_item', OLD_FRICTION])
    expect(stepOf(page, '3.1').marks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ measure: OLD_FRICTION }),
        expect.objectContaining({ measure: 'policy friction', prompts: [ownerPrompt.type === 'work_trace' ? ownerPrompt.prompt : ''], why: 'a rule should have caught it' }),
      ]),
    )
    expect(stepOf(page, '3.1').marks).toHaveLength(2)
    expect(page.marks_no_step).toMatchObject([{ measure: 'policy friction', why: 'no rule covers it' }])
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

  it('draws where the work item stands now: going back undoes the passes after it', () => {
    const id = idOf('#5')
    const atMoment = fixture.filter((event) => event.at <= MOMENT)
    const backToStart = { id: 'ev_back', at: '2026-11-20T19:10:17.000Z', type: 'input_set', work_item_id: id, stage: 4, step: 4, name: 'kind', value: 'feature', by: 'owner', goes_back: { to: { stage: 1, step: 1 }, kept: [] } } as DrillmasterEvent
    const page = workItemPageView([...atMoment, backToStart], id)!
    expect(stepOf(page, '1.1').status).toBe('here')
    expect(stepOf(page, '2.2').status).toBe('ahead')
    expect(stepOf(page, '4.4').status).toBe('ahead')
  })

  it("places every gate call, even one whose input was cut short or names its step as 'step 4.4', and lists failed calls", () => {
    const id = idOf('#2')
    const trace = (extra: object) => ({ at: '2026-11-20T18:56:20.000Z', type: 'work_trace', session_id: 's', work_item_id: id, stage: 4, step: 4, step_guid: stepOf(bug, '4.4').guid, ...extra }) as DrillmasterEvent
    const events = [
      ...fixture,
      trace({ id: 'ev_cut', hook: 'PostToolUse', tool: 'mcp__x__work_gate', input: '{"step":"4.4","text":"a very long report...' }),
      trace({ id: 'ev_prefixed', hook: 'PostToolUse', tool: 'mcp__x__work_gate', stage: null, step: null, step_guid: undefined, input: '{"step":"step 4.4"}' }),
      trace({ id: 'ev_failed', hook: 'PostToolUseFailure', tool: 'Bash', input: '{"command":"npm test"}', error: true }),
    ]
    const calls = stepOf(workItemPageView(events, id)!, '4.4').calls
    expect(calls.slice(-3).map((call) => [call.tool, call.did, call.failed])).toEqual([
      ['work_gate', '{"step":"4.4","text":"a very long report...', false],
      ['work_gate', 'step 4.4', false],
      ['Bash', 'npm test', true],
    ])
  })

  it('shows the work Agent added after delivery, with the correction that asked for it', () => {
    const id = idOf('#2')
    const addedStep = { id: 'ev_added', at: '2026-11-20T18:58:00.000Z', type: 'work_reported', work_item_id: id, stage: null, step: null, kind: 'added_step', text: 'Showed the failing test output.', why: 'Owner asked to see it.' } as DrillmasterEvent
    expect(workItemPageView([...fixture, addedStep], id)!.delivered!.added_steps).toEqual([{ at: '2026-11-20T18:58:00.000Z', text: 'Showed the failing test output.', why: 'Owner asked to see it.' }])
  })

  it('has no page for a work item it does not know', () => {
    expect(workItemPageView(fixture, 'wi_unknown')).toBeUndefined()
  })
})

describe('the work items list', () => {
  it('lists every work item latest first, with where it is and how often Owner stepped in', () => {
    const list = workItemsListView(fixture)
    expect(list.map((item) => item.issue)).toEqual(['#8', '#7', '#6', '#5', '#4', '#3', '#2', '#1'])
    expect(list.find((item) => item.issue === '#2')).toMatchObject({ status: 'delivered', at_step: null, marks: [{ measure: OLD_FRICTION, count: 1 }], summary: 'totalUnits(rows) in src/summary.js sums row.price instead of row.units, so it returns the…' })
    expect(workItemsListView(fixture, MOMENT).find((item) => item.issue === '#5')).toMatchObject({ status: 'active', at_step: 'have the change reviewed' })
  })
})
