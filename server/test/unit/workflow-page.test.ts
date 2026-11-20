import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { migrateEvent } from '../../src/core/feedback.js'
import { migrateWorkflow, type WorkflowDocument } from '../../src/core/workflow.js'
import { workflowPageView, type WorkflowPage } from '../../src/core/workflowPage.js'

const FIXTURE = new URL('../viewer/fixtures/reviewed-run.json', import.meta.url)
const reviewedRun = () => (JSON.parse(readFileSync(FIXTURE, 'utf8')) as DrillmasterEvent[]).map(migrateEvent)
/** The moment of the accepted mock, docs/design/workflow.html. */
const MOCK_MOMENT = '2026-11-20T19:10:16.785Z'

const seedWorkflow = () => migrateWorkflow((reviewedRun()[0] as Extract<DrillmasterEvent, { type: 'project_initialized' }>).workflow)
const guidOf = (workflow: WorkflowDocument, stage: number, step: number) => workflow.stages.find((s) => s.n === stage)!.steps.find((s) => s.n === step)!.guid

let clock = 0
const event = (fields: Record<string, unknown>) => ({ id: `e${clock}`, at: `2026-11-20T10:${String(clock++).padStart(2, '0')}:00Z`, ...fields }) as DrillmasterEvent

function project(workflow: WorkflowDocument) {
  clock = 0
  return [event({ type: 'project_initialized', dir: '/p', workflow })]
}
const start = (workflow: WorkflowDocument, id: string, kind: string) => [
  event({ type: 'work_item_started', work_item_id: id, issue: `#${id}`, description: '', workflow_version: workflow.version, token_hash: id, stage: 1, step: 1 }),
  event({ type: 'session_bound', session_id: `s-${id}`, work_item_id: id }),
  event({ type: 'input_set', work_item_id: id, stage: null, step: null, name: 'kind', value: kind, by: 'agent' }),
]
const verdict = (workflow: WorkflowDocument, id: string, stage: number, step: number, by: string, accepted: boolean, next: { stage: number | null; step: number | null }) =>
  event({ type: 'gate_verdict', work_item_id: id, stage, step, step_guid: guidOf(workflow, stage, step), accepted, by, why: '', rule: null, next, done: next.stage === null })
const prompt = (id: string, stage: number | null, stepGuid?: string) =>
  event({ type: 'work_trace', session_id: `s-${id}`, work_item_id: id, stage, step: null, ...(stepGuid ? { step_guid: stepGuid } : {}), hook: 'UserPromptSubmit', prompt: 'a correction' })
const judged = (id: string, inputEvent: DrillmasterEvent) => event({ type: 'owner_inputs_judged', work_item_id: id, inputs: [{ event: inputEvent.id, friction: true, why: '' }] })

const stepOf = (page: WorkflowPage, stage: number, step: number) => page.stages.find((s) => s.n === stage)!.steps.find((s) => s.n === step)!

describe('the Workflow page', () => {
  it('marks steps that run on one value of one input as alternatives, and no others', () => {
    const page = workflowPageView(project(seedWorkflow()))!
    expect(stepOf(page, 2, 1).alternative).toEqual({ input: 'kind', value: 'bug' })
    expect(stepOf(page, 2, 2).alternative).toEqual({ input: 'kind', value: 'feature' })
    expect(stepOf(page, 3, 3).alternative).toBeNull()
    expect(stepOf(page, 1, 1).alternative).toBeNull()
  })

  it('says each condition in plain words', () => {
    const page = workflowPageView(project(seedWorkflow()))!
    expect(stepOf(page, 2, 1).when).toBe('kind is bug')
    expect(stepOf(page, 3, 3).when).toBe('kind is feature or user visible is yes')
    expect(stepOf(page, 1, 1).when).toBeNull()
  })

  it("shows an item at the next step it takes, before the skip of a step it doesn't meet is recorded", () => {
    const workflow = seedWorkflow()
    const page = workflowPageView([...project(workflow), ...start(workflow, 'wi_1', 'feature'), verdict(workflow, 'wi_1', 1, 1, 'agent', true, { stage: 2, step: 1 })])!
    expect(stepOf(page, 2, 1).here_now).toEqual([])
    expect(stepOf(page, 2, 2).here_now.map((item) => item.issue)).toEqual(['#wi_1'])
    expect(page.stages[1]!.here_now.map((item) => item.issue)).toEqual(['#wi_1'])
  })

  it('places an item on an older version at the same step in the current one', () => {
    const workflow = seedWorkflow()
    const newer: WorkflowDocument = {
      ...workflow,
      version: '9.0.0',
      stages: workflow.stages.map((stage) => (stage.n === 1 ? { ...stage, steps: [{ ...stage.steps[0]!, guid: 'new-step', name: 'a new first step' }, { ...stage.steps[0]!, n: 2 }] } : stage)),
    }
    const page = workflowPageView([...project(workflow), ...start(workflow, 'wi_1', 'bug'), event({ type: 'workflow_changed', workflow: newer })])!
    expect(page.workflow_version).toBe('9.0.0')
    expect(stepOf(page, 1, 2).here_now.map((item) => item.issue)).toEqual(['#wi_1'])
    expect(stepOf(page, 1, 1).here_now).toEqual([])
  })

  it("counts Drillmaster's reviews passed and sent back at their step", () => {
    const workflow = seedWorkflow()
    const page = workflowPageView([
      ...project(workflow),
      ...start(workflow, 'wi_1', 'bug'),
      verdict(workflow, 'wi_1', 4, 4, 'drillmaster', false, { stage: 4, step: 4 }),
      verdict(workflow, 'wi_1', 4, 4, 'drillmaster', true, { stage: null, step: null }),
    ])!
    expect(stepOf(page, 4, 4).reviews).toEqual({ passed: 1, sent_back: 1 })
    expect(page.waiting_to_deliver.map((item) => item.issue)).toEqual(['#wi_1'])
  })

  it('places friction in its stage, after delivery, or unplaced, and counts an Owner gate sent back', () => {
    const workflow = seedWorkflow()
    const events = [...project(workflow), ...start(workflow, 'wi_1', 'feature')]
    const inStage3 = prompt('wi_1', 3, guidOf(workflow, 3, 2))
    const outsideAStep = prompt('wi_1', null)
    events.push(inStage3, judged('wi_1', inStage3), outsideAStep, judged('wi_1', outsideAStep))
    events.push(verdict(workflow, 'wi_1', 2, 2, 'owner', false, { stage: 2, step: 2 }))
    events.push(event({ type: 'work_item_delivered', work_item_id: 'wi_1', pr: 'local', summary: '', artifacts: [] }))
    const afterDelivery = prompt('wi_1', null)
    events.push(afterDelivery, judged('wi_1', afterDelivery))
    const page = workflowPageView(events)!
    expect(page.stages.map((stage) => stage.friction)).toEqual([0, 1, 1, 0])
    expect(page.friction).toEqual({ after_delivery: 1, unplaced: 1 })
    expect(page.delivered).toBe(1)
  })

  it("shows the accepted mock's moment from the recorded run", () => {
    const page = workflowPageView(reviewedRun(), MOCK_MOMENT)!
    expect(page.workflow_version).toBe('2.1.0')
    expect(stepOf(page, 4, 4).here_now.map((item) => item.issue)).toEqual(['#5'])
    expect(stepOf(page, 4, 4).reviews).toEqual({ passed: 4, sent_back: 0 })
    expect(page.delivered).toBe(4)
    expect(page.friction.after_delivery).toBe(2)
  })

  it('shows the end of the recorded run when no moment is given', () => {
    const page = workflowPageView(reviewedRun())!
    expect(page.workflow_version).toBe('3.0.0')
    expect(page.stages).toHaveLength(5)
    expect(page.delivered).toBe(8)
  })
})
