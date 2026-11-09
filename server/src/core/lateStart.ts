import type { DrillmasterEvent, NewEvent, WorkTrace } from './events.js'
import { extractFirstJsonObject, InvalidAnswer } from './review.js'
import { firstPosition, type ProjectState, type WorkItemState } from './state.js'
import { Refused, stepAt, workflowOfWorkItem } from './work.js'
import { findRule, type WorkflowDocument } from './workflow.js'

export const LATE_START_REVIEW_KIND = 'late_start'
const MAX_TRACES_IN_PROMPT = 150
const MAX_ANSWER_IN_ERROR = 300

export interface LateStartArgs {
  start_at: { stage: number; step: number }
  justification: string
  evidence: string
}

const stepLabel = (stage: number, step: number) => `${stage}.${step}`

/** Every work step from where the item is up to, not including, the step it starts at. */
export function stepsSkippedBy(workflow: WorkflowDocument, from: { stage: number; step: number }, to: { stage: number; step: number }) {
  const skipped: { label: string; gate: string; rules: string[] }[] = []
  for (const stage of workflow.stages) {
    for (const step of stage.steps) {
      const isFromOrLater = stage.n > from.stage || (stage.n === from.stage && step.n >= from.step)
      const isBeforeTarget = stage.n < to.stage || (stage.n === to.stage && step.n < to.step)
      if (isFromOrLater && isBeforeTarget) skipped.push({ label: stepLabel(stage.n, step.n), gate: step.gate, rules: step.rules })
    }
  }
  return skipped
}

export function requestLateStart(state: ProjectState, item: WorkItemState, args: LateStartArgs): NewEvent {
  if (item.status === 'delivered') throw new Refused(`Work item ${item.work_item_id} is delivered.`)
  if (item.pending_gate) throw new Refused(`The ${item.pending_gate.gate} gate of work step ${item.pending_gate.stage}.${item.pending_gate.step} is pending.`)
  if (item.late_start?.status === 'judging' || item.late_start?.status === 'awaiting_owner') throw new Refused('A late start for this work item is already being judged.')
  const workflow = workflowOfWorkItem(state, item)
  if (!stepAt(workflow, args.start_at.stage, args.start_at.step)) {
    throw new Refused(`There is no work step ${args.start_at.stage}.${args.start_at.step} in workflow ${workflow.version}.`)
  }
  const from = item.stage !== null && item.step !== null ? { stage: item.stage, step: item.step } : firstPosition(workflow)
  if (from.stage === null || from.step === null) throw new Refused('The workflow has no work steps to skip.')
  const skipped = stepsSkippedBy(workflow, { stage: from.stage, step: from.step }, args.start_at)
  if (skipped.length === 0) throw new Refused(`Work step ${args.start_at.stage}.${args.start_at.step} is not after work step ${from.stage}.${from.step}: there is nothing to skip.`)
  return {
    type: 'late_start_requested',
    work_item_id: item.work_item_id,
    start_at: args.start_at,
    justification: args.justification,
    evidence: args.evidence,
    skipped: skipped.map((step) => step.label),
    owner_gates: skipped.filter((step) => step.gate === 'owner').map((step) => step.label),
  }
}

const formatTrace = (trace: WorkTrace) =>
  `- ${trace.at} ${trace.work_item_id ?? 'no work item'} ${trace.hook}${trace.tool ? ` ${trace.tool}` : ''}${trace.input ? ` ${trace.input}` : ''}${trace.exit_code !== undefined ? ` exit ${trace.exit_code}` : ''}${trace.output ? ` -> ${trace.output.split('\n').slice(-3).join(' | ')}` : ''}${trace.prompt ? ` Owner: "${trace.prompt}"` : ''}`

export function buildLateStartPrompt(workflow: WorkflowDocument, item: WorkItemState, request: Extract<DrillmasterEvent, { type: 'late_start_requested' }>, events: readonly DrillmasterEvent[]) {
  const skippedLines = request.skipped.flatMap((label) => {
    const [stage, step] = label.split('.').map(Number) as [number, number]
    const workStep = stepAt(workflow, stage, step)!
    return [
      `- work step ${label} "${workStep.name}" (${workStep.gate} gate): ${workStep.instruction || 'no instruction'}`,
      ...workStep.rules.map((ruleRef) => {
        const rule = findRule(workflow, ruleRef)!
        return `  - ${ruleRef}: ${rule.rule} (verified by ${rule.verified_by})`
      }),
    ]
  })
  const traces = events.filter((event): event is WorkTrace => event.type === 'work_trace').slice(-MAX_TRACES_IN_PROMPT)
  return [
    'You are Drillmaster. Agent asks to start a work item later in the workflow, skipping work steps it says are already done.',
    'Approve only when the evidence and the work traces show that every rule of every skipped step is met. Otherwise reject it and cite the rule not shown to be met.',
    '',
    `Work item ${item.work_item_id} (${item.issue}): ${item.description || 'no description'}`,
    `Start at work step ${request.start_at.stage}.${request.start_at.step} of workflow ${workflow.version}.`,
    '',
    'Skipped work steps and the rules their gates check:',
    ...skippedLines,
    '',
    `Agent's justification: ${request.justification}`,
    `Agent's evidence: ${request.evidence}`,
    '',
    `Work traces in this project, including earlier work items and earlier workflow versions (${traces.length}, most recent last):`,
    ...(traces.length ? traces.map(formatTrace) : ['- none']),
    '',
    'Answer with JSON only:',
    '{"accepted": true|false, "rule": "<the rule not shown to be met, or null>", "why": "<one or two sentences>"}',
  ].join('\n')
}

export function readLateStartAnswer(workflow: WorkflowDocument, skipped: readonly string[], answer: unknown) {
  const parsed = (typeof answer === 'string' ? extractFirstJsonObject(answer) : answer) as { accepted?: unknown; why?: unknown; rule?: unknown } | undefined
  if (!parsed || typeof parsed.accepted !== 'boolean' || typeof parsed.why !== 'string' || !parsed.why.trim()) {
    throw new InvalidAnswer(`Drillmaster's answer is not a verdict: ${JSON.stringify(answer).slice(0, MAX_ANSWER_IN_ERROR)}`)
  }
  const skippedRules = skipped.flatMap((label) => {
    const [stage, step] = label.split('.').map(Number) as [number, number]
    return stepAt(workflow, stage, step)?.rules ?? []
  })
  const rule = typeof parsed.rule === 'string' && skippedRules.includes(parsed.rule) ? parsed.rule : null
  return { accepted: parsed.accepted, why: parsed.why, rule }
}

export function describeWorkflowChange(from: WorkflowDocument, to: WorkflowDocument) {
  const lines: string[] = []
  const stepsOf = (workflow: WorkflowDocument) =>
    new Map(workflow.stages.flatMap((stage) => stage.steps.map((step) => [`${stage.name} / ${step.name}`, { label: stepLabel(stage.n, step.n), step }] as const)))
  const before = stepsOf(from)
  const after = stepsOf(to)
  for (const [key, { label, step }] of after) {
    const earlier = before.get(key)
    if (!earlier) lines.push(`- new: work step ${label} "${step.name}" (${step.gate} gate)`)
    else if (earlier.step.gate !== step.gate) lines.push(`- changed: work step ${label} "${step.name}" is now a ${step.gate} gate (was ${earlier.step.gate})`)
    else if (earlier.step.rules.join() !== step.rules.join()) lines.push(`- changed: work step ${label} "${step.name}" now checks ${step.rules.join(', ') || 'no rules'}`)
  }
  for (const [key, { label }] of before) if (!after.has(key)) lines.push(`- removed: work step ${label} "${key.split(' / ')[1]}"`)
  return lines.length ? lines : ['- the work steps are the same; their text changed']
}
