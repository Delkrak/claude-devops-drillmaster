import { conditionInWords, describeInputsOf, parseCondition } from './conditions.js'
import type { DrillmasterEvent, GateSubmitted, GateVerdict, StepSkipDecided, WorkItemDelivered, WorkReported, WorkTrace } from './events.js'
import { frictionPlacementsOf } from './frictionPlacement.js'
import { frictionJudgementsOf, isFriction, ownerInputsOf } from './ownerInputs.js'
import { foldState } from './state.js'
import { firstApplyingPosition, inputValuesOf, workflowOfWorkItem } from './work.js'
import type { WorkStep } from './workflow.js'
import { alternativeOf } from './workflowPage.js'

export interface StepIn {
  event_id: string
  at: string
  prompt: string
  after_delivery: boolean
  why: string
  placed_why: string | null
}

export interface WorkItemPageStep {
  n: number
  guid: string
  name: string
  gate: WorkStep['gate']
  if: string | null
  when: string | null
  alternative: { input: string; value: string } | null
  status: 'passed' | 'skipped' | 'here' | 'ahead'
  happened: {
    skip: { by: string; why: string } | null
    verdicts: { at: string; by: string; accepted: boolean; why: string }[]
    reports: { kind: string; text: string }[]
    submitted: string | null
    waiting_for: 'drillmaster' | 'owner' | null
  }
  evidence: {
    self_check: { rule: string; accepted: boolean; evidence: string }[]
    kept_output: { tool: string; name: string; lines: string[] }[]
  }
  calls: { at: string; tool: string; did: string; failed: boolean }[]
  step_ins: StepIn[]
}

export interface WorkItemPage {
  at: string
  work_item_id: string
  issue: string
  kind: string | null
  description: string
  status: 'active' | 'delivered'
  workflow_version: string
  stages: { n: number; guid: string; name: string; steps: WorkItemPageStep[] }[]
  delivered: { at: string; summary: string | null; post_mortems: { author: string; keep: string[]; change: string[] }[] } | null
  step_ins_unplaced: StepIn[]
}

const MAX_CALL_TEXT_LENGTH = 110
const shortened = (text: string, max = MAX_CALL_TEXT_LENGTH) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const unprefixedToolName = (tool: string) => tool.replace(/^mcp__.*?__/, '')
const GATE_TOOL_NAME = /(?:^|__)work_gate$/
const FINISHED_CALL_HOOKS = new Set(['PostToolUse', 'PostToolUseFailure'])

function whatCallDid(input: string | undefined, projectDir: string) {
  if (!input) return ''
  let callArguments: Record<string, unknown>
  try {
    callArguments = JSON.parse(input) as Record<string, unknown>
  } catch {
    return shortened(input)
  }
  const relativeToProject = (text: string) =>
    [projectDir, projectDir.replace(/\\/g, '/')].reduce((result, dir) => (dir ? result.split(`"${dir}"`).join('.').split(dir).join('.') : result), text).replace(/\.[\\/]/g, '')
  if (typeof callArguments.command === 'string') return shortened(relativeToProject(callArguments.command).replace(/^cd \. && /, ''))
  if (typeof callArguments.file_path === 'string') return relativeToProject(callArguments.file_path).replace(/\\/g, '/')
  if (typeof callArguments.kind === 'string' && typeof callArguments.text === 'string') return shortened(`${callArguments.kind}: ${callArguments.text}`)
  if (typeof callArguments.step === 'string') return `step ${callArguments.step.replace(/^step\s+/, '')}`
  if (typeof callArguments.issue === 'string') return callArguments.issue
  return shortened(input)
}

export function workItemPageView(events: readonly DrillmasterEvent[], workItemId: string, at?: string): WorkItemPage | undefined {
  const eventsUntilAt = at ? events.filter((event) => event.at <= at) : events
  const state = foldState(eventsUntilAt)
  const item = state.workItems[workItemId]
  if (!item) return undefined
  const workflow = workflowOfWorkItem(state, item)
  const projectDir = eventsUntilAt.find((event) => event.type === 'project_initialized')?.dir ?? ''
  const itemEvents = eventsUntilAt.filter((event) => 'work_item_id' in event && event.work_item_id === workItemId)
  const currentPosition = item.status === 'delivered' || item.stage === null ? null : firstApplyingPosition(workflow, item, inputValuesOf(item))
  const inputValues = inputValuesOf(item)

  const frictionJudgements = frictionJudgementsOf(eventsUntilAt)
  const frictionPlacements = frictionPlacementsOf(eventsUntilAt)
  const stepIns = ownerInputsOf(eventsUntilAt)
    .filter((input) => input.work_item_id === workItemId && isFriction(input, frictionJudgements))
    .map((input) => {
      const placement = frictionPlacements.get(input.event_id)
      return {
        stepIn: { event_id: input.event_id, at: input.at, prompt: input.prompt, after_delivery: input.after_delivery, why: frictionJudgements.get(input.event_id)?.why ?? '', placed_why: placement?.step_guid ? placement.why : null },
        stepGuid: placement?.step_guid ?? null,
      }
    })

  // A gate call is traced after the work item has moved on; the step it submitted is in its input. An
  // input cut short when it was traced is not JSON: that call is placed by where it was traced.
  const submittedStepRefByTraceId = new Map<string, string>()
  for (const event of itemEvents) {
    if (event.type !== 'work_trace' || !event.tool || !GATE_TOOL_NAME.test(event.tool) || !event.input) continue
    try {
      const submittedStepRef = (JSON.parse(event.input) as { step?: unknown }).step
      if (typeof submittedStepRef === 'string') submittedStepRefByTraceId.set(event.id, submittedStepRef.replace(/^step\s+/, '').trim())
    } catch {
      // placed by where it was traced
    }
  }
  const passedStepGuids = new Set(item.passed_step_guids)
  const skippedStepGuids = new Set(item.skipped_step_guids)

  const stages = workflow.stages.map((stage) => ({
    n: stage.n,
    guid: stage.guid,
    name: stage.name,
    steps: stage.steps.map((step): WorkItemPageStep => {
      const stepRef = `${stage.n}.${step.n}`
      const isAtStep = (event: { step_guid?: string }) => event.step_guid === step.guid
      const verdicts = itemEvents.filter((event): event is GateVerdict => event.type === 'gate_verdict' && isAtStep(event))
      const skipDecision = itemEvents.find((event): event is StepSkipDecided => event.type === 'step_skip_decided' && isAtStep(event) && event.accepted)
      const submissions = itemEvents.filter((event): event is GateSubmitted => event.type === 'gate_submitted' && isAtStep(event))
      const lastSubmission = submissions.at(-1)
      const calls = itemEvents.filter(
        (event): event is WorkTrace => event.type === 'work_trace' && FINISHED_CALL_HOOKS.has(event.hook) && (submittedStepRefByTraceId.has(event.id) ? submittedStepRefByTraceId.get(event.id) === stepRef : isAtStep(event)),
      )
      // Where the work item stands now decides, not its history: moving back undoes passes and skips.
      const passed = passedStepGuids.has(step.guid)
      const skipped = skippedStepGuids.has(step.guid)
      const isHere = currentPosition !== null && currentPosition.stage === stage.n && currentPosition.step === step.n
      // A step before where the item stands that it did not pass, it went past on its condition; the skip is recorded a moment later.
      const isBeforeCurrent = currentPosition !== null && currentPosition.stage !== null && currentPosition.step !== null && (stage.n < currentPosition.stage || (stage.n === currentPosition.stage && step.n < currentPosition.step))
      const passedOver = !skipped && !passed && isBeforeCurrent
      const conditionSkipWhy = step.if ? `only when ${conditionInWords(parseCondition(step.if))}; ${describeInputsOf(parseCondition(step.if), inputValues)}` : ''
      const keptTraceIds = new Map(submissions.flatMap((submission) => submission.capture_traces ?? []).map((id) => [id, true]))
      return {
        n: step.n,
        guid: step.guid,
        name: step.name,
        gate: step.gate,
        if: step.if ?? null,
        when: step.if ? conditionInWords(parseCondition(step.if)) : null,
        alternative: alternativeOf(step.if),
        status: skipped || passedOver ? 'skipped' : isHere ? 'here' : passed ? 'passed' : 'ahead',
        happened: {
          skip: skipped && skipDecision ? { by: skipDecision.by, why: skipDecision.by === 'condition' ? conditionSkipWhy : skipDecision.why } : skipped || passedOver ? { by: 'condition', why: conditionSkipWhy } : null,
          verdicts: verdicts.map((verdict) => ({ at: verdict.at, by: verdict.by, accepted: verdict.accepted, why: verdict.why })),
          reports: itemEvents.filter((event): event is WorkReported => event.type === 'work_reported' && isAtStep(event)).map((report) => ({ kind: report.kind, text: report.text })),
          submitted: lastSubmission?.text ?? null,
          waiting_for: isHere && item.pending_gate && item.pending_gate.stage === stage.n && item.pending_gate.step === step.n ? item.pending_gate.gate : null,
        },
        evidence: {
          self_check: (lastSubmission?.self_check ?? []).map((check) => ({ rule: check.rule, accepted: check.accepted, evidence: check.evidence })),
          kept_output: itemEvents
            .filter((event): event is WorkTrace => event.type === 'work_trace' && keptTraceIds.has(event.id))
            .flatMap((trace) => (trace.captures ?? []).map((capture) => ({ tool: unprefixedToolName(trace.tool ?? ''), name: capture.name, lines: [...new Set(capture.lines)] }))),
        },
        calls: calls.map((call) => ({ at: call.at, tool: unprefixedToolName(call.tool ?? ''), did: whatCallDid(call.input, projectDir), failed: call.error === true || call.hook === 'PostToolUseFailure' })),
        step_ins: stepIns.filter(({ stepGuid }) => stepGuid === step.guid).map(({ stepIn }) => stepIn),
      }
    }),
  }))
  const pinnedStepInIds = new Set(stages.flatMap((stage) => stage.steps.flatMap((step) => step.step_ins.map((stepIn) => stepIn.event_id))))

  const delivery = itemEvents.find((event): event is WorkItemDelivered => event.type === 'work_item_delivered')
  return {
    at: at ?? eventsUntilAt.at(-1)?.at ?? '',
    work_item_id: workItemId,
    issue: item.issue,
    kind: item.inputs.kind?.value ?? null,
    description: item.description,
    status: item.status,
    workflow_version: item.workflow_version,
    stages,
    delivered: delivery
      ? {
          at: delivery.at,
          summary: delivery.summary ?? null,
          post_mortems: itemEvents.flatMap((event) => (event.type === 'post_mortem_written' ? [{ author: event.author, keep: event.keep.map((feedback) => feedback.text), change: event.change.map((feedback) => feedback.text) }] : [])),
        }
      : null,
    step_ins_unplaced: stepIns.filter(({ stepIn }) => !pinnedStepInIds.has(stepIn.event_id)).map(({ stepIn }) => stepIn),
  }
}

const SUMMARY_LENGTH = 90
const oneLineSummaryOf = (description: string) =>
  shortened(
    description
      .split(/(?<=\.)\s|\n/)[0]!
      .replace(/^\w+:\s*/, '')
      .replace(/\.$/, ''),
    SUMMARY_LENGTH,
  )

export function workItemsListView(events: readonly DrillmasterEvent[], at?: string) {
  const eventsUntilAt = at ? events.filter((event) => event.at <= at) : events
  const state = foldState(eventsUntilAt)
  const frictionJudgements = frictionJudgementsOf(eventsUntilAt)
  const frictionCountByItemId = new Map<string, number>()
  for (const input of ownerInputsOf(eventsUntilAt)) if (input.work_item_id && isFriction(input, frictionJudgements)) frictionCountByItemId.set(input.work_item_id, (frictionCountByItemId.get(input.work_item_id) ?? 0) + 1)
  return Object.values(state.workItems)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .map((item) => {
      const workflow = workflowOfWorkItem(state, item)
      const currentPosition = item.status === 'delivered' || item.stage === null ? null : firstApplyingPosition(workflow, item, inputValuesOf(item))
      const currentStep = currentPosition?.stage != null && currentPosition.step != null ? workflow.stages.find((stage) => stage.n === currentPosition.stage)?.steps.find((candidate) => candidate.n === currentPosition.step) : undefined
      return {
        work_item_id: item.work_item_id,
        issue: item.issue,
        kind: item.inputs.kind?.value ?? null,
        summary: oneLineSummaryOf(item.description),
        status: item.status,
        started_at: item.started_at,
        at_step: currentStep ? currentStep.name : null,
        friction: frictionCountByItemId.get(item.work_item_id) ?? 0,
      }
    })
}
export type WorkItemsList = ReturnType<typeof workItemsListView>
