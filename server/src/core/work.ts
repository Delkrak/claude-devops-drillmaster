import { describeInputsOf, evaluateCondition, parseCondition, type InputValues } from './conditions.js'
import type { Artifact, InputAnswer, NewEvent, Position, ReportKind, SelfCheck } from './events.js'
import type { ExperimentReflection, Feedback } from './feedback.js'
import { stepGuidAt, stepName, stepPosition } from './refs.js'
import { findVersion, type ProjectState, type WorkItemState } from './state.js'
import { updateOnReaching, type ItemUpdate } from './updates.js'
import { AT_START, type WorkflowDocument, type WorkItemInput, type WorkStep } from './workflow.js'

export class Refused extends Error {}

export interface Decision {
  events: NewEvent[]
  answer: Record<string, unknown>
}

export type ReportArgs = {
  kind: ReportKind
  text: string
  stage?: number
  step?: number
  chosen?: string
  by?: string
  why?: string
  asked?: string
  answer?: string
}
export type GateArgs = { stage: number; step: number; self_check: SelfCheck[]; text: string; inputs?: InputAnswer[] }
export type DeliverArgs = { pr: string; summary: string; artifacts: Artifact[] }
export type PostMortemArgs = { keep: Feedback[]; change: Feedback[]; experiment_reflections: ExperimentReflection[] }
/** A work item runs on its own workflow version; it moves to a newer one only at an update step. */
export function workflowOfWorkItem(state: ProjectState, item: WorkItemState): WorkflowDocument {
  const workflow = findVersion(state, item.workflow_version)
  if (!workflow) throw new Error(`Work item ${item.work_item_id} runs on unknown workflow version ${item.workflow_version}`)
  return workflow
}

/** An update as a tool's answer tells it. */
export const describeUpdate = (update: ItemUpdate) => ({ from_version: update.from.version, to_version: update.to.version, kept: update.kept, changes: update.changes })

export function stepAt(workflow: WorkflowDocument, stage: number, step: number): WorkStep | undefined {
  return workflow.stages.find((candidate) => candidate.n === stage)?.steps.find((candidate) => candidate.n === step)
}
export function nextPosition(workflow: WorkflowDocument, stage: number, step: number): { next: Position; done: boolean } {
  const currentStage = workflow.stages.find((candidate) => candidate.n === stage)
  if (currentStage && step < currentStage.steps.length) return { next: { stage, step: step + 1 }, done: false }
  const nextStage = workflow.stages.find((candidate) => candidate.n > stage && candidate.steps.length > 0)
  if (nextStage) return { next: { stage: nextStage.n, step: 1 }, done: false }
  return { next: { stage: null, step: null }, done: true }
}

/** A work step's position with its GUID, as events record it. */
export function atStep<Stage extends number | null, Step extends number | null>(workflow: WorkflowDocument, stage: Stage, step: Step) {
  const guid = stage !== null && step !== null ? stepGuidAt(workflow, stage, step) : undefined
  return { stage, step, ...(guid ? { step_guid: guid } : {}) }
}

const describePosition = (position: Position) => (position.stage === null ? 'past the last work stage' : `work step ${position.stage}.${position.step}`)

/** The work item inputs set at a step ("1.2"), or at work_start (`AT_START`). */
export const inputsSetAt = (workflow: WorkflowDocument, setAt: string, by?: WorkItemInput['by']) =>
  workflow.inputs.filter((input) => input.set_at === setAt && (by === undefined || input.by === by))

const optionsOf = (input: WorkItemInput) => input.options.map((option) => option.value)

/**
 * The input_set events for what Agent gives where its inputs are due: every one of them, each one of
 * its options, and nothing else. `where` names the place for the refusals.
 */
export function agentInputEvents(workflow: WorkflowDocument, workItemId: string, setAt: string, answers: readonly InputAnswer[], where: string): NewEvent[] {
  const due = inputsSetAt(workflow, setAt, 'agent')
  const unknown = answers.filter((answer) => !due.some((input) => input.name === answer.name))
  if (unknown.length) throw new Refused(`No input ${unknown.map((answer) => answer.name).join(', ')} is yours to set ${where}.`)
  const at = stepPosition(setAt)
  return due.map((input) => {
    const answer = answers.find((candidate) => candidate.name === input.name)
    if (!answer || !optionsOf(input).includes(answer.value)) {
      throw new Refused(`Work can't go on without input "${input.name}": set it ${where}. ${input.instruction} Pick one of: ${optionsOf(input).join(', ')}.`)
    }
    return inputSetEvent(workflow, workItemId, at ?? null, { ...answer, by: 'agent' })
  })
}

export const inputSetEvent = (workflow: WorkflowDocument, workItemId: string, at: { stage: number; step: number } | null, answer: InputAnswer & { by: 'agent' | 'drillmaster' | 'owner' }): NewEvent => ({
  type: 'input_set',
  work_item_id: workItemId,
  ...(at ? atStep(workflow, at.stage, at.step) : { stage: null, step: null }),
  name: answer.name,
  value: answer.value,
  ...(answer.explanation ? { explanation: answer.explanation } : {}),
  by: answer.by,
})

export const inputValuesOf = (item: WorkItemState, alsoSet: readonly InputAnswer[] = []): InputValues => ({
  ...Object.fromEntries(Object.entries(item.inputs).map(([name, input]) => [name, input.value])),
  ...Object.fromEntries(alsoSet.map((answer) => [answer.name, answer.value])),
})

type Applicability = { applies: true } | { applies: false; why: string } | { applies: 'unknown'; missing: string[] }

/** Whether a step applies to a work item with these inputs: its stage's `if` and its own. */
export function applicabilityOf(workflow: WorkflowDocument, stageNumber: number, stepNumber: number, inputs: InputValues): Applicability {
  const stage = workflow.stages.find((candidate) => candidate.n === stageNumber)!
  const step = stage.steps.find((candidate) => candidate.n === stepNumber)!
  const conditions: [string, string | undefined][] = [
    [`stage ${stage.n} "${stage.name}"`, stage.if],
    [`step ${stage.n}.${step.n} "${step.name}"`, step.if],
  ]
  for (const [what, text] of conditions) {
    if (!text) continue
    const condition = parseCondition(text)
    const result = evaluateCondition(condition, inputs)
    if (result === false) return { applies: false, why: `${what} applies only when ${text}, and ${describeInputsOf(condition, inputs)}.` }
    if (result !== true) return { applies: 'unknown', missing: result.missing }
  }
  return { applies: true }
}

interface StepsSkipped {
  events: NewEvent[]
  position: { next: Position; done: boolean }
  skippedGuids: string[]
  /** The inputs the step it stops at waits for, when one of them decides whether it applies. */
  waitingFor: string[]
}

function skipStepsThatDontApply(workflow: WorkflowDocument, item: WorkItemState, from: { next: Position; done: boolean }, inputs: InputValues): StepsSkipped {
  const skipped: StepsSkipped = { events: [], position: from, skippedGuids: [], waitingFor: [] }
  while (skipped.position.next.stage !== null && skipped.position.next.step !== null) {
    const { stage, step } = skipped.position.next
    const applicability = applicabilityOf(workflow, stage, step, inputs)
    if (applicability.applies === true) break
    if (applicability.applies === 'unknown') return { ...skipped, waitingFor: applicability.missing }
    const after = nextPosition(workflow, stage, step)
    skipped.events.push({ type: 'step_skip_decided', work_item_id: item.work_item_id, ...atStep(workflow, stage, step), accepted: true, by: 'condition', why: applicability.why, ...after })
    skipped.skippedGuids.push(stepGuidAt(workflow, stage, step)!)
    skipped.position = after
  }
  return skipped
}

export interface MovedOn {
  events: NewEvent[]
  next: Position
  done: boolean
  sessionDone: boolean
  update?: ItemUpdate
  waitingFor: string[]
}

/**
 * Moves a work item on to `from`: past the steps that don't apply to its inputs, then through the
 * update the step it lands on asks for, and past the steps of the newer version that don't apply.
 * `doneNow` are the GUIDs of the steps done with this move. An item that is `alreadyThere` only
 * checks for an update when its step no longer applies.
 */
export function moveOn(
  state: ProjectState,
  item: WorkItemState,
  workflow: WorkflowDocument,
  from: { next: Position; done: boolean },
  options: { doneNow?: readonly string[]; inputs?: InputValues; alreadyThere?: boolean } = {},
): MovedOn {
  const inputs = options.inputs ?? inputValuesOf(item)
  const first = skipStepsThatDontApply(workflow, item, from, inputs)
  const reachedAnotherStep = !options.alreadyThere || first.events.length > 0
  const update = reachedAnotherStep ? updateOnReaching(state, item, workflow, first.position.next, [...(options.doneNow ?? []), ...first.skippedGuids]) : undefined
  if (!update) {
    return { events: first.events, ...first.position, waitingFor: first.waitingFor, sessionDone: outsideSessionStages(workflow, item, first.position.next) }
  }
  const second = skipStepsThatDontApply(update.to, item, { next: update.next, done: update.done }, inputs)
  return {
    events: [...first.events, update.event, ...second.events],
    ...second.position,
    update,
    waitingFor: second.waitingFor,
    sessionDone: outsideSessionStages(update.to, item, second.position.next),
  }
}

/** The steps a move skipped because their `if` wasn't met, with why. */
export const skippedByCondition = (events: readonly NewEvent[]) =>
  events.flatMap((event) => (event.type === 'step_skip_decided' && event.by === 'condition' ? [{ step: stepName(event.stage, event.step), why: event.why }] : []))

/** The answer fields of a move, as the tools give them. */
export function describeMove(moved: MovedOn) {
  const skipped = skippedByCondition(moved.events)
  return {
    next: moved.next,
    done: moved.done,
    session_done: moved.sessionDone,
    ...(skipped.length ? { skipped_by_condition: skipped } : {}),
    ...(moved.waitingFor.length ? { waiting_for_inputs: moved.waitingFor } : {}),
    ...(moved.update ? { update: describeUpdate(moved.update) } : {}),
  }
}

function refuseUnlessStepApplies(workflow: WorkflowDocument, item: WorkItemState, stage: number, step: number) {
  const applicability = applicabilityOf(workflow, stage, step, inputValuesOf(item))
  if (applicability.applies === true) return
  if (applicability.applies === false) throw new Refused(`${applicability.why[0]!.toUpperCase()}${applicability.why.slice(1)} Check work_status.`)
  const who = applicability.missing.map((name) => {
    const input = workflow.inputs.find((candidate) => candidate.name === name)!
    return input.by === 'agent' ? `"${name}" is yours to set (work_input)` : `"${name}" is ${input.by === 'owner' ? "Owner's" : "Drillmaster's"} to set`
  })
  throw new Refused(`Whether step ${stage}.${step} applies depends on ${applicability.missing.join(', ')}, which isn't set yet: ${who.join('; ')}. Work can't go on without it.`)
}

/**
 * Inputs set by Drillmaster or Owner, or changed by Agent, after the work item moved on. When the
 * item waits at a step whose `if` they decide, it moves on.
 */
export function inputEventsWithMove(state: ProjectState, item: WorkItemState, at: { stage: number; step: number } | null, answers: readonly (InputAnswer & { by: 'agent' | 'drillmaster' | 'owner' })[]): NewEvent[] {
  const workflow = workflowOfWorkItem(state, item)
  const events = answers.map((answer) => inputSetEvent(workflow, item.work_item_id, at, answer))
  if (item.status !== 'active' || item.pending_gate || item.pending_skip || item.stage === null) return events
  const moved = moveOn(state, item, workflow, { next: { stage: item.stage, step: item.step }, done: false }, { inputs: inputValuesOf(item, answers), alreadyThere: true })
  return [...events, ...moved.events]
}

export type InputChangeArgs = { name: string; value: string; why: string }

/**
 * Agent sets one of its inputs after its place, or changes one. When the change makes a step that
 * was skipped by its `if` apply, the work item goes back to the first such step, keeping the steps
 * before it that were done: the rule of a fast-forward stopping at its first discrepancy.
 */
export function changeInput(state: ProjectState, item: WorkItemState, args: InputChangeArgs): Decision {
  refuseIfDelivered(item)
  if (item.pending_gate) throw new Refused(`The ${item.pending_gate.gate} gate of ${describePosition(item)} is pending. Change the input once it is decided.`)
  if (item.pending_skip) throw new Refused(`A skip of step ${item.pending_skip.stage}.${item.pending_skip.step} is waiting for a decision.`)
  const workflow = workflowOfWorkItem(state, item)
  const input = workflow.inputs.find((candidate) => candidate.name === args.name)
  if (!input) throw new Refused(`Workflow ${workflow.version} has no input "${args.name}"${workflow.inputs.length ? `; its inputs are ${workflow.inputs.map((candidate) => candidate.name).join(', ')}` : ''}.`)
  if (input.by !== 'agent') throw new Refused(`Input "${input.name}" is ${input.by === 'owner' ? "Owner's" : "Drillmaster's"} to set, not yours. Tell Owner why it is wrong.`)
  if (!optionsOf(input).includes(args.value)) throw new Refused(`"${args.value}" is not an option of input "${input.name}": pick one of ${optionsOf(input).join(', ')}.`)
  if (item.inputs[input.name]?.value === args.value) throw new Refused(`Input "${input.name}" is ${args.value} already.`)
  if (input.set_at !== AT_START && !item.inputs[input.name]) throw new Refused(`Input "${input.name}" is set with the gate of step ${input.set_at}.`)

  const inputs = { ...inputValuesOf(item), [input.name]: args.value }
  const set = inputSetEvent(workflow, item.work_item_id, item.stage === null ? null : { stage: item.stage, step: item.step! }, { name: input.name, value: args.value, explanation: args.why, by: 'agent' })
  const conditionSkipped = new Set(item.condition_skipped_step_guids)
  const steps = workflow.stages.flatMap((stage) => stage.steps.map((step) => ({ stage: stage.n, step: step.n, guid: step.guid })))
  const goesBackTo = steps.find((candidate) => conditionSkipped.has(candidate.guid) && applicabilityOf(workflow, candidate.stage, candidate.step, inputs).applies !== false)
  if (goesBackTo) {
    const done = new Set([...item.passed_step_guids, ...item.skipped_step_guids])
    const kept = steps.slice(0, steps.indexOf(goesBackTo)).filter((candidate) => done.has(candidate.guid)).map((candidate) => candidate.guid)
    const event = { ...set, goes_back: { to: { stage: goesBackTo.stage, step: goesBackTo.step, step_guid: goesBackTo.guid }, kept } } as NewEvent
    const position = { stage: goesBackTo.stage, step: goesBackTo.step }
    return {
      events: [event],
      answer: { input: input.name, value: args.value, goes_back_to: stepName(position.stage, position.step), next: position, done: false, session_done: outsideSessionStages(workflow, item, position) },
    }
  }
  if (item.stage === null) return { events: [set], answer: { input: input.name, value: args.value, next: { stage: null, step: null }, done: item.gates_done, session_done: false } }
  const moved = moveOn(state, item, workflow, { next: { stage: item.stage, step: item.step }, done: false }, { inputs, alreadyThere: true })
  return { events: [set, ...moved.events], answer: { input: input.name, value: args.value, ...describeMove(moved) } }
}

function refuseIfDelivered(item: WorkItemState) {
  if (item.status === 'delivered') throw new Refused(`Work item ${item.work_item_id} is delivered. Only its post mortem remains.`)
}

export function recordReport(workflow: WorkflowDocument, item: WorkItemState, args: ReportArgs): Decision {
  if (args.kind === 'added_step') {
    if (item.status !== 'delivered') throw new Refused('An added step is a fix to delivered work. Before delivery, the work steps cover it.')
    if (!args.why) throw new Refused("An added step needs `why`: Owner's correction that asked for it.")
  } else {
    refuseIfDelivered(item)
  }
  if (args.kind === 'decision' && !(args.chosen && args.by && args.why)) {
    throw new Refused('A decision report needs `chosen`, `by` and `why`.')
  }
  if (args.kind === 'question' && !(args.asked && args.answer)) {
    throw new Refused('A question report needs `asked` and `answer`. Ask Drillmaster first; report it once answered.')
  }
  const { kind, text, chosen, by, why, asked, answer } = args
  const event: NewEvent = {
    type: 'work_reported',
    work_item_id: item.work_item_id,
    ...atStep(workflow, args.stage ?? item.stage, args.step ?? item.step),
    kind,
    text,
    ...(kind === 'decision' ? { chosen, by, why } : {}),
    ...(kind === 'question' ? { asked, answer } : {}),
    ...(kind === 'added_step' ? { why } : {}),
  }
  return { events: [event], answer: { recorded: kind, stage: event.stage, step: event.step } }
}

/** `captureTraces` are the traces at the step whose tool captures kept output: the gate's evidence. */
export function handInGate(state: ProjectState, item: WorkItemState, args: GateArgs, captureTraces: readonly string[] = []): Decision {
  refuseIfDelivered(item)
  const workflow = workflowOfWorkItem(state, item)
  if (item.stage === null) {
    throw new Refused(
      workflow.stages.length === 0
        ? 'The workflow has no work stages, so there are no work gates. Deliver when the work is done.'
        : 'Every work gate has passed. Deliver the work item.',
    )
  }
  if (item.pending_skip) {
    throw new Refused(`Your skip of step ${item.pending_skip.stage}.${item.pending_skip.step} waits for ${item.pending_skip.decided_by === 'owner' ? "Owner's" : "Drillmaster's"} decision (work_status).`)
  }
  if (item.pending_gate && !(item.pending_gate.gate === 'drillmaster' && item.pending_gate.review_failed)) {
    throw new Refused(`The ${item.pending_gate.gate} gate of ${describePosition(item)} is pending. Wait for its verdict (work_status).`)
  }
  if (args.stage !== item.stage || args.step !== item.step) {
    throw new Refused(`The work item is at ${describePosition(item)}, not ${args.stage}.${args.step}. Work steps are carried out in order.`)
  }
  refuseOutsideSessionStages(workflow, item, args)
  refuseUnlessStepApplies(workflow, item, args.stage, args.step)
  const step = stepAt(workflow, args.stage, args.step)!
  if (step.gate === 'owner' && args.self_check.length > 0) {
    throw new Refused(`Step ${args.stage}.${args.step} has an Owner gate: Owner judges it, against ${step.rules.length ? step.rules.join(', ') : 'what Owner wants'}. Hand it in with no self_check, and with text saying what Owner should look at.`)
  }
  const checkedRules = args.self_check.map((check) => check.rule)
  const missingRules = step.gate === 'owner' ? [] : step.rules.filter((ruleRef) => !checkedRules.includes(ruleRef))
  const unreferencedRules = checkedRules.filter((ruleRef) => !step.rules.includes(ruleRef))
  if (missingRules.length || unreferencedRules.length || new Set(checkedRules).size !== checkedRules.length) {
    throw new Refused(
      `The gate of work step ${args.stage}.${args.step} references ${step.rules.length ? step.rules.join(', ') : 'no rules'}. ` +
        'Give exactly one self check per referenced rule.' +
        (missingRules.length ? ` Missing: ${missingRules.join(', ')}.` : '') +
        (unreferencedRules.length ? ` Not referenced: ${unreferencedRules.join(', ')}.` : ''),
    )
  }

  const inputEvents = agentInputEvents(workflow, item.work_item_id, stepName(args.stage, args.step), args.inputs ?? [], `with the gate of step ${stepName(args.stage, args.step)}`)

  const submitted: NewEvent = {
    type: 'gate_submitted',
    work_item_id: item.work_item_id,
    ...atStep(workflow, args.stage, args.step),
    gate: step.gate,
    self_check: args.self_check,
    text: args.text,
    ...(captureTraces.length ? { capture_traces: [...captureTraces] } : {}),
  }
  if (step.gate !== 'self') {
    return {
      events: [submitted, ...inputEvents],
      answer: {
        verdict: 'pending',
        gate: step.gate,
        stage: args.stage,
        step: args.step,
        note: step.gate === 'owner' ? 'Owner must approve this gate. Ask Owner, then check work_status.' : 'Drillmaster is judging this gate. Check work_status.',
      },
    }
  }
  const failedCheck = args.self_check.find((check) => !check.accepted)
  const passed = failedCheck ? { next: { stage: args.stage, step: args.step }, done: false } : nextPosition(workflow, args.stage, args.step)
  const moved = failedCheck ? undefined : moveOn(state, item, workflow, passed, { doneNow: [step.guid], inputs: inputValuesOf(item, args.inputs) })
  const verdict: NewEvent = {
    type: 'gate_verdict',
    work_item_id: item.work_item_id,
    ...atStep(workflow, args.stage, args.step),
    accepted: !failedCheck,
    by: 'agent',
    why: failedCheck ? `Self check failed: ${failedCheck.evidence}` : 'Self check passed.',
    rule: failedCheck?.rule ?? null,
    ...passed,
  }
  return {
    events: [submitted, ...inputEvents, verdict, ...(moved?.events ?? [])],
    answer: {
      verdict: failedCheck ? 'rejected' : 'accepted',
      by: 'agent',
      rule: failedCheck?.rule ?? null,
      why: verdict.why,
      ...(moved ? describeMove(moved) : { next: passed.next, done: false, session_done: false }),
      note: failedCheck
        ? `Fix it and submit the gate of ${args.stage}.${args.step} again. A rejection is an impediment: report what got in the way.`
        : moved!.done
          ? 'Every work gate has passed. Deliver the work item.'
          : `Next: ${describePosition(moved!.next)}.`,
    },
  }
}

export type SkipArgs = { stage: number; step: number; why: string }

/** Agent asks to skip its current step, which the workflow marks as skippable. */
export function requestSkip(state: ProjectState, item: WorkItemState, args: SkipArgs): Decision {
  refuseIfDelivered(item)
  if (item.pending_gate) throw new Refused(`The ${item.pending_gate.gate} gate of ${describePosition(item)} is pending.`)
  if (item.pending_skip) throw new Refused(`A skip of step ${item.pending_skip.stage}.${item.pending_skip.step} is already waiting for a decision.`)
  if (args.stage !== item.stage || args.step !== item.step) {
    throw new Refused(`The work item is at ${describePosition(item)}. Only the step you are at can be skipped, not ${args.stage}.${args.step}.`)
  }
  const workflow = workflowOfWorkItem(state, item)
  refuseOutsideSessionStages(workflow, item, args)
  refuseUnlessStepApplies(workflow, item, args.stage, args.step)
  const step = stepAt(workflow, args.stage, args.step)!
  if (!step.skippable) throw new Refused(`Step ${args.stage}.${args.step} "${step.name}" is not skippable in workflow ${workflow.version}. Do its work and hand in its gate.`)
  const requested: NewEvent = { type: 'step_skip_requested', work_item_id: item.work_item_id, ...atStep(workflow, args.stage, args.step), decided_by: step.skippable, why: args.why }
  if (step.skippable !== 'self') {
    return {
      events: [requested],
      answer: { skip: 'pending', decided_by: step.skippable, stage: args.stage, step: args.step, note: step.skippable === 'owner' ? 'Owner decides this skip. Ask Owner, then check work_status.' : 'Drillmaster is judging this skip.' },
    }
  }
  const decided = decideSkip(state, item, { accepted: true, by: 'agent', why: args.why })
  return { events: [requested, ...decided.events], answer: decided.answer }
}

/** The decision on a skip: an accepted one moves the work item past the step. */
export function decideSkip(state: ProjectState, item: WorkItemState, verdict: { accepted: boolean; by: 'agent' | 'drillmaster' | 'owner'; why: string; via?: 'question' }): Decision {
  const workflow = workflowOfWorkItem(state, item)
  const stage = item.stage!
  const stepNumber = item.step!
  const skipped = verdict.accepted ? nextPosition(workflow, stage, stepNumber) : { next: { stage, step: stepNumber }, done: false }
  const moved = verdict.accepted ? moveOn(state, item, workflow, skipped, { doneNow: [stepGuidAt(workflow, stage, stepNumber)!] }) : undefined
  return {
    events: [{ type: 'step_skip_decided', work_item_id: item.work_item_id, ...atStep(workflow, stage, stepNumber), ...verdict, ...skipped }, ...(moved?.events ?? [])],
    answer: {
      skip: verdict.accepted ? 'accepted' : 'rejected',
      by: verdict.by,
      why: verdict.why,
      stage,
      step: stepNumber,
      ...(moved ? describeMove(moved) : { next: skipped.next, done: false, session_done: false }),
    },
  }
}

/** True when `position` lies in a stage this session doesn't work on, so the session stops before it. */
export function outsideSessionStages(workflow: WorkflowDocument, item: WorkItemState, position: Position) {
  if (item.stage_guids === null || position.stage === null) return false
  const stage = workflow.stages.find((candidate) => candidate.n === position.stage)
  return stage !== undefined && !item.stage_guids.includes(stage.guid)
}

/** The stages this session works on, as Agent and Owner name them. */
export const sessionStagesOf = (workflow: WorkflowDocument, item: WorkItemState) =>
  item.stage_guids === null ? 'every stage' : workflow.stages.filter((stage) => item.stage_guids!.includes(stage.guid)).map((stage) => `stage ${stage.n} "${stage.name}"`).join(', ') || 'no stage'

function refuseOutsideSessionStages(workflow: WorkflowDocument, item: WorkItemState, position: Position) {
  if (!outsideSessionStages(workflow, item, position)) return
  throw new Refused(
    `Step ${position.stage}.${position.step} is in a stage this session doesn't work on; it works on ${sessionStagesOf(workflow, item)}. Stop here and tell Owner where the work item is. A later session takes it up with work_resume.`,
  )
}

export function refuseUndeliverable(item: WorkItemState) {
  refuseIfDelivered(item)
  if (item.pending_gate) throw new Refused(`The ${item.pending_gate.gate} gate of ${describePosition(item)} is still pending.`)
  if (!item.gates_done) throw new Refused(`The work item is at ${describePosition(item)}. Every work gate must pass before delivery.`)
}

export function deliverWorkItem(item: WorkItemState, args: DeliverArgs): Decision {
  refuseUndeliverable(item)
  return {
    events: [{ type: 'work_item_delivered', work_item_id: item.work_item_id, pr: args.pr, summary: args.summary, artifacts: args.artifacts }],
    answer: { delivered: item.work_item_id, pr: args.pr, artifacts: args.artifacts.map((artifact) => artifact.name), note: 'Now write your workflow post mortem (work_post_mortem).' },
  }
}

export function recordPostMortem(item: WorkItemState, args: PostMortemArgs): Decision {
  if (item.status !== 'delivered') throw new Refused('A workflow post mortem is written once the work item is delivered.')
  if (item.post_mortems.includes('agent')) throw new Refused('You already wrote the workflow post mortem for this work item.')
  return {
    events: [{ type: 'post_mortem_written', work_item_id: item.work_item_id, author: 'agent', ...args }],
    answer: { recorded: 'post_mortem', work_item_id: item.work_item_id },
  }
}
