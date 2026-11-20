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
  /** The condition in plain words, for people. */
  when: string | null
  /** For a step that runs on one value of one input: steps next to each other on other values of it are alternatives. */
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
  /** Times Owner had to step in during this stage. */
  friction: number
  /** The work items Owner stepped in on in this stage, each once. */
  stepped_in: WorkItemRef[]
  steps: WorkflowPageStep[]
}

/** The Workflow page: the workflow at a moment, where the work items are, and where Owner had to step in. */
export interface WorkflowPage {
  at: string
  workflow_version: string
  stages: WorkflowPageStage[]
  delivered: number
  /** Past the last step, not yet delivered. */
  waiting_to_deliver: WorkItemRef[]
  friction: { after_delivery: number; unplaced: number; after_delivery_items: WorkItemRef[]; unplaced_items: WorkItemRef[] }
}

export function alternativeOf(condition: string | undefined): WorkflowPageStep['alternative'] {
  if (!condition) return null
  const parsed = parseCondition(condition)
  return parsed.kind === 'compare' && parsed.op === '==' && parsed.values.length === 1 ? { input: parsed.input, value: parsed.values[0]! } : null
}

const inWords = (condition: string | undefined) => (condition ? conditionInWords(parseCondition(condition)) : null)

/** The page at `at` (every event, when not given), folded from the events up to then. */
export function workflowPageView(events: readonly DrillmasterEvent[], at?: string): WorkflowPage | undefined {
  const seen = at ? events.filter((event) => event.at <= at) : events
  const state = foldState(seen)
  const workflow = state.workflow
  if (!workflow) return undefined

  const stages: WorkflowPageStage[] = workflow.stages.map((stage) => ({
    n: stage.n,
    guid: stage.guid,
    name: stage.name,
    if: stage.if ?? null,
    when: inWords(stage.if),
    here_now: [],
    friction: 0,
    stepped_in: [],
    steps: stage.steps.map((step) => ({
      n: step.n,
      guid: step.guid,
      name: step.name,
      gate: step.gate,
      if: step.if ?? null,
      when: inWords(step.if),
      alternative: alternativeOf(step.if),
      here_now: [],
      reviews: { passed: 0, sent_back: 0 },
    })),
  }))
  const stepByGuid = new Map(stages.flatMap((stage) => stage.steps.map((step) => [step.guid, { stage, step }] as const)))
  const stageByNumber = new Map(stages.map((stage) => [stage.n, stage]))
  // A guid places a step across workflow versions; a stage number is the fallback when a step is gone.
  const stageOf = (guid: string | null | undefined, stageNumber: number | null) =>
    (guid ? stepByGuid.get(guid)?.stage : undefined) ?? (stageNumber !== null ? stageByNumber.get(stageNumber) : undefined)

  const waitingToDeliver: WorkItemRef[] = []
  let delivered = 0
  for (const item of Object.values(state.workItems)) {
    if (item.status === 'delivered') {
      delivered++
      continue
    }
    const ref = { work_item_id: item.work_item_id, issue: item.issue }
    const itemWorkflow = workflowOfWorkItem(state, item)
    // The skip of a step whose condition the item doesn't meet is recorded just after the verdict that leads to it.
    const position = item.stage === null ? item : firstApplyingPosition(itemWorkflow, item, inputValuesOf(item))
    if (position.stage === null || position.step === null) {
      waitingToDeliver.push(ref)
      continue
    }
    const guid = stepGuidAt(itemWorkflow, position.stage, position.step)
    const placed = guid ? stepByGuid.get(guid) : undefined
    if (placed) placed.step.here_now.push(ref)
    ;(placed?.stage ?? stageOf(null, position.stage))?.here_now.push(ref)
  }

  const friction: WorkflowPage['friction'] = { after_delivery: 0, unplaced: 0, after_delivery_items: [], unplaced_items: [] }
  const refOf = (workItemId: string): WorkItemRef => ({ work_item_id: workItemId, issue: state.workItems[workItemId]?.issue ?? workItemId })
  const addOnce = (refs: WorkItemRef[], workItemId: string) => refs.some((ref) => ref.work_item_id === workItemId) || refs.push(refOf(workItemId))
  const addFriction = (stage: WorkflowPageStage | undefined, workItemId: string) => {
    if (stage) {
      stage.friction++
      addOnce(stage.stepped_in, workItemId)
    } else {
      friction.unplaced++
      addOnce(friction.unplaced_items, workItemId)
    }
  }
  for (const event of seen) {
    if (event.type !== 'gate_verdict') continue
    const placed = event.step_guid ? stepByGuid.get(event.step_guid) : undefined
    if (event.by === 'drillmaster' && placed) placed.step.reviews[event.accepted ? 'passed' : 'sent_back']++
    if (event.by === 'owner' && !event.accepted) addFriction(stageOf(event.step_guid, event.stage), event.work_item_id)
  }
  const judgements = frictionJudgementsOf(seen)
  for (const input of ownerInputsOf(seen)) {
    if (!input.work_item_id || !isFriction(input, judgements)) continue
    if (input.after_delivery) {
      friction.after_delivery++
      addOnce(friction.after_delivery_items, input.work_item_id)
    } else addFriction(stageOf(input.step_guid, input.stage), input.work_item_id)
  }

  return {
    at: at ?? seen.at(-1)?.at ?? '',
    workflow_version: workflow.version,
    stages,
    delivered,
    waiting_to_deliver: waitingToDeliver,
    friction,
  }
}
