import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent, MeasureJudgement } from '../../src/core/events.js'
import { averageMeasure, measureBaseline, measureDeliveredItems } from '../../src/core/measures.js'
import { judgeExperiment } from '../../src/core/experiments.js'
import { itemsToJudgeLate, readLateMeasuresAnswer } from '../../src/core/judgedMeasures.js'
import { buildPostMortemPrompt, buildRetroPrompt, readPostMortemAnswer } from '../../src/core/retro.js'
import { foldState } from '../../src/core/state.js'
import { WORKFLOW_3 } from '../helpers.js'

const POLICY_FRICTION = { name: 'policy friction', short: 'PF', color: 'orange' as const, definition: 'Owner caught what a rule should have caught.', show: true }
const PROCESS_FRICTION = { name: 'process friction', short: 'PC', color: 'rose' as const, definition: 'Owner overruled an earlier decision, or the delivery was not what Owner wanted.', show: false }
const workflow = { ...WORKFLOW_3, measures: [POLICY_FRICTION, PROCESS_FRICTION] }
const [testsStep] = WORKFLOW_3.stages[0]!.steps

const at = (n: number) => `2026-11-24T10:${String(n).padStart(2, '0')}:00Z`
let clock = 0
const event = (fields: Record<string, unknown>) => ({ id: `e${clock}`, at: at(clock++), ...fields }) as DrillmasterEvent

function deliveredItem(workItemId: string, deliveredBy: string, measured?: MeasureJudgement[]) {
  return [
    event({ type: 'work_item_started', work_item_id: workItemId, issue: `#${workItemId}`, workflow_version: '3.0.0', token_hash: workItemId, stage: 1, step: 1 }),
    event({ type: 'session_bound', session_id: `s-${workItemId}`, work_item_id: workItemId }),
    event({ type: 'work_trace', session_id: `s-${workItemId}`, work_item_id: workItemId, stage: 1, step: 1, hook: 'UserPromptSubmit', prompt: 'you forgot the tests' }),
    event({ type: 'gate_verdict', work_item_id: workItemId, stage: 1, step: 1, accepted: false, by: 'owner', via: 'question', why: 'no tests', rule: null, next: { stage: 1, step: 1 }, done: false }),
    event({ type: 'work_item_delivered', work_item_id: workItemId, pr: 'local', drillmaster_version: deliveredBy }),
    ...(measured ? [event({ type: 'post_mortem_written', work_item_id: workItemId, author: 'drillmaster', keep: [], change: [], experiment_reflections: [], measured })] : []),
  ]
}

describe("Drillmaster's post mortem judges the workflow's measures", () => {
  const events = [event({ type: 'project_initialized', dir: '/p', workflow }), ...deliveredItem('wi_1', '0.4.0')]
  const item = foldState(events).workItems.wi_1!
  const itemEventIds = new Set(events.filter((candidate) => 'work_item_id' in candidate && candidate.work_item_id === 'wi_1').map((candidate) => candidate.id))

  it('gives each measure with its definition, and names every recorded event by its id', () => {
    const prompt = buildPostMortemPrompt(item, workflow, events)
    expect(prompt).toContain('- "policy friction": Owner caught what a rule should have caught.')
    expect(prompt).toContain('- "process friction": Owner overruled an earlier decision')
    const ownerPrompt = events.find((candidate) => candidate.type === 'work_trace')!
    expect(prompt).toContain(`- ${ownerPrompt.id} UserPromptSubmit Owner: "you forgot the tests"`)
    expect(prompt).toContain('"measured":[')
  })

  it("places each occurrence at its step, keeps only the work item's events, and counts a measure left out as none", () => {
    const ownerPrompt = events.find((candidate) => candidate.type === 'work_trace')!
    const answer = {
      keep: [],
      change: [],
      experiment_reflections: [],
      measured: [
        { measure: 'policy friction', occurrences: [{ step: '1.1', events: [ownerPrompt.id, 'e_elsewhere'], why: 'a test rule should have caught it' }, { step: null, events: [], why: 'no step covers it' }] },
        { measure: 'happiness', occurrences: [{ step: '1.1', events: [], why: 'not a measure' }] },
      ],
    }
    expect(readPostMortemAnswer(answer, workflow, [], itemEventIds).measured).toEqual([
      {
        measure: 'policy friction',
        occurrences: [
          { step_guid: testsStep!.guid, events: [ownerPrompt.id], why: 'a test rule should have caught it' },
          { step_guid: null, events: [], why: 'no step covers it' },
        ],
      },
      { measure: 'process friction', occurrences: [] },
    ])
  })
})

describe('the value of a judged measure', () => {
  const judged = (policy: number): MeasureJudgement[] => [
    { measure: 'policy friction', occurrences: Array.from({ length: policy }, () => ({ step_guid: null, events: [], why: '' })) },
    { measure: 'process friction', occurrences: [] },
  ]

  it('is the number of occurrences Drillmaster judged; a work item it has not judged has none', () => {
    const items = measureDeliveredItems([event({ type: 'project_initialized', dir: '/p', workflow }), ...deliveredItem('wi_1', '0.4.0', judged(2)), ...deliveredItem('wi_2', '0.4.0')])
    expect(items.map((item) => [item.values['policy friction'], item.values['process friction']])).toEqual([
      [2, 0],
      [undefined, undefined],
    ])
    expect(averageMeasure(items, 'policy friction')).toBe(2)
    expect(averageMeasure(items, 'gate_rejections_per_item')).toBe(1)
  })

  it("keeps owner friction as Drillmaster 0.3 counted it for the work items it delivered, and doesn't count it after", () => {
    const items = measureDeliveredItems([event({ type: 'project_initialized', dir: '/p', workflow }), ...deliveredItem('wi_old', '0.3.1'), ...deliveredItem('wi_new', '0.4.0')])
    expect(items.map((item) => item.values.owner_friction_per_item)).toEqual([2, undefined])
  })

  it('takes a baseline from the last five work items judged on the measure', () => {
    const events = [event({ type: 'project_initialized', dir: '/p', workflow }), ...[1, 2, 3, 4, 5].flatMap((n) => deliveredItem(`wi_${n}`, '0.4.0', judged(n))), ...deliveredItem('wi_6', '0.4.0')]
    expect(measureBaseline(measureDeliveredItems(events), 'policy friction')).toBe(3)
  })
})

describe('the retrospective', () => {
  it('reads each measure the workflow defines, and every occurrence at the step that should have caught it', () => {
    const measured: MeasureJudgement[] = [
      { measure: 'policy friction', occurrences: [{ step_guid: testsStep!.guid, events: [], why: 'the test rule should have caught the missing tests' }] },
      { measure: 'process friction', occurrences: [{ step_guid: null, events: [], why: 'Owner wanted a button, not a file' }] },
    ]
    const events = [event({ type: 'project_initialized', dir: '/p', workflow }), ...deliveredItem('wi_1', '0.4.0', measured)]
    const prompt = buildRetroPrompt(foldState(events), events, [])
    expect(prompt).toContain('- "policy friction" (judged): Owner caught what a rule should have caught.')
    expect(prompt).toContain('- wi_1 (#wi_1), policy friction, step 1.1: the test rule should have caught the missing tests')
    expect(prompt).toContain('- wi_1 (#wi_1), process friction, no step covers it: Owner wanted a button, not a file')
    expect(prompt).toContain('{"op":"add_measure"')
  })
})

describe('what Drillmaster judges later, at the retrospective', () => {
  const none: MeasureJudgement[] = [
    { measure: 'policy friction', occurrences: [] },
    { measure: 'process friction', occurrences: [] },
  ]
  const prompt = (workItemId: string, text: string) => event({ type: 'work_trace', session_id: `s-${workItemId}`, work_item_id: workItemId, stage: null, step: null, hook: 'UserPromptSubmit', prompt: text })

  it('judges what came after the last event the post mortem read, even what was recorded while it was written', () => {
    const delivered = deliveredItem('wi_1', '0.4.0')
    const whileWriting = prompt('wi_1', 'the button is missing')
    const postMortem = event({ type: 'post_mortem_written', work_item_id: 'wi_1', author: 'drillmaster', keep: [], change: [], experiment_reflections: [], measured: none, judged_through: delivered.at(-1)!.id })
    const late = itemsToJudgeLate([event({ type: 'project_initialized', dir: '/p', workflow }), ...delivered, whileWriting, postMortem])
    expect(late.map(({ workItemId, unjudged }) => [workItemId, unjudged.map((judged) => judged.id)])).toEqual([['wi_1', [whileWriting.id]]])
  })

  it('leaves a work item alone when what Owner said since belongs to a retrospective or another work item', () => {
    const delivered = deliveredItem('wi_1', '0.4.0', none)
    const retro = prompt('wi_1', "let's do a retro")
    const retroCall = event({ type: 'work_trace', session_id: 's-wi_1', work_item_id: 'wi_1', stage: null, step: null, hook: 'PreToolUse', tool: 'mcp__x__workflow_retrospective' })
    expect(itemsToJudgeLate([event({ type: 'project_initialized', dir: '/p', workflow }), ...delivered, retro, retroCall])).toEqual([])
  })

  it('adds a measure it judged only later, so the values match the pages', () => {
    const delivered = deliveredItem('wi_1', '0.4.0', [{ measure: 'policy friction', occurrences: [] }])
    const late = event({ type: 'late_measures_judged', work_item_id: 'wi_1', through: delivered.at(-1)!.id, measured: [{ measure: 'process friction', occurrences: [{ step_guid: null, events: [], why: 'not what Owner wanted' }] }] })
    expect(measureDeliveredItems([event({ type: 'project_initialized', dir: '/p', workflow }), ...delivered, late])[0]!.values).toMatchObject({ 'policy friction': 0, 'process friction': 1 })
  })
})

describe('an answer that judges no measures', () => {
  it('leaves the measures unjudged instead of counting none', () => {
    expect(readPostMortemAnswer({ keep: [], change: [], experiment_reflections: [] }, workflow, [])).not.toHaveProperty('measured')
    expect(readLateMeasuresAnswer(workflow, [], 'I could not judge it.')).toBeUndefined()
    expect(readPostMortemAnswer({ keep: [], change: [], experiment_reflections: [] }, { ...workflow, measures: [] }, []).measured).toEqual([])
  })
})

describe('an experiment on a judged measure', () => {
  it('counts only the work items judged on it toward its verdict', () => {
    const judged = (n: number) => [{ measure: 'policy friction', occurrences: Array.from({ length: n }, () => ({ step_guid: null, events: [], why: '' })) }]
    const events = [event({ type: 'project_initialized', dir: '/p', workflow }), ...deliveredItem('wi_1', '0.4.0', judged(0)), ...deliveredItem('wi_2', '0.4.0'), ...deliveredItem('wi_3', '0.4.0', judged(1))]
    const experiment = { id: 1, change: 'c', purpose: 'p', hypothesis: '', null_hypothesis: '', measure: 'policy friction', baseline: 2, baseline_sd: 0.5, target: null, judge_after: 2, version: '3.0.0', started: '2026-11-24' }
    expect(judgeExperiment(experiment, measureDeliveredItems(events))).toMatchObject({ counted: 2, mean: 0.5, status: 'keep' })
  })
})
