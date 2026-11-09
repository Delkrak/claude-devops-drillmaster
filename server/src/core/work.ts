// Work execution: what Agent's work_report means. Pure: state and args in, the events to append
// and Agent's answer out. A refusal explains what Agent must do instead.

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

/** The workflow version the work item runs through: it keeps it, even if the workflow changes. */
export function workflowOf(state: ProjectState, item: WorkItemState): WorkflowDocument {
  const doc = state.versions[item.workflow_version]
  if (!doc) throw new Error(`Work item ${item.work_item_id} runs on unknown workflow version ${item.workflow_version}`)
  return doc
}

export function stepAt(doc: WorkflowDocument, stage: number, step: number): WorkStep | undefined {
  return doc.stages.find((s) => s.n === stage)?.steps.find((s) => s.n === step)
}

/** The work step after this one: the next step, the next stage's first step, or done. */
export function nextPosition(doc: WorkflowDocument, stage: number, step: number): { next: Position; done: boolean } {
  const current = doc.stages.find((s) => s.n === stage)
  if (current && step < current.steps.length) return { next: { stage, step: step + 1 }, done: false }
  const following = doc.stages.find((s) => s.n > stage && s.steps.length > 0)
  if (following) return { next: { stage: following.n, step: 1 }, done: false }
  return { next: { stage: null, step: null }, done: true }
}

const where = (p: Position) => (p.stage === null ? 'past the last work stage' : `work step ${p.stage}.${p.step}`)

function requireActive(item: WorkItemState) {
  if (item.status === 'delivered') throw new Refused(`Work item ${item.work_item_id} is delivered. Only its post mortem remains.`)
}

export function report(item: WorkItemState, args: ReportArgs): Decision {
  requireActive(item)
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
  }
  return { events: [event], answer: { recorded: kind, stage: item.stage, step: item.step } }
}

export function gate(state: ProjectState, item: WorkItemState, args: GateArgs): Decision {
  requireActive(item)
  const doc = workflowOf(state, item)
  if (item.stage === null) {
    throw new Refused(
      doc.stages.length === 0
        ? 'The workflow has no work stages, so there are no work gates. Deliver when the work is done.'
        : 'Every work gate has passed. Deliver the work item.',
    )
  }
  // A Drillmaster gate whose review failed may be handed in again; anything else pending waits.
  if (item.pending_gate && !(item.pending_gate.gate === 'drillmaster' && item.pending_gate.review_failed)) {
    throw new Refused(`The ${item.pending_gate.gate} gate of ${where(item)} is pending. Wait for its verdict (work_status).`)
  }
  if (args.stage !== item.stage || args.step !== item.step) {
    throw new Refused(`The work item is at ${where(item)}, not ${args.stage}.${args.step}. Work steps are carried out in order.`)
  }
  const step = stepAt(doc, args.stage, args.step)!
  const checked = args.self_check.map((c) => c.rule)
  const missing = step.rules.filter((r) => !checked.includes(r))
  const extra = checked.filter((r) => !step.rules.includes(r))
  if (missing.length || extra.length || new Set(checked).size !== checked.length) {
    throw new Refused(
      `The gate of work step ${args.stage}.${args.step} references ${step.rules.length ? step.rules.join(', ') : 'no rules'}. ` +
        'Give exactly one self check per referenced rule.' +
        (missing.length ? ` Missing: ${missing.join(', ')}.` : '') +
        (extra.length ? ` Not referenced: ${extra.join(', ')}.` : ''),
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

  // A self gate: Agent answers for its own work. A failed self check sends it back to the same step.
  const failed = args.self_check.find((c) => !c.accepted)
  const position = failed ? { next: { stage: args.stage, step: args.step }, done: false } : nextPosition(doc, args.stage, args.step)
  const verdict: NewEvent = {
    type: 'gate_verdict',
    work_item_id: item.work_item_id,
    stage: args.stage,
    step: args.step,
    accepted: !failed,
    by: 'agent',
    why: failed ? `Self check failed: ${failed.evidence}` : 'Self check passed.',
    rule: failed?.rule ?? null,
    ...position,
  }
  return {
    events: [submitted, verdict],
    answer: {
      verdict: failed ? 'rejected' : 'accepted',
      by: 'agent',
      rule: failed?.rule ?? null,
      why: verdict.why,
      next: position.next,
      done: position.done,
      note: failed
        ? `Fix it and submit the gate of ${args.stage}.${args.step} again. A rejection is an impediment: report what got in the way.`
        : position.done
          ? 'Every work gate has passed. Deliver the work item.'
          : `Next: ${where(position.next)}.`,
    },
  }
}

export function deliver(item: WorkItemState, args: DeliverArgs): Decision {
  requireActive(item)
  if (item.pending_gate) throw new Refused(`The ${item.pending_gate.gate} gate of ${where(item)} is still pending.`)
  if (!item.gates_done) throw new Refused(`The work item is at ${where(item)}. Every work gate must pass before delivery.`)
  return {
    events: [{ type: 'work_item_delivered', work_item_id: item.work_item_id, pr: args.pr }],
    answer: { delivered: item.work_item_id, pr: args.pr, note: 'Now write your workflow post mortem (work_report action "post_mortem").' },
  }
}

export function postMortem(item: WorkItemState, args: PostMortemArgs): Decision {
  if (item.status !== 'delivered') throw new Refused('A workflow post mortem is written once the work item is delivered.')
  if (item.post_mortems.includes('agent')) throw new Refused('You already wrote the workflow post mortem for this work item.')
  return {
    events: [{ type: 'post_mortem_written', work_item_id: item.work_item_id, author: 'agent', ...args }],
    answer: { recorded: 'post_mortem', work_item_id: item.work_item_id },
  }
}
