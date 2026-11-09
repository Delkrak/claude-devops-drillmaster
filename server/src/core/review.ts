// What Drillmaster is asked at a Drillmaster gate, and how its answer becomes a verdict. Pure.

import type { DrillmasterEvent, GateSubmitted, Position, WorkTrace } from './events.js'
import type { WorkItemState } from './state.js'
import { nextPosition, stepAt } from './work.js'
import { findRule, type WorkflowDocument } from './workflow.js'

export const GATE_REVIEW = 'gate'
const MAX_TRACES = 120

export interface GateAnswer {
  accepted: boolean
  why: string
  rule: string | null
  back_to?: Position
}

const line = (t: WorkTrace) =>
  `- ${t.at} ${t.hook}${t.tool ? ` ${t.tool}` : ''}${t.input ? ` ${t.input}` : ''}${t.error ? ' (error)' : ''}${t.prompt ? ` Owner: "${t.prompt}"` : ''}`

/** Everything Drillmaster needs: the rules, the new work report, and the whole work item so far. */
export function buildGatePrompt(doc: WorkflowDocument, item: WorkItemState, submission: GateSubmitted, events: readonly DrillmasterEvent[]) {
  const step = stepAt(doc, submission.stage, submission.step)!
  const rules = step.rules.map((ref) => {
    const r = findRule(doc, ref)!
    return `- ${ref}: ${r.rule} (verified by ${r.verified_by})`
  })
  const mine = events.filter((e) => 'work_item_id' in e && e.work_item_id === item.work_item_id)
  const reports = mine
    .filter((e) => (e.type === 'work_reported' || e.type === 'gate_submitted' || e.type === 'gate_verdict') && e.id !== submission.id)
    .map((e) => `- ${JSON.stringify(e)}`)
  const traces = mine.filter((e): e is WorkTrace => e.type === 'work_trace')
  const shown = traces.slice(-MAX_TRACES)

  return [
    'You are Drillmaster, a drill sergeant trained in agile. You trust Agent, but you verify:',
    'judge the work report against the rules, and check it against the work traces, which record',
    'what Agent actually did, independent of Agent.',
    '',
    `Work item ${item.work_item_id} (${item.issue}). Drillmaster gate of work step ${submission.stage}.${submission.step}: "${step.name}".`,
    `The work step requires reporting: ${step.report.length ? step.report.join('; ') : 'nothing extra'}.`,
    '',
    'Rules this gate references:',
    ...(rules.length ? rules : ['- none']),
    '',
    "Agent's new work report:",
    JSON.stringify({ self_check: submission.self_check, text: submission.text }, null, 2),
    '',
    "Agent's earlier work reports and verdicts on this work item:",
    ...(reports.length ? reports : ['- none']),
    '',
    `Work traces (${shown.length} of ${traces.length}, most recent last):`,
    ...(shown.length ? shown.map(line) : ['- none']),
    '',
    'Answer with JSON only, no prose around it:',
    '{"accepted": true|false, "rule": "<the rule your verdict cites, e.g. pr 1.1, or null>", "why": "<one or two sentences>", "back_to": {"stage": n, "step": n}}',
    'Reject when any referenced rule is not met or the evidence is not backed by the work traces, and cite that rule.',
    'back_to is only for a rejection: the work step the work goes back to (this one or an earlier one).',
  ].join('\n')
}

export class InvalidAnswer extends Error {}

/** Checks Drillmaster's answer and turns it into the verdict's fields. */
export function readGateAnswer(doc: WorkflowDocument, submission: GateSubmitted, answer: unknown) {
  const a = (typeof answer === 'string' ? extractJson(answer) : answer) as Partial<GateAnswer> | undefined
  if (!a || typeof a.accepted !== 'boolean' || typeof a.why !== 'string' || a.why.trim() === '') {
    throw new InvalidAnswer(`Drillmaster's answer is not a verdict: ${JSON.stringify(answer).slice(0, 300)}`)
  }
  const step = stepAt(doc, submission.stage, submission.step)!
  const rule = typeof a.rule === 'string' && step.rules.includes(a.rule) ? a.rule : null
  if (!a.accepted && step.rules.length > 0 && !rule) {
    throw new InvalidAnswer(`A rejection must cite one of the referenced rules (${step.rules.join(', ')}).`)
  }
  if (a.accepted) {
    return { accepted: true, why: a.why, rule, ...nextPosition(doc, submission.stage, submission.step) }
  }
  const back = normalizeBack(doc, submission, a.back_to)
  return { accepted: false, why: a.why, rule, next: back, done: false }
}

/** The work goes back to this work step or an earlier one; anything else means this one. */
function normalizeBack(doc: WorkflowDocument, submission: GateSubmitted, back: Position | undefined): Position {
  const here = { stage: submission.stage, step: submission.step }
  if (!back || typeof back.stage !== 'number') return here
  const step = typeof back.step === 'number' ? back.step : 1
  const exists = stepAt(doc, back.stage, step)
  const notLater = back.stage < here.stage || (back.stage === here.stage && step <= here.step)
  return exists && notLater ? { stage: back.stage, step } : here
}

/** The first JSON object in a model's text answer. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}
