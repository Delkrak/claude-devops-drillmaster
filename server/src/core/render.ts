import type { Position } from './events.js'
import type { WorkItemState } from './state.js'
import { FEEDBACK_REFS_HELP } from './feedback.js'
import { stepName } from './refs.js'
import { findRule, type WorkflowDocument, type WorkItemInput } from './workflow.js'

const quoteBlock = (text: string) => text.split('\n').map((line) => `> ${line}`).join('\n')

function inputLine(input: WorkItemInput) {
  const options = input.options.map((option) => `\`${option.value}\` (${option.description})`).join(', ')
  return `- \`${input.name}\`, by ${input.by}: ${input.instruction} Options: ${options}.`
}

export function renderStep(workflow: WorkflowDocument, stageNumber: number, stepNumber: number) {
  const stage = workflow.stages.find((candidate) => candidate.n === stageNumber)
  const step = stage?.steps.find((candidate) => candidate.n === stepNumber)
  if (!stage || !step) return `Work step ${stageNumber}.${stepNumber} does not exist in workflow ${workflow.version}.`
  const rules = step.rules.map((ruleRef) => {
    const rule = findRule(workflow, ruleRef)!
    return `- \`${ruleRef}\`: ${rule.rule}. Verified by: ${rule.verified_by}.`
  })
  const inputs = workflow.inputs.filter((input) => input.set_at === stepName(stageNumber, stepNumber))
  const agentInputs = inputs.filter((input) => input.by === 'agent')
  const gateArgs = {
    token: '<your agent_token>',
    step: stepName(stageNumber, stepNumber),
    ...(step.gate === 'owner' ? {} : { self_check: step.rules.map((ruleRef) => ({ rule: ruleRef, accepted: true, evidence: '<what shows it, e.g. a command and its output>' })) }),
    text: step.gate === 'owner' ? `<what Owner should look at${step.report.length ? `: ${step.report.join('; ')}` : ''}>` : step.report.length ? `<${step.report.join('; ')}>` : '<what you did>',
    ...(agentInputs.length ? { inputs: agentInputs.map((input) => ({ name: input.name, value: input.options.map((option) => option.value).join('|'), explanation: '<why>' })) } : {}),
  }
  const gateWho = {
    self: 'you judge it yourself',
    drillmaster: 'Drillmaster judges it from your report and the work traces',
    owner: 'Owner judges it, in AskUserQuestion, with your report and the assumptions you reported beside the question; no self check',
  }[step.gate]
  const skipWho = { self: 'you decide', drillmaster: 'Drillmaster decides', owner: 'Owner decides' }
  return [
    `## Work step ${stageNumber}.${stepNumber}: ${step.name}`,
    '',
    `Stage ${stage.n} "${stage.name}"${stage.purpose ? `: ${stage.purpose}` : ''}`,
    '',
    ...(stage.if || step.if ? [`Applies only when ${[stage.if, step.if].filter(Boolean).join(' && ')}.`, ''] : []),
    '**Do this:**',
    quoteBlock(step.instruction || 'No instruction yet. Do what the step name says, and report what was missing.'),
    '',
    `**Gate:** ${step.gate} (${gateWho}).`,
    '',
    '**Rules the gate checks:**',
    ...(rules.length ? rules : ['- none']),
    '',
    `**Report with the gate:** ${step.report.length ? step.report.join('; ') : 'what you did'}.`,
    ...(step.skippable
      ? ['', `**Skippable** (${skipWho[step.skippable]}): if this work item doesn't need the step, call \`work_skip\` with \`{"token": "<your agent_token>", "step": "${stepName(stageNumber, stepNumber)}", "why": "<why this work item doesn't need it>"}\`.`]
      : []),
    ...(inputs.length ? ['', '**Work item inputs set at this step** (work can\'t go on without them):', ...inputs.map(inputLine)] : []),
    ...(workflow.experiments.length
      ? ['', '**Running experiments:**', ...workflow.experiments.map((experiment) => `- #${experiment.id} ${experiment.change}: ${experiment.hypothesis || experiment.purpose}`)]
      : []),
    '',
    step.gate === 'owner' ? 'When the work is done, hand in the gate with `work_gate`:' : 'When the work is done, hand in the gate with `work_gate`, one self check per rule:',
    '```json',
    JSON.stringify(gateArgs, null, 2),
    '```',
  ].join('\n')
}

/** Where a work item moved to, as the tools tell it. */
export interface Move {
  next: Position
  done: boolean
  session_done?: boolean
  skipped_by_condition?: { step: string; why: string }[]
  waiting_for_inputs?: string[]
}

/** The steps skipped on the way, and what comes next for this session: the next step, or a stop where the session's stages end. */
export function renderMove(workflow: WorkflowDocument, move: Move) {
  const skipped = (move.skipped_by_condition ?? []).map((skip) => `- Skipped step ${skip.step}: ${skip.why}`)
  const next = renderNextInSession(workflow, move)
  return skipped.length ? ['**Skipped, as the workflow says for this work item:**', ...skipped, '', next].join('\n') : next
}

function renderNextInSession(workflow: WorkflowDocument, { next, done, session_done: sessionDone, waiting_for_inputs: waitingFor }: Move) {
  if (sessionDone && !done && next.stage !== null) {
    const stage = workflow.stages.find((candidate) => candidate.n === next.stage)
    return [
      "**This session's stages are done.**",
      `The work item is at step ${next.stage}.${next.step}, in stage ${next.stage} "${stage?.name ?? ''}", which this session doesn't work on. Stop here, and tell Owner where the work item is and what comes next.`,
      'A later session takes it up with `work_resume` (the issue, and the stages that session works on).',
    ].join('\n')
  }
  if (waitingFor?.length && next.stage !== null) {
    return [
      `**Step ${next.stage}.${next.step} waits for input ${waitingFor.join(', ')}**, which decides whether it applies. Work can't go on until it is set: work_status shows who sets it, and Owner's questions to ask.`,
      '',
      renderNext(workflow, next, done),
    ].join('\n')
  }
  return renderNext(workflow, next, done)
}

export function renderNext(workflow: WorkflowDocument, next: Position, done: boolean) {
  if (done || next.stage === null || next.step === null) {
    return 'Every work gate has passed. Deliver with `work_deliver` (pr, summary, and any artifacts such as screenshots).'
  }
  return renderStep(workflow, next.stage, next.step)
}

export function renderStarted(args: { workItemId: string; agentToken: string; issue: string; workflow: WorkflowDocument; move: Move; sessionStages?: string }) {
  const lines = [
    `# Work item ${args.workItemId} started: ${args.issue}`,
    '',
    `work_item_id: ${args.workItemId}`,
    `agent_token: ${args.agentToken}`,
    '',
    'Keep the token to yourself, and pass it to every work tool. Report as you go with `work_report`.',
    `Workflow version ${args.workflow.version}.${args.sessionStages ? ` This session works on ${args.sessionStages}, and stops when the last of them is done.` : ''}`,
    '',
  ]
  if (args.workflow.stages.length === 0) {
    lines.push('The workflow has no work stages yet: do your best, and Owner will step in where needed. Deliver with `work_deliver` when the work is done.')
  } else {
    lines.push(renderMove(args.workflow, args.move))
  }
  return lines.join('\n')
}

export interface InputChange extends Move {
  input: string
  value: string
  goes_back_to?: string
}

export function renderInputChanged(workflow: WorkflowDocument, change: InputChange) {
  return [
    `**Input ${change.input} is ${change.value} now.**${change.goes_back_to ? ` Step ${change.goes_back_to} applies to the work item now, so it goes back there; the steps before it that were done stay done.` : ''}`,
    '',
    renderMove(workflow, change),
  ].join('\n')
}

export function renderResumed(args: {
  workItemId: string
  agentToken: string
  issue: string
  workflow: WorkflowDocument
  item: WorkItemState
  sessionStages: string
  outsideSession: boolean
  update?: UpdateSummary
  move: Move
}) {
  const { item } = args
  const where = item.pending_gate
    ? `The ${item.pending_gate.gate} gate of step ${item.pending_gate.stage}.${item.pending_gate.step} is pending. Check work_status for its verdict.`
    : item.pending_skip
      ? `The skip of step ${item.pending_skip.stage}.${item.pending_skip.step} waits for a decision. Check work_status.`
      : item.status === 'delivered'
        ? 'The work item is delivered. Only your workflow post mortem remains (work_post_mortem).'
        : args.outsideSession && item.stage !== null
          ? `The work item is at step ${item.stage}.${item.step}, which is not in the stages this session works on. Tell Owner, and don't go on.`
          : renderMove(args.workflow, args.move)
  return [
    `# Work item ${args.workItemId} resumed: ${args.issue}`,
    '',
    `work_item_id: ${args.workItemId}`,
    `agent_token: ${args.agentToken}`,
    '',
    'This token replaces the earlier one, which no longer works. Keep it to yourself, and pass it to every work tool.',
    `Workflow version ${args.workflow.version}. This session works on ${args.sessionStages}, and stops when the last of them is done.`,
    ...(args.update ? ['', renderUpdate(args.update)] : []),
    '',
    where,
  ].join('\n')
}

export interface GateOutcome extends Partial<Move> {
  update?: UpdateSummary
  verdict: 'accepted' | 'rejected' | 'pending' | 'superseded'
  by?: string
  rule?: string | null
  why?: string
  stage?: number
  step?: number
  note?: string
}

export function renderGateOutcome(workflow: WorkflowDocument, outcome: GateOutcome) {
  const at = outcome.stage !== undefined ? ` (work step ${outcome.stage}.${outcome.step})` : ''
  switch (outcome.verdict) {
    case 'accepted':
      return [
        `**Gate accepted** by ${outcome.by}${at}. ${outcome.why ?? ''}`.trim(),
        ...(outcome.update ? ['', renderUpdate(outcome.update)] : []),
        '',
        renderMove(workflow, { ...outcome, next: outcome.next!, done: outcome.done ?? false }),
      ].join('\n')
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
    JSON.stringify(
      {
        token: '<your agent_token>',
        keep: [{ refs: ['step 1.1'], text: '<what in the workflow helped>' }],
        change: [{ refs: ['rule pr 1.1'], text: '<what got in the way, and how to change it>' }],
        experiment_reflections: [{ experiment: 1, text: '<how this running experiment did>' }],
      },
      null,
      2,
    ),
    `In each keep and change entry, ${FEEDBACK_REFS_HELP} Leave experiment_reflections empty when no experiment runs.`,
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

export interface UpdateSummary {
  from_version: string
  to_version: string
  kept: string[]
  changes: string[]
}

export function renderUpdate(update: UpdateSummary) {
  return [
    `**The work item updated from workflow ${update.from_version} to ${update.to_version}** before this step, as the step allows.`,
    `Kept as done, unchanged: ${update.kept.length ? `step ${update.kept.join(', ')}` : 'no step'}. It resumes at the first step that changed or is still to do.`,
    '',
    'What changed:',
    ...update.changes,
  ].join('\n')
}

export interface SkipOutcome extends Partial<Move> {
  skip: 'accepted' | 'rejected' | 'pending'
  by?: string
  decided_by?: string
  why?: string
  stage: number
  step: number
  update?: UpdateSummary
  note?: string
}

export function renderSkipOutcome(workflow: WorkflowDocument, outcome: SkipOutcome) {
  const at = `step ${outcome.stage}.${outcome.step}`
  switch (outcome.skip) {
    case 'accepted':
      return [
        `**Skipped** ${at} (${outcome.by}): ${outcome.why}`,
        ...(outcome.update ? ['', renderUpdate(outcome.update)] : []),
        '',
        renderMove(workflow, { ...outcome, next: outcome.next!, done: outcome.done ?? false }),
      ].join('\n')
    case 'rejected':
      return [`**Skip rejected** by ${outcome.by}: ${outcome.why}`, '', 'Do the step.', '', renderNext(workflow, outcome.next!, false)].join('\n')
    default:
      return `**Skip of ${at} pending.** ${outcome.note ?? ''}`.trim()
  }
}
