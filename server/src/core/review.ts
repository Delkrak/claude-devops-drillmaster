import type { DrillmasterEvent, GateSubmitted, InputAnswer, Position, StepSkipRequested, WorkTrace } from './events.js'
import { parseRef, stepName, stepPosition } from './refs.js'
import type { WorkItemState } from './state.js'
import { inputsSetAt, nextPosition, stepAt } from './work.js'
import { AT_START, findRule, type WorkflowDocument, type WorkItemInput } from './workflow.js'

export const GATE_REVIEW_KIND = 'gate'
const MAX_TRACES_IN_PROMPT = 120
const MAX_ANSWER_IN_ERROR = 300

export interface GateAnswer {
  accepted: boolean
  why: string
  rule: string | null
  back_to?: Position | string
}

const formatCaptures = (trace: WorkTrace) =>
  (trace.captures ?? []).map((capture) => `\n  captured ${capture.name} (by the workflow's tool capture): ${capture.lines.slice(0, 10).join(' | ')}`).join('')

const formatTraceLine = (trace: WorkTrace) =>
  `- ${trace.id} ${trace.at} ${trace.hook}${trace.tool ? ` ${trace.tool}` : ''}${trace.input ? ` ${trace.input}` : ''}${trace.error ? ' (error)' : ''}${trace.exit_code !== undefined ? ` exit ${trace.exit_code}` : ''}${formatCaptures(trace)}${trace.output ? `\n  output (tail): ${trace.output.split('\n').slice(-5).join('\n  ')}` : ''}${trace.prompt ? ` Owner: "${trace.prompt}"` : ''}`

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
    ...(item.description ? [`What the work item is about: ${item.description}`] : []),
    `The stage's purpose: ${workflow.stages[submission.stage - 1]?.purpose || 'not stated'}`,
    `The work step's instruction to Agent: ${step.instruction || 'not stated'}`,
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
    ...inputQuestionLines(inputsSetAt(workflow, stepName(submission.stage, submission.step), 'drillmaster')),
    'Answer with JSON only, no prose around it:',
    '{"accepted": true|false, "rule": "<the rule your verdict cites, e.g. pr 1.1, or null>", "why": "<one or two sentences>", "back_to": "<stage>.<step>", "inputs": [{"name": "<input>", "value": "<option>", "explanation": "<why>"}]}',
    'Reject when any referenced rule is not met or the evidence is not backed by the work traces, and cite that rule.',
    'back_to is only for a rejection: the work step the work goes back to (this one or an earlier one).',
  ].join('\n')
}

function inputQuestionLines(inputs: readonly WorkItemInput[]) {
  if (inputs.length === 0) return []
  return [
    'Also set these work item inputs: pick one option for each, following its instruction.',
    ...inputs.map((input) => `- ${input.name}: ${input.instruction} Options: ${input.options.map((option) => `${option.value} (${option.description})`).join('; ')}`),
    '',
  ]
}

export const INPUT_REVIEW_KIND = 'inputs'

/** Drillmaster sets its inputs of a work item that started (`at` null) or passed the step `at`. */
export function buildInputPrompt(workflow: WorkflowDocument, item: WorkItemState, at: { stage: number; step: number } | null, events: readonly DrillmasterEvent[]) {
  const itemEvents = events.filter((event) => 'work_item_id' in event && event.work_item_id === item.work_item_id)
  const traces = itemEvents.filter((event): event is WorkTrace => event.type === 'work_trace').slice(-MAX_TRACES_IN_PROMPT)
  const reports = itemEvents.filter((event) => event.type === 'work_reported' || event.type === 'gate_submitted').map((event) => `- ${JSON.stringify(event)}`)
  return [
    `You are Drillmaster. Work item ${item.work_item_id} (${item.issue}) ${at ? `passed work step ${at.stage}.${at.step}` : 'has just started'}.`,
    ...(item.description ? [`What the work item is about: ${item.description}`] : []),
    '',
    ...inputQuestionLines(inputsSetAt(workflow, at ? stepName(at.stage, at.step) : AT_START, 'drillmaster')),
    "Agent's work reports:",
    ...(reports.length ? reports : ['- none']),
    '',
    'Work traces, most recent last:',
    ...(traces.length ? traces.map(formatTraceLine) : ['- none']),
    '',
    'Answer with JSON only:',
    '{"inputs": [{"name": "<input>", "value": "<option>", "explanation": "<why>"}]}',
  ].join('\n')
}

/** Keeps the answers that name a due input and one of its options. */
export function readInputAnswers(inputs: readonly WorkItemInput[], answer: unknown): InputAnswer[] {
  const parsed = (typeof answer === 'string' ? extractFirstJsonObject(answer) : answer) as { inputs?: unknown } | undefined
  if (!parsed || !Array.isArray(parsed.inputs)) return []
  return parsed.inputs.flatMap((candidate: Partial<InputAnswer>) => {
    const input = inputs.find((due) => due.name === candidate.name)
    if (!input || !input.options.some((option) => option.value === candidate.value)) return []
    return [{ name: input.name, value: candidate.value!, ...(typeof candidate.explanation === 'string' ? { explanation: candidate.explanation } : {}) }]
  })
}

export const SKIP_REVIEW_KIND = 'skip'

export function buildSkipPrompt(workflow: WorkflowDocument, item: WorkItemState, request: StepSkipRequested, events: readonly DrillmasterEvent[]) {
  const step = stepAt(workflow, request.stage, request.step)!
  const traces = events.filter((event): event is WorkTrace => event.type === 'work_trace' && event.work_item_id === item.work_item_id).slice(-MAX_TRACES_IN_PROMPT)
  return [
    'You are Drillmaster. The workflow marks this work step as skippable, with you deciding. Agent asks to skip it for this work item.',
    'Approve when the step is not needed for this work item, judged by what the work item is about and what Agent did. Otherwise reject it, and say why.',
    '',
    `Work item ${item.work_item_id} (${item.issue}): ${item.description || 'no description'}`,
    `Step ${request.stage}.${request.step} "${step.name}" (${step.gate} gate): ${step.instruction || 'no instruction'}`,
    ...step.rules.map((ruleRef) => {
      const rule = findRule(workflow, ruleRef)!
      return `- rule ${ruleRef}: ${rule.rule} (verified by ${rule.verified_by})`
    }),
    '',
    `Agent's reason: ${request.why}`,
    '',
    `Work traces (${traces.length}, most recent last):`,
    ...(traces.length ? traces.map(formatTraceLine) : ['- none']),
    '',
    'Answer with JSON only:',
    '{"accepted": true|false, "why": "<one or two sentences>"}',
  ].join('\n')
}

export function readSkipAnswer(answer: unknown) {
  const parsed = (typeof answer === 'string' ? extractFirstJsonObject(answer) : answer) as { accepted?: unknown; why?: unknown } | undefined
  if (!parsed || typeof parsed.accepted !== 'boolean' || typeof parsed.why !== 'string' || !parsed.why.trim()) {
    throw new InvalidAnswer(`Drillmaster's answer is not a verdict: ${JSON.stringify(answer).slice(0, MAX_ANSWER_IN_ERROR)}`)
  }
  return { accepted: parsed.accepted, why: parsed.why }
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
  const inputs = readInputAnswers(inputsSetAt(workflow, stepName(submission.stage, submission.step), 'drillmaster'), gateAnswer)
  if (gateAnswer.accepted) {
    return { verdict: { accepted: true, why: gateAnswer.why, rule: citedRule, ...nextPosition(workflow, submission.stage, submission.step) }, inputs }
  }
  return { verdict: { accepted: false, why: gateAnswer.why, rule: citedRule, next: backToThisOrEarlierStep(workflow, submission, gateAnswer.back_to), done: false }, inputs }
}

function backToThisOrEarlierStep(workflow: WorkflowDocument, submission: GateSubmitted, backTo: Position | string | undefined): Position {
  const currentStep = { stage: submission.stage, step: submission.step }
  const target = typeof backTo === 'string' ? stepPosition(parseRef(backTo, 'step').name) : backTo && typeof backTo.stage === 'number' ? { stage: backTo.stage, step: typeof backTo.step === 'number' ? backTo.step : 1 } : undefined
  if (!target) return currentStep
  const targetExists = stepAt(workflow, target.stage, target.step) !== undefined
  const targetIsNotLater = target.stage < currentStep.stage || (target.stage === currentStep.stage && target.step <= currentStep.step)
  return targetExists && targetIsNotLater ? target : currentStep
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
