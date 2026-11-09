import type { Position } from './events.js'
import { findRule, type WorkflowDocument, type WorkflowMetric } from './workflow.js'

const quoteBlock = (text: string) => text.split('\n').map((line) => `> ${line}`).join('\n')

function metricLine(metric: WorkflowMetric) {
  const categories = metric.categories.map((category) => `\`${category.value}\` (${category.description})`).join(', ')
  return `- \`${metric.name}\`, by ${metric.by}: ${metric.instruction} Categories: ${categories}.`
}

/** The next work step in full, so Agent never has to look anything up before doing it. */
export function renderStep(workflow: WorkflowDocument, stageNumber: number, stepNumber: number) {
  const stage = workflow.stages.find((candidate) => candidate.n === stageNumber)
  const step = stage?.steps.find((candidate) => candidate.n === stepNumber)
  if (!stage || !step) return `Work step ${stageNumber}.${stepNumber} does not exist in workflow ${workflow.version}.`
  const rules = step.rules.map((ruleRef) => {
    const rule = findRule(workflow, ruleRef)!
    return `- \`${ruleRef}\`: ${rule.rule}. Verified by: ${rule.verified_by}.`
  })
  const metrics = workflow.metrics.filter((metric) => metric.at.stage === stageNumber && metric.at.step === stepNumber)
  const agentMetrics = metrics.filter((metric) => metric.by === 'agent')
  const gateArgs = {
    token: '<your agent_token>',
    stage: stageNumber,
    step: stepNumber,
    self_check: step.rules.map((ruleRef) => ({ rule: ruleRef, accepted: true, evidence: '<what shows it, e.g. a command and its output>' })),
    text: step.report.length ? `<${step.report.join('; ')}>` : '<what you did>',
    ...(agentMetrics.length ? { metrics: agentMetrics.map((metric) => ({ name: metric.name, value: metric.categories.map((category) => category.value).join('|'), explanation: '<why>' })) } : {}),
  }
  const gateWho = { self: 'you judge it yourself', drillmaster: 'Drillmaster judges it from your report and the work traces', owner: 'Owner approves it' }[step.gate]
  return [
    `## Work step ${stageNumber}.${stepNumber}: ${step.name}`,
    '',
    `Stage ${stage.n} "${stage.name}"${stage.purpose ? `: ${stage.purpose}` : ''}`,
    '',
    '**Do this:**',
    quoteBlock(step.instruction || 'No instruction yet. Do what the step name says, and report what was missing.'),
    '',
    `**Gate:** ${step.gate} (${gateWho}).`,
    '',
    '**Rules the gate checks:**',
    ...(rules.length ? rules : ['- none']),
    '',
    `**Report with the gate:** ${step.report.length ? step.report.join('; ') : 'what you did'}.`,
    ...(metrics.length ? ['', '**Metrics taken at this step:**', ...metrics.map(metricLine)] : []),
    ...(workflow.experiments.length
      ? ['', '**Running experiments:**', ...workflow.experiments.map((experiment) => `- #${experiment.id} ${experiment.change}: ${experiment.hypothesis || experiment.purpose}`)]
      : []),
    '',
    'When the work is done, hand in the gate with `work_gate`, one self check per rule:',
    '```json',
    JSON.stringify(gateArgs, null, 2),
    '```',
  ].join('\n')
}

export function renderNext(workflow: WorkflowDocument, next: Position, done: boolean) {
  if (done || next.stage === null || next.step === null) {
    return 'Every work gate has passed. Deliver with `work_deliver` (pr, summary, and any artifacts such as screenshots).'
  }
  return renderStep(workflow, next.stage, next.step)
}

export function renderStarted(args: { workItemId: string; agentToken: string; issue: string; workflow: WorkflowDocument; position: Position }) {
  const lines = [
    `# Work item ${args.workItemId} started: ${args.issue}`,
    '',
    `work_item_id: ${args.workItemId}`,
    `agent_token: ${args.agentToken}`,
    '',
    'Keep the token to yourself, and pass it to every work tool. Report as you go with `work_report`.',
    `Workflow version ${args.workflow.version}.`,
    '',
  ]
  if (args.position.stage === null) {
    lines.push('The workflow has no work stages yet: do your best, and Owner will correct you. Deliver with `work_deliver` when the work is done.')
  } else {
    lines.push(renderStep(args.workflow, args.position.stage, args.position.step!))
  }
  return lines.join('\n')
}

export interface GateOutcome {
  verdict: 'accepted' | 'rejected' | 'pending' | 'superseded'
  by?: string
  rule?: string | null
  why?: string
  stage?: number
  step?: number
  next?: Position
  done?: boolean
  note?: string
}

export function renderGateOutcome(workflow: WorkflowDocument, outcome: GateOutcome) {
  const at = outcome.stage !== undefined ? ` (work step ${outcome.stage}.${outcome.step})` : ''
  switch (outcome.verdict) {
    case 'accepted':
      return [`**Gate accepted** by ${outcome.by}${at}. ${outcome.why ?? ''}`.trim(), '', renderNext(workflow, outcome.next!, outcome.done ?? false)].join('\n')
    case 'rejected':
      return [
        `**Gate rejected** by ${outcome.by}${at}${outcome.rule ? `, citing \`${outcome.rule}\`` : ''}: ${outcome.why ?? ''}`,
        '',
        'A rejection is an impediment: report what got in the way with `work_report` (kind impediment), fix it, and hand the gate in again.',
        '',
        renderNext(workflow, outcome.next!, false),
      ].join('\n')
    default:
      return `**Gate ${outcome.verdict}**${at}. ${outcome.note ?? ''}`.trim()
  }
}

export const renderReported = (kind: string, position: Position) =>
  `Recorded your ${kind} report${position.stage !== null ? ` at work step ${position.stage}.${position.step}` : ''}. Carry on.`

export function renderDelivered(workItemId: string, pr: string, artifacts: string[]) {
  return [
    `**Delivered** ${workItemId} as ${pr}.${artifacts.length ? ` Artifacts: ${artifacts.join(', ')}.` : ''}`,
    '',
    'Drillmaster writes its post mortem now. Write yours with `work_post_mortem`:',
    '```json',
    JSON.stringify({ token: '<your agent_token>', keep: '<what in the workflow helped>', change: '<what got in the way, and how to change it>', experiment_reflections: '<how the running experiments did, or none>', free_text: '<anything else>' }, null, 2),
    '```',
  ].join('\n')
}

export const renderPostMortemRecorded = (workItemId: string) => `Recorded your workflow post mortem for ${workItemId}. The work item is done.`

export function renderAskOwner(askInput: { questions: unknown[] }) {
  return [
    '**Ask Owner now** with AskUserQuestion, from the main conversation (not a subagent), passing exactly this input. Leave `answers` out: Owner gives them.',
    '```json',
    JSON.stringify(askInput, null, 2),
    '```',
    'Owner can pick an option, add a note, or type an answer of their own. Drillmaster records it.',
  ].join('\n')
}
