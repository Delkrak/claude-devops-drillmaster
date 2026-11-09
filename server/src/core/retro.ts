import { z } from 'zod'
import type { DrillmasterEvent, Proposal, RetrospectiveRan } from './events.js'
import { averageMeasure, measureBaseline, MEASURE_NAMES, measureDeliveredItems, type ItemMeasures, type MeasureName } from './measures.js'
import { extractFirstJsonObject, InvalidAnswer } from './review.js'
import type { ProjectState, WorkItemState } from './state.js'
import { GateKind, PolicyRule, WorkflowDocument } from './workflow.js'

export const RETRO_REVIEW_KIND = 'retrospective'
export const POST_MORTEM_REVIEW_KIND = 'post_mortem'
const MAX_EVENTS_IN_POST_MORTEM_PROMPT = 200
const MAX_ANSWER_IN_ERROR = 300

const StepInput = z.object({ name: z.string().min(1), gate: GateKind, rules: z.array(z.string()), report: z.array(z.string()) }).strict()

export const WorkflowOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_stage'), name: z.string().min(1), after: z.number().int().nonnegative().optional(), steps: z.array(StepInput).min(1) }).strict(),
  z.object({ op: z.literal('remove_stage'), stage: z.number().int().positive() }).strict(),
  z.object({ op: z.literal('add_step'), stage: z.number().int().positive(), after: z.number().int().nonnegative().optional(), step: StepInput }).strict(),
  z
    .object({
      op: z.literal('change_step'),
      stage: z.number().int().positive(),
      step: z.number().int().positive(),
      name: z.string().min(1).optional(),
      gate: GateKind.optional(),
      rules: z.array(z.string()).optional(),
      report: z.array(z.string()).optional(),
    })
    .strict(),
  z.object({ op: z.literal('remove_step'), stage: z.number().int().positive(), step: z.number().int().positive() }).strict(),
  z.object({ op: z.literal('add_policy'), name: z.string().regex(/^\S+$/), rules: z.array(PolicyRule) }).strict(),
  z.object({ op: z.literal('add_rule'), policy: z.string().min(1), rule: PolicyRule }).strict(),
  z.object({ op: z.literal('change_rule'), ref: z.string().min(1), rule: z.string().min(1).optional(), verified_by: z.string().min(1).optional() }).strict(),
  z.object({ op: z.literal('remove_rule'), ref: z.string().min(1) }).strict(),
  z.object({ op: z.literal('set_objective'), text: z.string().min(1).optional(), measures: z.array(z.enum(MEASURE_NAMES)).min(1).optional() }).strict(),
  z.object({ op: z.literal('end_experiment'), id: z.number().int().positive(), outcome: z.enum(['kept', 'rethought']) }).strict(),
])
export type WorkflowOp = z.infer<typeof WorkflowOp>

export class InvalidChange extends Error {}

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

export function applyWorkflowOps(current: WorkflowDocument, ops: readonly WorkflowOp[]): WorkflowDocument {
  let workflow: WorkflowDocument = structuredClone(current)
  for (const op of ops) {
    switch (op.op) {
      case 'add_stage': {
        const insertAt = op.after ?? workflow.stages.length
        workflow.stages.splice(insertAt, 0, { n: 0, name: op.name, steps: op.steps.map((step) => ({ n: 0, ...step })) })
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
        Object.assign(step, Object.fromEntries(Object.entries(stepChanges).filter(([, value]) => value !== undefined)))
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
  const parsed = WorkflowDocument.safeParse({ ...workflow, version: current.version + 1 })
  if (!parsed.success) throw new InvalidChange(`The changed workflow is invalid: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

export const opensWorkflowExperiment = (ops: readonly WorkflowOp[]) => ops.some((op) => op.op !== 'end_experiment')

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
      measure,
      baseline: measureBaseline(deliveredItems, measure),
      started: today,
    })
  }
  return WorkflowDocument.parse(next)
}

const WORKFLOW_OP_REFERENCE = `Operations (stages and steps are renumbered after each operation; refer to numbers as they are after the previous operation):
{"op":"add_stage","name":"build","after":0,"steps":[{"name":"run the tests","gate":"self","rules":["test 1.1"],"report":["test result"]}]}   (after: insert after this stage number; omit to append)
{"op":"remove_stage","stage":2}
{"op":"add_step","stage":1,"after":1,"step":{"name":"...","gate":"self|drillmaster|owner","rules":["<policy> <rule id>"],"report":["..."]}}
{"op":"change_step","stage":1,"step":2,"gate":"drillmaster"}   (any of name, gate, rules, report)
{"op":"remove_step","stage":1,"step":2}
{"op":"add_policy","name":"pr","rules":[{"id":"1.1","rule":"the PR says what it changes","verified_by":"reading the PR description"}]}
{"op":"add_rule","policy":"pr","rule":{"id":"1.2","rule":"...","verified_by":"..."}}
{"op":"change_rule","ref":"pr 1.1","rule":"...","verified_by":"..."}
{"op":"remove_rule","ref":"pr 1.1"}
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
  const experimentLines = workflow.experiments.map((experiment) => {
    const deliveredSinceStart = allDelivered.filter((item) => item.delivered_at.slice(0, 10) >= experiment.started)
    return `- experiment ${experiment.id} "${experiment.change}" (purpose: ${experiment.purpose}); measure ${experiment.measure} baseline ${experiment.baseline}, since it started ${averageMeasure(deliveredSinceStart, experiment.measure) ?? 'n/a'} over ${deliveredSinceStart.length} items`
  })

  return [
    'You are Drillmaster, carrying out a workflow retrospective that Owner called for. The workflow retrospective is the only place the workflow changes.',
    'Answer: what should have happened, what happened, why, what to keep and what to improve. Base it on the workflow post mortems, the work reports, the verdicts and the corrections Owner gave.',
    'Every impediment is rust: propose deliberate workflow changes that remove impediments or deliver better ways. Each proposal is one change on trial, with a purpose and the measure it must not worsen.',
    'Judge every running workflow experiment: keep it when it serves its purpose and the measure holds (end_experiment "kept"), otherwise rethink it ("rethought", plus any replacement change).',
    'Prefer few, small, high-value changes. A rule must say how it is verified. A work gate references specific rules.',
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
    '{"findings":{"should":"...","did":"...","why":"...","keep":"...","improve":"..."},"proposals":[{"id":1,"change":"<one line>","purpose":"<the impediment it removes or the better way it delivers>","measure":"<one of the objective measures>","ops":[...]}]}',
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
  for (const [proposalIndex, rawProposal] of (Array.isArray(retroAnswer!.proposals) ? retroAnswer!.proposals : []).entries()) {
    const candidate = rawProposal as Partial<Proposal>
    const change = typeof candidate.change === 'string' ? candidate.change : `proposal ${proposalIndex + 1}`
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
  proposals: event.proposals.map(({ id, change, purpose, measure, ops, depends_on }) => ({ id, change, purpose, measure, ops, ...(depends_on ? { depends_on } : {}) })),
  dropped,
})
