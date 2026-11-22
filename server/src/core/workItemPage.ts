import { conditionInWords, describeInputsOf, parseCondition } from './conditions.js'
import type { DrillmasterEvent, GateSubmitted, GateVerdict, StepSkipDecided, WorkItemDelivered, WorkReported, WorkTrace } from './events.js'
import { frictionPlacementsOf } from './frictionPlacement.js'
import { frictionJudgementsOf, isFriction, ownerInputsOf } from './ownerInputs.js'
import { foldState } from './state.js'
import { firstApplyingPosition, inputValuesOf, workflowOfWorkItem } from './work.js'
import type { WorkStep } from './workflow.js'
import { alternativeOf } from './workflowPage.js'

/** Where Owner had to step in on the work item. */
export interface StepIn {
  event_id: string
  at: string
  prompt: string
  after_delivery: boolean
  /** Why the friction judge counts it as friction. */
  why: string
  /** Why the step it is pinned to should have caught it; null when it is not pinned to a step. */
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
  /** The first level Owner drills into: what happened at the step. */
  happened: {
    skip: { by: string; why: string } | null
    verdicts: { at: string; by: string; accepted: boolean; why: string }[]
    reports: { kind: string; text: string }[]
    /** What Agent reported with its last gate submission. */
    submitted: string | null
    waiting_for: 'drillmaster' | 'owner' | null
  }
  /** The second level: the proof behind the verdict. */
  evidence: {
    self_check: { rule: string; accepted: boolean; evidence: string }[]
    kept_output: { tool: string; name: string; lines: string[] }[]
  }
  /** The third level: every tool call at the step, in one line each. */
  calls: { at: string; tool: string; did: string; failed: boolean }[]
  step_ins: StepIn[]
}

/** One work item's route through the workflow it runs on, at a moment. */
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
  /** Step-ins no step should have caught, or not placed yet: shown where they happened. */
  step_ins_unplaced: StepIn[]
}

const MAX_CALL_TEXT = 110
const shortened = (text: string, max = MAX_CALL_TEXT) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const toolName = (tool: string) => tool.replace(/^mcp__.*?__/, '')
const GATE_TOOL = /(?:^|__)work_gate$/
/** The hooks that trace a finished tool call: done, or failed. */
const TRACED_CALLS = new Set(['PostToolUse', 'PostToolUseFailure'])

/** A tool call in one line: the command it ran, the file it touched, what it reported, or the step it submitted. */
function whatCallDid(input: string | undefined, projectDir: string) {
  if (!input) return ''
  let args: Record<string, unknown>
  try {
    args = JSON.parse(input) as Record<string, unknown>
  } catch {
    return shortened(input)
  }
  const inProject = (text: string) =>
    [projectDir, projectDir.replace(/\\/g, '/')].reduce((result, dir) => (dir ? result.split(`"${dir}"`).join('.').split(dir).join('.') : result), text).replace(/\.[\\/]/g, '')
  if (typeof args.command === 'string') return shortened(inProject(args.command).replace(/^cd \. && /, ''))
  if (typeof args.file_path === 'string') return inProject(args.file_path).replace(/\\/g, '/')
  if (typeof args.kind === 'string' && typeof args.text === 'string') return shortened(`${args.kind}: ${args.text}`)
  if (typeof args.step === 'string') return `step ${args.step.replace(/^step\s+/, '')}`
  if (typeof args.issue === 'string') return args.issue
  return shortened(input)
}

/** The page of one work item at `at` (every event, when not given), on the workflow version it runs on. */
export function workItemPageView(events: readonly DrillmasterEvent[], workItemId: string, at?: string): WorkItemPage | undefined {
  const seen = at ? events.filter((event) => event.at <= at) : events
  const state = foldState(seen)
  const item = state.workItems[workItemId]
  if (!item) return undefined
  const workflow = workflowOfWorkItem(state, item)
  const projectDir = seen.find((event) => event.type === 'project_initialized')?.dir ?? ''
  const mine = seen.filter((event) => 'work_item_id' in event && event.work_item_id === workItemId)
  const here = item.status === 'delivered' || item.stage === null ? null : firstApplyingPosition(workflow, item, inputValuesOf(item))
  const inputs = inputValuesOf(item)

  const judgements = frictionJudgementsOf(seen)
  const placements = frictionPlacementsOf(seen)
  const stepIns = ownerInputsOf(seen)
    .filter((input) => input.work_item_id === workItemId && isFriction(input, judgements))
    .map((input) => {
      const placement = placements.get(input.event_id)
      return {
        stepIn: { event_id: input.event_id, at: input.at, prompt: input.prompt, after_delivery: input.after_delivery, why: judgements.get(input.event_id)?.why ?? '', placed_why: placement?.step_guid ? placement.why : null },
        stepGuid: placement?.step_guid ?? null,
      }
    })

  // A gate call is traced after the work item has moved on; the step it submitted is in its input. An
  // input cut short when it was traced is not JSON: that call is placed by where it was traced.
  const submittedStep = new Map<string, string>()
  for (const event of mine) {
    if (event.type !== 'work_trace' || !event.tool || !GATE_TOOL.test(event.tool) || !event.input) continue
    try {
      const step = (JSON.parse(event.input) as { step?: unknown }).step
      if (typeof step === 'string') submittedStep.set(event.id, step.replace(/^step\s+/, '').trim())
    } catch {
      // placed by where it was traced
    }
  }
  const passedSteps = new Set(item.passed_step_guids)
  const skippedSteps = new Set(item.skipped_step_guids)

  const stages = workflow.stages.map((stage) => ({
    n: stage.n,
    guid: stage.guid,
    name: stage.name,
    steps: stage.steps.map((step): WorkItemPageStep => {
      const ref = `${stage.n}.${step.n}`
      const atStep = (event: { step_guid?: string }) => event.step_guid === step.guid
      const verdicts = mine.filter((event): event is GateVerdict => event.type === 'gate_verdict' && atStep(event))
      const skip = mine.find((event): event is StepSkipDecided => event.type === 'step_skip_decided' && atStep(event) && event.accepted)
      const submissions = mine.filter((event): event is GateSubmitted => event.type === 'gate_submitted' && atStep(event))
      const lastSubmission = submissions.at(-1)
      const calls = mine.filter(
        (event): event is WorkTrace => event.type === 'work_trace' && TRACED_CALLS.has(event.hook) && (submittedStep.has(event.id) ? submittedStep.get(event.id) === ref : atStep(event)),
      )
      // Where the work item stands now decides, not its history: moving back undoes passes and skips.
      const passed = passedSteps.has(step.guid)
      const skipped = skippedSteps.has(step.guid)
      const isHere = here !== null && here.stage === stage.n && here.step === step.n
      // A step before where the item stands that it did not pass, it went past on its condition; the skip is recorded a moment later.
      const before = here !== null && here.stage !== null && here.step !== null && (stage.n < here.stage || (stage.n === here.stage && step.n < here.step))
      const passedOver = !skipped && !passed && before
      const conditionSkip = step.if ? `only when ${conditionInWords(parseCondition(step.if))}; ${describeInputsOf(parseCondition(step.if), inputs)}` : ''
      const kept = new Map(submissions.flatMap((submission) => submission.capture_traces ?? []).map((id) => [id, true]))
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
          skip: skipped && skip ? { by: skip.by, why: skip.by === 'condition' ? conditionSkip : skip.why } : skipped || passedOver ? { by: 'condition', why: conditionSkip } : null,
          verdicts: verdicts.map((verdict) => ({ at: verdict.at, by: verdict.by, accepted: verdict.accepted, why: verdict.why })),
          reports: mine.filter((event): event is WorkReported => event.type === 'work_reported' && atStep(event)).map((report) => ({ kind: report.kind, text: report.text })),
          submitted: lastSubmission?.text ?? null,
          waiting_for: isHere && item.pending_gate && item.pending_gate.stage === stage.n && item.pending_gate.step === step.n ? item.pending_gate.gate : null,
        },
        evidence: {
          self_check: (lastSubmission?.self_check ?? []).map((check) => ({ rule: check.rule, accepted: check.accepted, evidence: check.evidence })),
          kept_output: mine
            .filter((event): event is WorkTrace => event.type === 'work_trace' && kept.has(event.id))
            .flatMap((trace) => (trace.captures ?? []).map((capture) => ({ tool: toolName(trace.tool ?? ''), name: capture.name, lines: [...new Set(capture.lines)] }))),
        },
        calls: calls.map((call) => ({ at: call.at, tool: toolName(call.tool ?? ''), did: whatCallDid(call.input, projectDir), failed: call.error === true || call.hook === 'PostToolUseFailure' })),
        step_ins: stepIns.filter(({ stepGuid }) => stepGuid === step.guid).map(({ stepIn }) => stepIn),
      }
    }),
  }))
  const pinned = new Set(stages.flatMap((stage) => stage.steps.flatMap((step) => step.step_ins.map((stepIn) => stepIn.event_id))))

  const delivered = mine.find((event): event is WorkItemDelivered => event.type === 'work_item_delivered')
  return {
    at: at ?? seen.at(-1)?.at ?? '',
    work_item_id: workItemId,
    issue: item.issue,
    kind: item.inputs.kind?.value ?? null,
    description: item.description,
    status: item.status,
    workflow_version: item.workflow_version,
    stages,
    delivered: delivered
      ? {
          at: delivered.at,
          summary: delivered.summary ?? null,
          post_mortems: mine.flatMap((event) => (event.type === 'post_mortem_written' ? [{ author: event.author, keep: event.keep.map((feedback) => feedback.text), change: event.change.map((feedback) => feedback.text) }] : [])),
        }
      : null,
    step_ins_unplaced: stepIns.filter(({ stepIn }) => !pinned.has(stepIn.event_id)).map(({ stepIn }) => stepIn),
  }
}

const SUMMARY_LENGTH = 90
/** What a work item is about, in one line: its description up to the first sentence's end, without a leading "Bug:" or "Feature:". */
const firstLineOf = (description: string) =>
  shortened(
    description
      .split(/(?<=\.)\s|\n/)[0]!
      .replace(/^\w+:\s*/, '')
      .replace(/\.$/, ''),
    SUMMARY_LENGTH,
  )

/** Every work item, latest first, with where it is: for the work items list and the find box. */
export function workItemsListView(events: readonly DrillmasterEvent[], at?: string) {
  const seen = at ? events.filter((event) => event.at <= at) : events
  const state = foldState(seen)
  const judgements = frictionJudgementsOf(seen)
  const friction = new Map<string, number>()
  for (const input of ownerInputsOf(seen)) if (input.work_item_id && isFriction(input, judgements)) friction.set(input.work_item_id, (friction.get(input.work_item_id) ?? 0) + 1)
  return Object.values(state.workItems)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .map((item) => {
      const workflow = workflowOfWorkItem(state, item)
      const here = item.status === 'delivered' || item.stage === null ? null : firstApplyingPosition(workflow, item, inputValuesOf(item))
      const step = here?.stage != null && here.step != null ? workflow.stages.find((stage) => stage.n === here.stage)?.steps.find((candidate) => candidate.n === here.step) : undefined
      return {
        work_item_id: item.work_item_id,
        issue: item.issue,
        kind: item.inputs.kind?.value ?? null,
        summary: firstLineOf(item.description),
        status: item.status,
        started_at: item.started_at,
        at_step: step ? step.name : null,
        friction: friction.get(item.work_item_id) ?? 0,
      }
    })
}
export type WorkItemsList = ReturnType<typeof workItemsListView>
