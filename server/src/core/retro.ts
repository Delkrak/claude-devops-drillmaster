import { z } from 'zod'
import type { DrillmasterEvent, Proposal, RetrospectiveRan } from './events.js'
import { judgeExperiments } from './experiments.js'
import { averageMeasure, measureBaseline, measureBaselineSd, MEASURE_NAMES, measureDeliveredItems, type ItemMeasures, type MeasureName } from './measures.js'
import { extractFirstJsonObject, InvalidAnswer } from './review.js'
import type { ProjectState, WorkItemState } from './state.js'
import { bumpVersion, GateKind, MetricCategory, MetricTaker, PolicyRule, WorkflowDocument, WorkflowMetric, type VersionLevel } from './workflow.js'

export const RETRO_REVIEW_KIND = 'retrospective'
export const POST_MORTEM_REVIEW_KIND = 'post_mortem'
export const MAX_PROPOSALS = 4
const DEFAULT_JUDGE_AFTER = 3
const MAX_EVENTS_IN_POST_MORTEM_PROMPT = 200
const MAX_ANSWER_IN_ERROR = 300

const StepInput = z
  .object({ name: z.string().min(1), instruction: z.string().min(1), gate: GateKind, rules: z.array(z.string()), report: z.array(z.string()) })
  .strict()

const stagePosition = { stage: z.number().int().positive() }
const stepPosition = { stage: z.number().int().positive(), step: z.number().int().positive() }

export const WorkflowOp = z.discriminatedUnion('op', [
  z
    .object({ op: z.literal('add_stage'), name: z.string().min(1), purpose: z.string().min(1), after: z.number().int().nonnegative().optional(), steps: z.array(StepInput).min(1) })
    .strict(),
  z.object({ op: z.literal('change_stage'), ...stagePosition, name: z.string().min(1).optional(), purpose: z.string().min(1).optional() }).strict(),
  z.object({ op: z.literal('remove_stage'), ...stagePosition }).strict(),
  z.object({ op: z.literal('add_step'), ...stagePosition, after: z.number().int().nonnegative().optional(), step: StepInput }).strict(),
  z
    .object({
      op: z.literal('change_step'),
      ...stepPosition,
      name: z.string().min(1).optional(),
      instruction: z.string().min(1).optional(),
      gate: GateKind.optional(),
      rules: z.array(z.string()).optional(),
      report: z.array(z.string()).optional(),
    })
    .strict(),
  z.object({ op: z.literal('remove_step'), ...stepPosition }).strict(),
  z.object({ op: z.literal('add_policy'), name: z.string().regex(/^\S+$/), rules: z.array(PolicyRule) }).strict(),
  z.object({ op: z.literal('add_rule'), policy: z.string().min(1), rule: PolicyRule }).strict(),
  z.object({ op: z.literal('change_rule'), ref: z.string().min(1), rule: z.string().min(1).optional(), verified_by: z.string().min(1).optional() }).strict(),
  z.object({ op: z.literal('remove_rule'), ref: z.string().min(1) }).strict(),
  z.object({ op: z.literal('add_metric'), metric: WorkflowMetric }).strict(),
  z
    .object({
      op: z.literal('change_metric'),
      name: z.string().min(1),
      categories: z.array(MetricCategory).min(2).optional(),
      at: z.object(stepPosition).optional(),
      by: MetricTaker.optional(),
      instruction: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ op: z.literal('remove_metric'), name: z.string().min(1) }).strict(),
  z.object({ op: z.literal('set_objective'), text: z.string().min(1).optional(), measures: z.array(z.enum(MEASURE_NAMES)).min(1).optional() }).strict(),
  z.object({ op: z.literal('end_experiment'), id: z.number().int().positive(), outcome: z.enum(['kept', 'rethought']) }).strict(),
])
export type WorkflowOp = z.infer<typeof WorkflowOp>

export class InvalidChange extends Error {}

const LEVEL_RANK: Record<VersionLevel, number> = { patch: 0, minor: 1, major: 2 }

/** Major: the path or its checks change. Minor: what Agent is told changes. Patch: nothing Agent does. */
export function levelOfOp(op: WorkflowOp): VersionLevel {
  switch (op.op) {
    case 'add_stage':
    case 'remove_stage':
    case 'add_step':
    case 'remove_step':
      return 'major'
    case 'change_step':
      return op.gate !== undefined || op.rules !== undefined ? 'major' : 'minor'
    case 'end_experiment':
      return 'patch'
    default:
      return 'minor'
  }
}

export const opensWorkflowExperiment = (ops: readonly WorkflowOp[]) => ops.some((op) => op.op !== 'end_experiment')

export function levelOfOps(ops: readonly WorkflowOp[]): VersionLevel {
  const highest = ops.map(levelOfOp).reduce<VersionLevel>((level, opLevel) => (LEVEL_RANK[opLevel] > LEVEL_RANK[level] ? opLevel : level), 'patch')
  return opensWorkflowExperiment(ops) && highest === 'patch' ? 'minor' : highest
}

const renumberStagesAndSteps = (workflow: WorkflowDocument): WorkflowDocument => ({
  ...workflow,
  stages: workflow.stages.map((stage, stageIndex) => ({ ...stage, n: stageIndex + 1, steps: stage.steps.map((step, stepIndex) => ({ ...step, n: stepIndex + 1 })) })),
})

function requireStage(workflow: WorkflowDocument, stageNumber: number) {
  const stage = workflow.stages.find((candidate) => candidate.n === stageNumber)
  if (!stage) throw new InvalidChange(`There is no work stage ${stageNumber}.`)
  return stage
}

function requireRule(workflow: WorkflowDocument, ruleRef: string) {
  const [policyName, ruleId] = ruleRef.split(' ')
  const policy = workflow.policies.find((candidate) => candidate.name === policyName)
  const ruleIndex = policy?.rules.findIndex((candidate) => candidate.id === ruleId) ?? -1
  if (!policy || ruleIndex < 0) throw new InvalidChange(`There is no rule "${ruleRef}".`)
  return { policy, ruleIndex }
}

function requireMetric(workflow: WorkflowDocument, metricName: string) {
  const metric = workflow.metrics.find((candidate) => candidate.name === metricName)
  if (!metric) throw new InvalidChange(`There is no metric "${metricName}".`)
  return metric
}

const withoutUndefined = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))

export function applyWorkflowOps(current: WorkflowDocument, ops: readonly WorkflowOp[]): WorkflowDocument {
  let workflow: WorkflowDocument = structuredClone(current)
  for (const op of ops) {
    switch (op.op) {
      case 'add_stage': {
        const insertAt = op.after ?? workflow.stages.length
        workflow.stages.splice(insertAt, 0, { n: 0, name: op.name, purpose: op.purpose, steps: op.steps.map((step) => ({ n: 0, ...step })) })
        break
      }
      case 'change_stage': {
        const { op: _op, stage: _stage, ...stageChanges } = op
        Object.assign(requireStage(workflow, op.stage), withoutUndefined(stageChanges))
        break
      }
      case 'remove_stage':
        requireStage(workflow, op.stage)
        workflow.stages = workflow.stages.filter((stage) => stage.n !== op.stage)
        break
      case 'add_step': {
        const stage = requireStage(workflow, op.stage)
        stage.steps.splice(op.after ?? stage.steps.length, 0, { n: 0, ...op.step })
        break
      }
      case 'change_step': {
        const step = requireStage(workflow, op.stage).steps.find((candidate) => candidate.n === op.step)
        if (!step) throw new InvalidChange(`There is no work step ${op.stage}.${op.step}.`)
        const { op: _op, stage: _stage, step: _step, ...stepChanges } = op
        Object.assign(step, withoutUndefined(stepChanges))
        break
      }
      case 'remove_step': {
        const stage = requireStage(workflow, op.stage)
        if (!stage.steps.some((step) => step.n === op.step)) throw new InvalidChange(`There is no work step ${op.stage}.${op.step}.`)
        stage.steps = stage.steps.filter((step) => step.n !== op.step)
        break
      }
      case 'add_policy':
        if (workflow.policies.some((policy) => policy.name === op.name)) throw new InvalidChange(`Work policy "${op.name}" already exists; add rules to it.`)
        workflow.policies.push({ name: op.name, rules: op.rules })
        break
      case 'add_rule': {
        const policy = workflow.policies.find((candidate) => candidate.name === op.policy)
        if (!policy) throw new InvalidChange(`There is no work policy "${op.policy}".`)
        if (policy.rules.some((rule) => rule.id === op.rule.id)) throw new InvalidChange(`Rule "${op.policy} ${op.rule.id}" already exists.`)
        policy.rules.push(op.rule)
        break
      }
      case 'change_rule': {
        const { policy, ruleIndex } = requireRule(workflow, op.ref)
        const rule = policy.rules[ruleIndex]!
        policy.rules[ruleIndex] = { ...rule, ...(op.rule ? { rule: op.rule } : {}), ...(op.verified_by ? { verified_by: op.verified_by } : {}) }
        break
      }
      case 'remove_rule': {
        const { policy, ruleIndex } = requireRule(workflow, op.ref)
        policy.rules.splice(ruleIndex, 1)
        break
      }
      case 'add_metric':
        if (workflow.metrics.some((metric) => metric.name === op.metric.name)) throw new InvalidChange(`Metric "${op.metric.name}" already exists; change it instead.`)
        workflow.metrics.push(op.metric)
        break
      case 'change_metric': {
        const { op: _op, name: _name, ...metricChanges } = op
        Object.assign(requireMetric(workflow, op.name), withoutUndefined(metricChanges))
        break
      }
      case 'remove_metric':
        requireMetric(workflow, op.name)
        workflow.metrics = workflow.metrics.filter((metric) => metric.name !== op.name)
        break
      case 'set_objective':
        workflow.objective = { text: op.text ?? workflow.objective.text, measures: op.measures ?? workflow.objective.measures }
        break
      case 'end_experiment':
        if (!workflow.experiments.some((experiment) => experiment.id === op.id)) throw new InvalidChange(`There is no running workflow experiment ${op.id}.`)
        workflow.experiments = workflow.experiments.filter((experiment) => experiment.id !== op.id)
        break
    }
    workflow = renumberStagesAndSteps(workflow)
  }
  const parsed = WorkflowDocument.safeParse({ ...workflow, version: bumpVersion(current.version, levelOfOps(ops)) })
  if (!parsed.success) throw new InvalidChange(`The changed workflow is invalid: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

export function applyProposal(current: WorkflowDocument, proposal: Proposal, deliveredItems: readonly ItemMeasures[], today: string) {
  const ops = z.array(WorkflowOp).parse(proposal.ops)
  const next = applyWorkflowOps(current, ops)
  if (opensWorkflowExperiment(ops)) {
    const measure: MeasureName = (MEASURE_NAMES as readonly string[]).includes(proposal.measure)
      ? (proposal.measure as MeasureName)
      : (current.objective.measures[0] ?? 'owner_corrections_per_item')
    const experimentId = Math.max(0, ...current.experiments.map((experiment) => experiment.id), ...next.experiments.map((experiment) => experiment.id)) + 1
    next.experiments.push({
      id: experimentId,
      change: proposal.change,
      purpose: proposal.purpose,
      hypothesis: proposal.hypothesis ?? proposal.purpose,
      null_hypothesis: proposal.null_hypothesis ?? noDifference(proposal.change, measure),
      measure,
      baseline: measureBaseline(deliveredItems, measure),
      baseline_sd: measureBaselineSd(deliveredItems, measure),
      target: proposal.target ?? null,
      judge_after: proposal.judge_after ?? DEFAULT_JUDGE_AFTER,
      version: next.version,
      started: today,
    })
  }
  return { workflow: WorkflowDocument.parse(next), level: levelOfOps(ops) }
}

const noDifference = (change: string, measure: string) => `"${change}" makes no difference to ${measure}.`

const WORKFLOW_OP_REFERENCE = `Operations (stages and steps are renumbered after each operation; refer to numbers as they are after the previous operation):
{"op":"add_stage","name":"build","purpose":"<what the stage achieves>","after":0,"steps":[{"name":"write the tests first","instruction":"<the work to do in this step, as an order to Agent>","gate":"self","rules":["test 1.1"],"report":["test result"]}]}   (after: insert after this stage number; omit to append)
{"op":"change_stage","stage":1,"purpose":"..."}   (any of name, purpose)
{"op":"remove_stage","stage":2}
{"op":"add_step","stage":1,"after":1,"step":{"name":"...","instruction":"...","gate":"self|drillmaster|owner","rules":["<policy> <rule id>"],"report":["..."]}}
{"op":"change_step","stage":1,"step":2,"gate":"drillmaster"}   (any of name, instruction, gate, rules, report)
{"op":"remove_step","stage":1,"step":2}
{"op":"add_policy","name":"pr","rules":[{"id":"1.1","rule":"the PR says what it changes","verified_by":"reading the PR description"}]}
{"op":"add_rule","policy":"pr","rule":{"id":"1.2","rule":"...","verified_by":"..."}}
{"op":"change_rule","ref":"pr 1.1","rule":"...","verified_by":"..."}
{"op":"remove_rule","ref":"pr 1.1"}
{"op":"add_metric","metric":{"name":"size","categories":[{"value":"small","description":"one file, under an hour"},{"value":"large","description":"several files or over an hour"}],"at":{"stage":1,"step":1},"by":"agent|drillmaster|owner","instruction":"<how to choose the category>"}}
{"op":"change_metric","name":"size","instruction":"..."}   (any of categories, at, by, instruction)
{"op":"remove_metric","name":"size"}
{"op":"set_objective","text":"...","measures":["owner_corrections_per_item"]}
{"op":"end_experiment","id":1,"outcome":"kept|rethought"}`

export function deliveredSinceLastRetro(state: ProjectState, events: readonly DrillmasterEvent[]) {
  const lastRetroAt = state.latestRetroId ? state.retros[state.latestRetroId]!.at : ''
  return measureDeliveredItems(events).filter((item) => item.delivered_at > lastRetroAt)
}

export function buildRetroPrompt(state: ProjectState, events: readonly DrillmasterEvent[]) {
  const workflow = state.workflow!
  const allDelivered = measureDeliveredItems(events)
  const recentDelivered = deliveredSinceLastRetro(state, events)
  const recentItemIds = new Set(recentDelivered.map((item) => item.work_item_id))
  const recentItemEvents = events.filter((event) => 'work_item_id' in event && event.work_item_id && recentItemIds.has(event.work_item_id))
  const ownerWordLines = recentItemEvents
    .filter((event): event is Extract<DrillmasterEvent, { type: 'work_trace' }> => event.type === 'work_trace' && event.hook === 'UserPromptSubmit')
    .map((trace) => `- ${trace.work_item_id}: "${trace.prompt}"`)
  const reportLines = recentItemEvents
    .filter((event) => ['work_reported', 'gate_verdict', 'review_failed', 'post_mortem_written'].includes(event.type))
    .map((event) => `- ${JSON.stringify(event)}`)
  const measureLines = workflow.objective.measures.map(
    (measure) =>
      `- ${measure}: last ${recentDelivered.length} items ${averageMeasure(recentDelivered, measure) ?? 'n/a'}; all ${allDelivered.length} items ${averageMeasure(allDelivered, measure) ?? 'n/a'}`,
  )
  const experimentLines = judgeExperiments(workflow, allDelivered).map((verdict) => {
    const experiment = workflow.experiments.find((candidate) => candidate.id === verdict.id)!
    return [
      `- experiment ${experiment.id} "${experiment.change}" (purpose: ${experiment.purpose}; hypothesis: ${experiment.hypothesis || 'none'}; null hypothesis: ${experiment.null_hypothesis || 'none'})`,
      `  measure ${experiment.measure}: baseline ${experiment.baseline} (sd ${experiment.baseline_sd}), target ${experiment.target ?? 'none'}, judged after ${experiment.judge_after} items; ${verdict.counted} counted so far, mean ${verdict.mean ?? 'n/a'}`,
      `  server's verdict: ${verdict.status === 'running' ? 'still running' : `${verdict.status} (null hypothesis ${verdict.null_rejected ? 'rejected' : 'not rejected'}, target ${verdict.target_met ? 'met' : 'not met'})`}${verdict.overlapping.length ? `; runs alongside experiment ${verdict.overlapping.join(', ')} on the same measure, so the effects mix` : ''}`,
    ].join('\n')
  })

  return [
    'You are Drillmaster, carrying out a workflow retrospective that Owner called for. The workflow retrospective is the only place the workflow changes.',
    'Answer: what should have happened, what happened, why, what to keep and what to improve. Base it on the workflow post mortems, the work reports, the verdicts and the corrections Owner gave.',
    'Every impediment is rust: propose deliberate workflow changes that remove impediments or deliver better ways. Each proposal is one change on trial, with a purpose, a hypothesis, a null hypothesis, a target on its measure, and how many delivered items to judge it after.',
    'Work stages hold the work. Propose the work Agent must do (a step with an instruction), not only checks on it. Every stage has a purpose, and every step an instruction written as an order to Agent. If a stage or step has no purpose or instruction yet, fill it in.',
    "Judge every running workflow experiment with the server's verdict below: end it 'kept' when the verdict is keep, and 'rethought' (plus any replacement change) when it is rethink. Leave running ones alone.",
    `Propose at most ${MAX_PROPOSALS} changes: few, small and high-value, so each can be measured. A rule must say how it is verified. A work gate references specific rules. Metrics are categories taken at a work step (for example the size of a work item), so measures can be split by them.`,
    '',
    `Current workflow (version ${workflow.version}):`,
    JSON.stringify(workflow, null, 2),
    '',
    `Measures (Owner's objective: "${workflow.objective.text}"):`,
    ...measureLines,
    '',
    'Running workflow experiments:',
    ...(experimentLines.length ? experimentLines : ['- none']),
    '',
    `Delivered work items since the last retrospective: ${recentDelivered.map((item) => `${item.work_item_id} (${item.issue})`).join(', ') || 'none'}`,
    '',
    "Owner's words during those work items (corrections, instructions, approvals):",
    ...(ownerWordLines.length ? ownerWordLines : ['- none']),
    '',
    'Work reports, verdicts and post mortems:',
    ...(reportLines.length ? reportLines : ['- none']),
    '',
    WORKFLOW_OP_REFERENCE,
    "Proposals are applied in order: each proposal's operations see the workflow as the proposals before it leave it. Prefer proposals that stand on their own, so Owner can approve any of them.",
    '',
    'Answer with JSON only:',
    '{"findings":{"should":"...","did":"...","why":"...","keep":"...","improve":"..."},"proposals":[{"id":1,"change":"<one line>","purpose":"<the impediment it removes or the better way it delivers>","measure":"<one of the objective measures>","hypothesis":"<what will improve, and why>","null_hypothesis":"<the change makes no difference to the measure>","target":<the measure value that counts as success, lower is better>,"judge_after":<delivered items to judge it after, e.g. 3>,"ops":[...]}]}',
  ].join('\n')
}

const Findings = z.object({ should: z.string(), did: z.string(), why: z.string(), keep: z.string(), improve: z.string() })

export function readRetroAnswer(workflow: WorkflowDocument, answer: unknown) {
  const retroAnswer = (typeof answer === 'string' ? extractFirstJsonObject(answer) : answer) as { findings?: unknown; proposals?: unknown } | undefined
  const findings = Findings.safeParse(retroAnswer?.findings)
  if (!findings.success) throw new InvalidAnswer(`The retrospective has no findings: ${JSON.stringify(answer).slice(0, MAX_ANSWER_IN_ERROR)}`)
  const proposals: Proposal[] = []
  const dropped: { change: string; error: string }[] = []
  let workflowAfterEarlierProposals = workflow
  const rawProposals = Array.isArray(retroAnswer!.proposals) ? retroAnswer!.proposals : []
  for (const [proposalIndex, rawProposal] of rawProposals.entries()) {
    const candidate = rawProposal as Partial<Proposal>
    const change = typeof candidate.change === 'string' ? candidate.change : `proposal ${proposalIndex + 1}`
    if (proposals.length >= MAX_PROPOSALS) {
      dropped.push({ change, error: `A retrospective makes at most ${MAX_PROPOSALS} proposals.` })
      continue
    }
    try {
      const ops = z.array(WorkflowOp).min(1).parse(candidate.ops)
      let dependsOn: number[] | undefined
      try {
        applyWorkflowOps(workflow, ops)
      } catch {
        dependsOn = proposals.map((earlier) => earlier.id)
      }
      workflowAfterEarlierProposals = { ...applyWorkflowOps(workflowAfterEarlierProposals, ops), version: workflowAfterEarlierProposals.version }
      proposals.push({
        id: proposals.length + 1,
        change,
        purpose: typeof candidate.purpose === 'string' ? candidate.purpose : '',
        measure: typeof candidate.measure === 'string' ? candidate.measure : workflow.objective.measures[0]!,
        ...(typeof candidate.hypothesis === 'string' ? { hypothesis: candidate.hypothesis } : {}),
        ...(typeof candidate.null_hypothesis === 'string' ? { null_hypothesis: candidate.null_hypothesis } : {}),
        ...(typeof candidate.target === 'number' ? { target: candidate.target } : {}),
        ...(Number.isInteger(candidate.judge_after) && candidate.judge_after! > 0 ? { judge_after: candidate.judge_after } : {}),
        ops,
        ...(dependsOn?.length ? { depends_on: dependsOn } : {}),
      })
    } catch (error) {
      dropped.push({ change, error: error instanceof z.ZodError ? z.prettifyError(error) : String((error as Error).message) })
    }
  }
  return { findings: findings.data, proposals, dropped }
}

export function buildPostMortemPrompt(item: WorkItemState, events: readonly DrillmasterEvent[]) {
  const itemEvents = events.filter((event) => 'work_item_id' in event && event.work_item_id === item.work_item_id)
  const eventLines = itemEvents.map((event) =>
    event.type === 'work_trace'
      ? `- ${event.hook}${event.tool ? ` ${event.tool}` : ''}${event.input ? ` ${event.input}` : ''}${event.prompt ? ` Owner: "${event.prompt}"` : ''}`
      : `- ${JSON.stringify(event)}`,
  )
  return [
    `You are Drillmaster. Work item ${item.work_item_id} (${item.issue}) is delivered. Write your workflow post mortem on the work item as a whole: it is about the workflow, not the code.`,
    'Look at what Agent did (the work traces), what it reported, the verdicts, and what Owner had to say or correct.',
    '',
    'Everything recorded for the work item, oldest first:',
    ...eventLines.slice(-MAX_EVENTS_IN_POST_MORTEM_PROMPT),
    '',
    'Answer with JSON only:',
    '{"keep":"what in the workflow helped","change":"what got in the way, and how to change it","experiment_reflections":"how the running workflow experiments did, or none","free_text":"anything else"}',
  ].join('\n')
}

const PostMortem = z.object({ keep: z.string(), change: z.string(), experiment_reflections: z.string(), free_text: z.string() })

export function readPostMortemAnswer(answer: unknown) {
  const parsed = PostMortem.safeParse(typeof answer === 'string' ? extractFirstJsonObject(answer) : answer)
  if (!parsed.success) throw new InvalidAnswer(`Drillmaster's post mortem is unreadable: ${JSON.stringify(answer).slice(0, MAX_ANSWER_IN_ERROR)}`)
  return parsed.data
}

export const toRetroView = (event: RetrospectiveRan, dropped: { change: string; error: string }[] = []) => ({
  retro_id: event.retro_id,
  work_items: event.work_items,
  findings: event.findings,
  proposals: event.proposals.map((proposal) => ({ ...proposal, level: levelOfOps(z.array(WorkflowOp).parse(proposal.ops)) })),
  dropped,
})
