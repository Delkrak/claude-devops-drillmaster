import type { DrillmasterEvent, GateSubmitted, Position, WorkTrace } from './events.js'
import type { WorkItemState } from './state.js'
import { nextPosition, stepAt } from './work.js'
import { findRule, type WorkflowDocument } from './workflow.js'

export const GATE_REVIEW_KIND = 'gate'
const MAX_TRACES_IN_PROMPT = 120
const MAX_ANSWER_IN_ERROR = 300

export interface GateAnswer {
  accepted: boolean
  why: string
  rule: string | null
  back_to?: Position
}

const formatTraceLine = (trace: WorkTrace) =>
  `- ${trace.at} ${trace.hook}${trace.tool ? ` ${trace.tool}` : ''}${trace.input ? ` ${trace.input}` : ''}${trace.error ? ' (error)' : ''}${trace.prompt ? ` Owner: "${trace.prompt}"` : ''}`

export function buildGatePrompt(workflow: WorkflowDocument, item: WorkItemState, submission: GateSubmitted, events: readonly DrillmasterEvent[]) {
  const step = stepAt(workflow, submission.stage, submission.step)!
  const ruleLines = step.rules.map((ruleRef) => {
    const rule = findRule(workflow, ruleRef)!
    return `- ${ruleRef}: ${rule.rule} (verified by ${rule.verified_by})`
  })
  const itemEvents = events.filter((event) => 'work_item_id' in event && event.work_item_id === item.work_item_id)
  const earlierReportLines = itemEvents
    .filter((event) => (event.type === 'work_reported' || event.type === 'gate_submitted' || event.type === 'gate_verdict') && event.id !== submission.id)
    .map((event) => `- ${JSON.stringify(event)}`)
  const traces = itemEvents.filter((event): event is WorkTrace => event.type === 'work_trace')
  const shownTraces = traces.slice(-MAX_TRACES_IN_PROMPT)

  return [
    'You are Drillmaster, a drill sergeant trained in agile. You trust Agent, but you verify:',
    'judge the work report against the rules, and check it against the work traces, which record',
    'what Agent actually did, independent of Agent.',
    '',
    `Work item ${item.work_item_id} (${item.issue}). Drillmaster gate of work step ${submission.stage}.${submission.step}: "${step.name}".`,
    `The work step requires reporting: ${step.report.length ? step.report.join('; ') : 'nothing extra'}.`,
    '',
    'Rules this gate references:',
    ...(ruleLines.length ? ruleLines : ['- none']),
    '',
    "Agent's new work report:",
    JSON.stringify({ self_check: submission.self_check, text: submission.text }, null, 2),
    '',
    "Agent's earlier work reports and verdicts on this work item:",
    ...(earlierReportLines.length ? earlierReportLines : ['- none']),
    '',
    `Work traces (${shownTraces.length} of ${traces.length}, most recent last):`,
    ...(shownTraces.length ? shownTraces.map(formatTraceLine) : ['- none']),
    '',
    'Answer with JSON only, no prose around it:',
    '{"accepted": true|false, "rule": "<the rule your verdict cites, e.g. pr 1.1, or null>", "why": "<one or two sentences>", "back_to": {"stage": n, "step": n}}',
    'Reject when any referenced rule is not met or the evidence is not backed by the work traces, and cite that rule.',
    'back_to is only for a rejection: the work step the work goes back to (this one or an earlier one).',
  ].join('\n')
}

export class InvalidAnswer extends Error {}

export function readGateAnswer(workflow: WorkflowDocument, submission: GateSubmitted, answer: unknown) {
  const gateAnswer = (typeof answer === 'string' ? extractFirstJsonObject(answer) : answer) as Partial<GateAnswer> | undefined
  if (!gateAnswer || typeof gateAnswer.accepted !== 'boolean' || typeof gateAnswer.why !== 'string' || gateAnswer.why.trim() === '') {
    throw new InvalidAnswer(`Drillmaster's answer is not a verdict: ${JSON.stringify(answer).slice(0, MAX_ANSWER_IN_ERROR)}`)
  }
  const step = stepAt(workflow, submission.stage, submission.step)!
  const citedRule = typeof gateAnswer.rule === 'string' && step.rules.includes(gateAnswer.rule) ? gateAnswer.rule : null
  if (!gateAnswer.accepted && step.rules.length > 0 && !citedRule) {
    throw new InvalidAnswer(`A rejection must cite one of the referenced rules (${step.rules.join(', ')}).`)
  }
  if (gateAnswer.accepted) {
    return { accepted: true, why: gateAnswer.why, rule: citedRule, ...nextPosition(workflow, submission.stage, submission.step) }
  }
  return { accepted: false, why: gateAnswer.why, rule: citedRule, next: backToThisOrEarlierStep(workflow, submission, gateAnswer.back_to), done: false }
}

function backToThisOrEarlierStep(workflow: WorkflowDocument, submission: GateSubmitted, backTo: Position | undefined): Position {
  const currentStep = { stage: submission.stage, step: submission.step }
  if (!backTo || typeof backTo.stage !== 'number') return currentStep
  const targetStep = typeof backTo.step === 'number' ? backTo.step : 1
  const targetExists = stepAt(workflow, backTo.stage, targetStep) !== undefined
  const targetIsNotLater = backTo.stage < currentStep.stage || (backTo.stage === currentStep.stage && targetStep <= currentStep.step)
  return targetExists && targetIsNotLater ? { stage: backTo.stage, step: targetStep } : currentStep
}

export function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}
