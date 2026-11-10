import type { Artifact, MetricAnswer, NewEvent, Position, ReportKind, SelfCheck } from './events.js'
import type { ExperimentReflection, Feedback } from './feedback.js'
import { stepGuidAt, stepName } from './refs.js'
import { findVersion, type ProjectState, type WorkItemState } from './state.js'
import { compareVersions, isMajorChange, type WorkflowDocument, type WorkflowMetric, type WorkStep } from './workflow.js'

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
export type GateArgs = { stage: number; step: number; self_check: SelfCheck[]; text: string; metrics?: MetricAnswer[] }
export type DeliverArgs = { pr: string; summary: string; artifacts: Artifact[] }
export type PostMortemArgs = { keep: Feedback[]; change: Feedback[]; experiment_reflections: ExperimentReflection[] }
/**
 * A work item runs on the latest version with the major version it started or restarted on: a
 * minor change applies to it right away, and only a major one restarts it.
 */
export function workflowOfWorkItem(state: ProjectState, item: WorkItemState): WorkflowDocument {
  const started = findVersion(state, item.workflow_version)
  if (!started) throw new Error(`Work item ${item.work_item_id} runs on unknown workflow version ${item.workflow_version}`)
  const sameMajor = state.versions.filter((candidate) => !isMajorChange(candidate.version, started.version))
  return sameMajor.reduce((latest, candidate) => (compareVersions(candidate.version, latest.version) > 0 ? candidate : latest), started)
}

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

export const dueMetrics = (workflow: WorkflowDocument, stage: number, step: number, by?: WorkflowMetric['by']) =>
  workflow.metrics.filter((metric) => metric.at_step === stepName(stage, step) && (by === undefined || metric.by === by))

function recordAgentMetrics(workflow: WorkflowDocument, item: WorkItemState, args: GateArgs): NewEvent[] {
  const due = dueMetrics(workflow, args.stage, args.step, 'agent')
  const answers = args.metrics ?? []
  const unknown = answers.filter((answer) => !due.some((metric) => metric.name === answer.name))
  if (unknown.length) throw new Refused(`No metric ${unknown.map((answer) => answer.name).join(', ')} is yours to take at work step ${args.stage}.${args.step}.`)
  return due.map((metric) => {
    const answer = answers.find((candidate) => candidate.name === metric.name)
    const values = metric.categories.map((category) => category.value)
    if (!answer || !values.includes(answer.value)) {
      throw new Refused(`Take metric "${metric.name}" with this gate: ${metric.instruction} Pick one of: ${values.join(', ')}.`)
    }
    return {
      type: 'metric_recorded',
      work_item_id: item.work_item_id,
      ...atStep(workflow, args.stage, args.step),
      name: metric.name,
      value: answer.value,
      ...(answer.explanation ? { explanation: answer.explanation } : {}),
      by: 'agent',
    } satisfies NewEvent
  })
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
  return { events: [event], answer: { recorded: kind, stage: item.stage, step: item.step } }
}

export function handInGate(state: ProjectState, item: WorkItemState, args: GateArgs): Decision {
  refuseIfDelivered(item)
  const workflow = workflowOfWorkItem(state, item)
  if (item.stage === null) {
    throw new Refused(
      workflow.stages.length === 0
        ? 'The workflow has no work stages, so there are no work gates. Deliver when the work is done.'
        : 'Every work gate has passed. Deliver the work item.',
    )
  }
  if (item.late_start?.status === 'judging' || item.late_start?.status === 'awaiting_owner') {
    throw new Refused(`Your late start at work step ${item.late_start.start_at.stage}.${item.late_start.start_at.step} is being judged. Wait for the verdict (work_status).`)
  }
  if (item.pending_gate && !(item.pending_gate.gate === 'drillmaster' && item.pending_gate.review_failed)) {
    throw new Refused(`The ${item.pending_gate.gate} gate of ${describePosition(item)} is pending. Wait for its verdict (work_status).`)
  }
  if (args.stage !== item.stage || args.step !== item.step) {
    throw new Refused(`The work item is at ${describePosition(item)}, not ${args.stage}.${args.step}. Work steps are carried out in order.`)
  }
  const step = stepAt(workflow, args.stage, args.step)!
  const checkedRules = args.self_check.map((check) => check.rule)
  const missingRules = step.rules.filter((ruleRef) => !checkedRules.includes(ruleRef))
  const unreferencedRules = checkedRules.filter((ruleRef) => !step.rules.includes(ruleRef))
  if (missingRules.length || unreferencedRules.length || new Set(checkedRules).size !== checkedRules.length) {
    throw new Refused(
      `The gate of work step ${args.stage}.${args.step} references ${step.rules.length ? step.rules.join(', ') : 'no rules'}. ` +
        'Give exactly one self check per referenced rule.' +
        (missingRules.length ? ` Missing: ${missingRules.join(', ')}.` : '') +
        (unreferencedRules.length ? ` Not referenced: ${unreferencedRules.join(', ')}.` : ''),
    )
  }

  const metricEvents = recordAgentMetrics(workflow, item, args)

  const submitted: NewEvent = {
    type: 'gate_submitted',
    work_item_id: item.work_item_id,
    ...atStep(workflow, args.stage, args.step),
    gate: step.gate,
    self_check: args.self_check,
    text: args.text,
  }
  if (step.gate !== 'self') {
    return {
      events: [submitted, ...metricEvents],
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
  const position = failedCheck ? { next: { stage: args.stage, step: args.step }, done: false } : nextPosition(workflow, args.stage, args.step)
  const verdict: NewEvent = {
    type: 'gate_verdict',
    work_item_id: item.work_item_id,
    ...atStep(workflow, args.stage, args.step),
    accepted: !failedCheck,
    by: 'agent',
    why: failedCheck ? `Self check failed: ${failedCheck.evidence}` : 'Self check passed.',
    rule: failedCheck?.rule ?? null,
    ...position,
  }
  return {
    events: [submitted, ...metricEvents, verdict],
    answer: {
      verdict: failedCheck ? 'rejected' : 'accepted',
      by: 'agent',
      rule: failedCheck?.rule ?? null,
      why: verdict.why,
      next: position.next,
      done: position.done,
      note: failedCheck
        ? `Fix it and submit the gate of ${args.stage}.${args.step} again. A rejection is an impediment: report what got in the way.`
        : position.done
          ? 'Every work gate has passed. Deliver the work item.'
          : `Next: ${describePosition(position.next)}.`,
    },
  }
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
