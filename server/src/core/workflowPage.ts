import { conditionInWords, parseCondition } from './conditions.js'
import type { DrillmasterEvent } from './events.js'
import { marksOf, type Mark, type ShownMeasure } from './marks.js'
import { stepGuidAt } from './refs.js'
import { foldState } from './state.js'
import { firstApplyingPosition, inputValuesOf, workflowOfWorkItem } from './work.js'
import type { WorkStep } from './workflow.js'

export interface WorkItemRef {
  work_item_id: string
  issue: string
}

/** How often a shown measure happened in one place, and on which work items. */
export interface MarkCount {
  measure: string
  count: number
  items: WorkItemRef[]
}

export interface WorkflowPageStep {
  n: number
  guid: string
  name: string
  gate: WorkStep['gate']
  if: string | null
  when: string | null
  alternative: { input: string; value: string } | null
  here_now: WorkItemRef[]
  reviews: { passed: number; sent_back: number }
}

export interface WorkflowPageStage {
  n: number
  guid: string
  name: string
  if: string | null
  when: string | null
  here_now: WorkItemRef[]
  /** The shown measures that happened where a step of this stage should have caught them. */
  marks: MarkCount[]
  steps: WorkflowPageStep[]
}

export interface WorkflowPage {
  at: string
  workflow_version: string
  stages: WorkflowPageStage[]
  delivered: number
  waiting_to_deliver: WorkItemRef[]
  measures: ShownMeasure[]
  /** The shown measures that happened where no step covers them. */
  no_step: MarkCount[]
}

export function alternativeOf(condition: string | undefined): WorkflowPageStep['alternative'] {
  if (!condition) return null
  const parsedCondition = parseCondition(condition)
  return parsedCondition.kind === 'compare' && parsedCondition.op === '==' && parsedCondition.values.length === 1 ? { input: parsedCondition.input, value: parsedCondition.values[0]! } : null
}

const conditionTextInWords = (condition: string | undefined) => (condition ? conditionInWords(parseCondition(condition)) : null)

export function workflowPageView(events: readonly DrillmasterEvent[], at?: string): WorkflowPage | undefined {
  const eventsUntilAt = at ? events.filter((event) => event.at <= at) : events
  const state = foldState(eventsUntilAt)
  const workflow = state.workflow
  if (!workflow) return undefined

  const stages: WorkflowPageStage[] = workflow.stages.map((stage) => ({
    n: stage.n,
    guid: stage.guid,
    name: stage.name,
    if: stage.if ?? null,
    when: conditionTextInWords(stage.if),
    here_now: [],
    marks: [],
    steps: stage.steps.map((step) => ({
      n: step.n,
      guid: step.guid,
      name: step.name,
      gate: step.gate,
      if: step.if ?? null,
      when: conditionTextInWords(step.if),
      alternative: alternativeOf(step.if),
      here_now: [],
      reviews: { passed: 0, sent_back: 0 },
    })),
  }))
  const stepByGuid = new Map(stages.flatMap((stage) => stage.steps.map((step) => [step.guid, { stage, step }] as const)))
  const stageByNumber = new Map(stages.map((stage) => [stage.n, stage]))
  // A guid places a step across workflow versions; a stage number is the fallback when a step is gone.
  const stageOfStep = (stepGuid: string | null | undefined, stageNumber: number | null) =>
    (stepGuid ? stepByGuid.get(stepGuid)?.stage : undefined) ?? (stageNumber !== null ? stageByNumber.get(stageNumber) : undefined)

  const waitingToDeliver: WorkItemRef[] = []
  let deliveredCount = 0
  for (const item of Object.values(state.workItems)) {
    if (item.status === 'delivered') {
      deliveredCount++
      continue
    }
    const itemRef = { work_item_id: item.work_item_id, issue: item.issue }
    const itemWorkflow = workflowOfWorkItem(state, item)
    // The skip of a step whose condition the item doesn't meet is recorded just after the verdict that leads to it.
    const currentPosition = item.stage === null ? item : firstApplyingPosition(itemWorkflow, item, inputValuesOf(item))
    if (currentPosition.stage === null || currentPosition.step === null) {
      waitingToDeliver.push(itemRef)
      continue
    }
    const stepGuid = stepGuidAt(itemWorkflow, currentPosition.stage, currentPosition.step)
    const stepOnPage = stepGuid ? stepByGuid.get(stepGuid) : undefined
    if (stepOnPage) stepOnPage.step.here_now.push(itemRef)
    ;(stepOnPage?.stage ?? stageOfStep(null, currentPosition.stage))?.here_now.push(itemRef)
  }

  const workItemRefOf = (workItemId: string): WorkItemRef => ({ work_item_id: workItemId, issue: state.workItems[workItemId]?.issue ?? workItemId })
  const addMark = (counts: MarkCount[], mark: Mark) => {
    let count = counts.find((candidate) => candidate.measure === mark.measure)
    if (!count) counts.push((count = { measure: mark.measure, count: 0, items: [] }))
    count.count++
    if (!count.items.some((item) => item.work_item_id === mark.work_item_id)) count.items.push(workItemRefOf(mark.work_item_id))
  }
  for (const event of eventsUntilAt) {
    if (event.type !== 'gate_verdict' || event.by !== 'drillmaster') continue
    const stepOnPage = event.step_guid ? stepByGuid.get(event.step_guid) : undefined
    if (stepOnPage) stepOnPage.step.reviews[event.accepted ? 'passed' : 'sent_back']++
  }
  const { measures, marks } = marksOf(eventsUntilAt, workflow)
  const noStep: MarkCount[] = []
  for (const mark of marks) addMark((mark.step_guid ? stepByGuid.get(mark.step_guid)?.stage.marks : undefined) ?? noStep, mark)
  const inKeyOrder = (counts: MarkCount[]) => counts.sort((a, b) => measures.findIndex((measure) => measure.name === a.measure) - measures.findIndex((measure) => measure.name === b.measure))
  for (const stage of stages) inKeyOrder(stage.marks)

  return {
    at: at ?? eventsUntilAt.at(-1)?.at ?? '',
    workflow_version: workflow.version,
    stages,
    delivered: deliveredCount,
    waiting_to_deliver: waitingToDeliver,
    measures,
    no_step: inKeyOrder(noStep),
  }
}
