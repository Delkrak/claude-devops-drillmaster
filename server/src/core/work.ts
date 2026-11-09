import type { NewEvent, Position, ReportKind, SelfCheck } from './events.js'
import type { ProjectState, WorkItemState } from './state.js'
import type { WorkflowDocument, WorkStep } from './workflow.js'

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
export type GateArgs = { stage: number; step: number; self_check: SelfCheck[]; text: string }
export type DeliverArgs = { pr: string }
export type PostMortemArgs = { keep: string; change: string; experiment_reflections: string; free_text: string }
export function workflowOfWorkItem(state: ProjectState, item: WorkItemState): WorkflowDocument {
  const workflow = state.versions[item.workflow_version]
  if (!workflow) throw new Error(`Work item ${item.work_item_id} runs on unknown workflow version ${item.workflow_version}`)
  return workflow
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

const describePosition = (position: Position) => (position.stage === null ? 'past the last work stage' : `work step ${position.stage}.${position.step}`)

function refuseIfDelivered(item: WorkItemState) {
  if (item.status === 'delivered') throw new Refused(`Work item ${item.work_item_id} is delivered. Only its post mortem remains.`)
}

export function recordReport(item: WorkItemState, args: ReportArgs): Decision {
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
    stage: args.stage ?? item.stage,
    step: args.step ?? item.step,
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

  const submitted: NewEvent = {
    type: 'gate_submitted',
    work_item_id: item.work_item_id,
    stage: args.stage,
    step: args.step,
    gate: step.gate,
    self_check: args.self_check,
    text: args.text,
  }
  if (step.gate !== 'self') {
    return {
      events: [submitted],
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
    stage: args.stage,
    step: args.step,
    accepted: !failedCheck,
    by: 'agent',
    why: failedCheck ? `Self check failed: ${failedCheck.evidence}` : 'Self check passed.',
    rule: failedCheck?.rule ?? null,
    ...position,
  }
  return {
    events: [submitted, verdict],
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

export function deliverWorkItem(item: WorkItemState, args: DeliverArgs): Decision {
  refuseIfDelivered(item)
  if (item.pending_gate) throw new Refused(`The ${item.pending_gate.gate} gate of ${describePosition(item)} is still pending.`)
  if (!item.gates_done) throw new Refused(`The work item is at ${describePosition(item)}. Every work gate must pass before delivery.`)
  return {
    events: [{ type: 'work_item_delivered', work_item_id: item.work_item_id, pr: args.pr }],
    answer: { delivered: item.work_item_id, pr: args.pr, note: 'Now write your workflow post mortem (work_report action "post_mortem").' },
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
