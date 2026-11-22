import { conditionInWords, parseCondition } from './conditions.js'
import type { DrillmasterEvent } from './events.js'
import { frictionJudgementsOf, isFriction, ownerInputsOf } from './ownerInputs.js'
import { stepGuidAt } from './refs.js'
import { foldState } from './state.js'
import { firstApplyingPosition, inputValuesOf, workflowOfWorkItem } from './work.js'
import type { WorkStep } from './workflow.js'

export interface WorkItemRef {
  work_item_id: string
  issue: string
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
  friction: number
  stepped_in: WorkItemRef[]
  steps: WorkflowPageStep[]
}

export interface WorkflowPage {
  at: string
  workflow_version: string
  stages: WorkflowPageStage[]
  delivered: number
  waiting_to_deliver: WorkItemRef[]
  friction: { after_delivery: number; unplaced: number; after_delivery_items: WorkItemRef[]; unplaced_items: WorkItemRef[] }
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
    friction: 0,
    stepped_in: [],
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

  const frictionOutsideStages: WorkflowPage['friction'] = { after_delivery: 0, unplaced: 0, after_delivery_items: [], unplaced_items: [] }
  const workItemRefOf = (workItemId: string): WorkItemRef => ({ work_item_id: workItemId, issue: state.workItems[workItemId]?.issue ?? workItemId })
  const addRefOnce = (refs: WorkItemRef[], workItemId: string) => refs.some((ref) => ref.work_item_id === workItemId) || refs.push(workItemRefOf(workItemId))
  const addFriction = (stage: WorkflowPageStage | undefined, workItemId: string) => {
    if (stage) {
      stage.friction++
      addRefOnce(stage.stepped_in, workItemId)
    } else {
      frictionOutsideStages.unplaced++
      addRefOnce(frictionOutsideStages.unplaced_items, workItemId)
    }
  }
  for (const event of eventsUntilAt) {
    if (event.type !== 'gate_verdict') continue
    const stepOnPage = event.step_guid ? stepByGuid.get(event.step_guid) : undefined
    if (event.by === 'drillmaster' && stepOnPage) stepOnPage.step.reviews[event.accepted ? 'passed' : 'sent_back']++
    if (event.by === 'owner' && !event.accepted) addFriction(stageOfStep(event.step_guid, event.stage), event.work_item_id)
  }
  const frictionJudgements = frictionJudgementsOf(eventsUntilAt)
  for (const input of ownerInputsOf(eventsUntilAt)) {
    if (!input.work_item_id || !isFriction(input, frictionJudgements)) continue
    if (input.after_delivery) {
      frictionOutsideStages.after_delivery++
      addRefOnce(frictionOutsideStages.after_delivery_items, input.work_item_id)
    } else addFriction(stageOfStep(input.step_guid, input.stage), input.work_item_id)
  }

  return {
    at: at ?? eventsUntilAt.at(-1)?.at ?? '',
    workflow_version: workflow.version,
    stages,
    delivered: deliveredCount,
    waiting_to_deliver: waitingToDeliver,
    friction: frictionOutsideStages,
  }
}
