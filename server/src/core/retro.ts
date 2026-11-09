// Workflow retrospectives and post mortems. Pure: what Drillmaster is asked, how its answer is
// read, and how an approved proposal changes the workflow.

import { z } from 'zod'
import type { DrillmasterEvent, Proposal, RetrospectiveRan } from './events.js'
import { average, baseline, MEASURE_NAMES, measureItems, type ItemMeasures, type MeasureName } from './measures.js'
import { extractJson, InvalidAnswer } from './review.js'
import type { ProjectState, WorkItemState } from './state.js'
import { GateKind, PolicyRule, WorkflowDocument } from './workflow.js'

export const RETRO_REVIEW = 'retrospective'
export const POST_MORTEM_REVIEW = 'post_mortem'

// ---------------------------------------------------------------- workflow operations

const StepInput = z.object({ name: z.string().min(1), gate: GateKind, rules: z.array(z.string()), report: z.array(z.string()) }).strict()

export const Op = z.discriminatedUnion('op', [
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
export type Op = z.infer<typeof Op>

export class InvalidChange extends Error {}

const renumber = (doc: WorkflowDocument): WorkflowDocument => ({
  ...doc,
  stages: doc.stages.map((stage, i) => ({ ...stage, n: i + 1, steps: stage.steps.map((step, j) => ({ ...step, n: j + 1 })) })),
})

function stageOf(doc: WorkflowDocument, n: number) {
  const stage = doc.stages.find((s) => s.n === n)
  if (!stage) throw new InvalidChange(`There is no work stage ${n}.`)
  return stage
}

function ruleOf(doc: WorkflowDocument, ref: string) {
  const [name, id] = ref.split(' ')
  const policy = doc.policies.find((p) => p.name === name)
  const index = policy?.rules.findIndex((r) => r.id === id) ?? -1
  if (!policy || index < 0) throw new InvalidChange(`There is no rule "${ref}".`)
  return { policy, index }
}

/** Applies operations to a copy of the workflow, in order. Any invalid result is refused. */
export function applyOps(current: WorkflowDocument, ops: readonly Op[]): WorkflowDocument {
  let doc: WorkflowDocument = structuredClone(current)
  for (const op of ops) {
    switch (op.op) {
      case 'add_stage': {
        const at = op.after ?? doc.stages.length
        doc.stages.splice(at, 0, { n: 0, name: op.name, steps: op.steps.map((s) => ({ n: 0, ...s })) })
        break
      }
      case 'remove_stage':
        stageOf(doc, op.stage)
        doc.stages = doc.stages.filter((s) => s.n !== op.stage)
        break
      case 'add_step': {
        const stage = stageOf(doc, op.stage)
        stage.steps.splice(op.after ?? stage.steps.length, 0, { n: 0, ...op.step })
        break
      }
      case 'change_step': {
        const step = stageOf(doc, op.stage).steps.find((s) => s.n === op.step)
        if (!step) throw new InvalidChange(`There is no work step ${op.stage}.${op.step}.`)
        const { op: _op, stage: _stage, step: _step, ...changes } = op
        Object.assign(step, Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)))
        break
      }
      case 'remove_step': {
        const stage = stageOf(doc, op.stage)
        if (!stage.steps.some((s) => s.n === op.step)) throw new InvalidChange(`There is no work step ${op.stage}.${op.step}.`)
        stage.steps = stage.steps.filter((s) => s.n !== op.step)
        break
      }
      case 'add_policy':
        if (doc.policies.some((p) => p.name === op.name)) throw new InvalidChange(`Work policy "${op.name}" already exists; add rules to it.`)
        doc.policies.push({ name: op.name, rules: op.rules })
        break
      case 'add_rule': {
        const policy = doc.policies.find((p) => p.name === op.policy)
        if (!policy) throw new InvalidChange(`There is no work policy "${op.policy}".`)
        if (policy.rules.some((r) => r.id === op.rule.id)) throw new InvalidChange(`Rule "${op.policy} ${op.rule.id}" already exists.`)
        policy.rules.push(op.rule)
        break
      }
      case 'change_rule': {
        const { policy, index } = ruleOf(doc, op.ref)
        const rule = policy.rules[index]!
        policy.rules[index] = { ...rule, ...(op.rule ? { rule: op.rule } : {}), ...(op.verified_by ? { verified_by: op.verified_by } : {}) }
        break
      }
      case 'remove_rule': {
        const { policy, index } = ruleOf(doc, op.ref)
        policy.rules.splice(index, 1)
        break
      }
      case 'set_objective':
        doc.objective = { text: op.text ?? doc.objective.text, measures: op.measures ?? doc.objective.measures }
        break
      case 'end_experiment':
        if (!doc.experiments.some((e) => e.id === op.id)) throw new InvalidChange(`There is no running workflow experiment ${op.id}.`)
        doc.experiments = doc.experiments.filter((e) => e.id !== op.id)
        break
    }
    doc = renumber(doc)
  }
  const parsed = WorkflowDocument.safeParse({ ...doc, version: current.version + 1 })
  if (!parsed.success) throw new InvalidChange(`The changed workflow is invalid: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

/** A proposal that only judges running experiments is not itself a new experiment. */
export const opensExperiment = (ops: readonly Op[]) => ops.some((op) => op.op !== 'end_experiment')

/** The next workflow version from an approved proposal, with its experiment and baseline. */
export function applyProposal(current: WorkflowDocument, proposal: Proposal, items: readonly ItemMeasures[], today: string) {
  const ops = z.array(Op).parse(proposal.ops)
  const next = applyOps(current, ops)
  if (opensExperiment(ops)) {
    const measure: MeasureName = (MEASURE_NAMES as readonly string[]).includes(proposal.measure)
      ? (proposal.measure as MeasureName)
      : (current.objective.measures[0] ?? 'owner_corrections_per_item')
    const id = Math.max(0, ...current.experiments.map((e) => e.id), ...next.experiments.map((e) => e.id)) + 1
    next.experiments.push({ id, change: proposal.change, purpose: proposal.purpose, measure, baseline: baseline(items, measure), started: today })
  }
  return WorkflowDocument.parse(next)
}

// ---------------------------------------------------------------- the retrospective

const OP_REFERENCE = `Operations (stages and steps are renumbered after each operation; refer to numbers as they are after the previous operation):
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

/** Delivered work items since the last workflow retrospective. */
export function sinceLastRetro(state: ProjectState, events: readonly DrillmasterEvent[]) {
  const lastRetroAt = state.latestRetro ? state.retros[state.latestRetro]!.at : ''
  return measureItems(events).filter((i) => i.delivered_at > lastRetroAt)
}

export function buildRetroPrompt(state: ProjectState, events: readonly DrillmasterEvent[]) {
  const doc = state.workflow!
  const all = measureItems(events)
  const recent = sinceLastRetro(state, events)
  const ids = new Set(recent.map((i) => i.work_item_id))
  const about = events.filter((e) => 'work_item_id' in e && e.work_item_id && ids.has(e.work_item_id))
  const owner = about
    .filter((e): e is Extract<DrillmasterEvent, { type: 'work_trace' }> => e.type === 'work_trace' && e.hook === 'UserPromptSubmit')
    .map((e) => `- ${e.work_item_id}: "${e.prompt}"`)
  const reports = about.filter((e) => ['work_reported', 'gate_verdict', 'review_failed', 'post_mortem_written'].includes(e.type)).map((e) => `- ${JSON.stringify(e)}`)
  const measures = doc.objective.measures.map((m) => `- ${m}: last ${recent.length} items ${average(recent, m) ?? 'n/a'}; all ${all.length} items ${average(all, m) ?? 'n/a'}`)
  const experiments = doc.experiments.map((x) => {
    const since = all.filter((i) => i.delivered_at.slice(0, 10) >= x.started)
    return `- experiment ${x.id} "${x.change}" (purpose: ${x.purpose}); measure ${x.measure} baseline ${x.baseline}, since it started ${average(since, x.measure) ?? 'n/a'} over ${since.length} items`
  })

  return [
    "You are Drillmaster, carrying out a workflow retrospective that Owner called for. The workflow retrospective is the only place the workflow changes.",
    'Answer: what should have happened, what happened, why, what to keep and what to improve. Base it on the workflow post mortems, the work reports, the verdicts and the corrections Owner gave.',
    'Every impediment is rust: propose deliberate workflow changes that remove impediments or deliver better ways. Each proposal is one change on trial, with a purpose and the measure it must not worsen.',
    'Judge every running workflow experiment: keep it when it serves its purpose and the measure holds (end_experiment "kept"), otherwise rethink it ("rethought", plus any replacement change).',
    'Prefer few, small, high-value changes. A rule must say how it is verified. A work gate references specific rules.',
    '',
    `Current workflow (version ${doc.version}):`,
    JSON.stringify(doc, null, 2),
    '',
    `Measures (Owner's objective: "${doc.objective.text}"):`,
    ...measures,
    '',
    'Running workflow experiments:',
    ...(experiments.length ? experiments : ['- none']),
    '',
    `Delivered work items since the last retrospective: ${recent.map((i) => `${i.work_item_id} (${i.issue})`).join(', ') || 'none'}`,
    '',
    "Owner's words during those work items (corrections, instructions, approvals):",
    ...(owner.length ? owner : ['- none']),
    '',
    'Work reports, verdicts and post mortems:',
    ...(reports.length ? reports : ['- none']),
    '',
    OP_REFERENCE,
    'Proposals are applied in order: each proposal\'s operations see the workflow as the proposals before it leave it. Prefer proposals that stand on their own, so Owner can approve any of them.',
    '',
    'Answer with JSON only:',
    '{"findings":{"should":"...","did":"...","why":"...","keep":"...","improve":"..."},"proposals":[{"id":1,"change":"<one line>","purpose":"<the impediment it removes or the better way it delivers>","measure":"<one of the objective measures>","ops":[...]}]}',
  ].join('\n')
}

const Findings = z.object({ should: z.string(), did: z.string(), why: z.string(), keep: z.string(), improve: z.string() })

/** Reads the retrospective; proposals that would not apply cleanly are dropped, with the reason. */
export function readRetroAnswer(doc: WorkflowDocument, answer: unknown) {
  const a = (typeof answer === 'string' ? extractJson(answer) : answer) as { findings?: unknown; proposals?: unknown } | undefined
  const findings = Findings.safeParse(a?.findings)
  if (!findings.success) throw new InvalidAnswer(`The retrospective has no findings: ${JSON.stringify(answer).slice(0, 300)}`)
  const proposals: Proposal[] = []
  const dropped: { change: string; error: string }[] = []
  // Proposals apply in order: each sees the workflow as the proposals before it leave it.
  let cumulative = doc
  for (const [i, raw] of (Array.isArray(a!.proposals) ? a!.proposals : []).entries()) {
    const p = raw as Partial<Proposal>
    const change = typeof p.change === 'string' ? p.change : `proposal ${i + 1}`
    try {
      const ops = z.array(Op).min(1).parse(p.ops)
      let dependsOn: number[] | undefined
      try {
        applyOps(doc, ops) // Applies on its own, to the workflow as it is now.
      } catch {
        dependsOn = proposals.map((x) => x.id) // Only applies on top of the earlier proposals.
      }
      const after = applyOps(cumulative, ops)
      cumulative = { ...after, version: cumulative.version }
      proposals.push({
        id: proposals.length + 1,
        change,
        purpose: typeof p.purpose === 'string' ? p.purpose : '',
        measure: typeof p.measure === 'string' ? p.measure : doc.objective.measures[0]!,
        ops,
        ...(dependsOn?.length ? { depends_on: dependsOn } : {}),
      })
    } catch (error) {
      dropped.push({ change, error: error instanceof z.ZodError ? z.prettifyError(error) : String((error as Error).message) })
    }
  }
  return { findings: findings.data, proposals, dropped }
}

// ---------------------------------------------------------------- Drillmaster's post mortem

export function buildPostMortemPrompt(item: WorkItemState, events: readonly DrillmasterEvent[]) {
  const mine = events.filter((e) => 'work_item_id' in e && e.work_item_id === item.work_item_id)
  const lines = mine.map((e) =>
    e.type === 'work_trace'
      ? `- ${e.hook}${e.tool ? ` ${e.tool}` : ''}${e.input ? ` ${e.input}` : ''}${e.prompt ? ` Owner: "${e.prompt}"` : ''}`
      : `- ${JSON.stringify(e)}`,
  )
  return [
    `You are Drillmaster. Work item ${item.work_item_id} (${item.issue}) is delivered. Write your workflow post mortem on the work item as a whole: it is about the workflow, not the code.`,
    'Look at what Agent did (the work traces), what it reported, the verdicts, and what Owner had to say or correct.',
    '',
    'Everything recorded for the work item, oldest first:',
    ...lines.slice(-200),
    '',
    'Answer with JSON only:',
    '{"keep":"what in the workflow helped","change":"what got in the way, and how to change it","experiment_reflections":"how the running workflow experiments did, or none","free_text":"anything else"}',
  ].join('\n')
}

const PostMortem = z.object({ keep: z.string(), change: z.string(), experiment_reflections: z.string(), free_text: z.string() })

export function readPostMortemAnswer(answer: unknown) {
  const parsed = PostMortem.safeParse(typeof answer === 'string' ? extractJson(answer) : answer)
  if (!parsed.success) throw new InvalidAnswer(`Drillmaster's post mortem is unreadable: ${JSON.stringify(answer).slice(0, 300)}`)
  return parsed.data
}

/** What Owner and Agent see of a retrospective. */
export const retroView = (event: RetrospectiveRan, dropped: { change: string; error: string }[] = []) => ({
  retro_id: event.retro_id,
  work_items: event.work_items,
  findings: event.findings,
  proposals: event.proposals.map(({ id, change, purpose, measure, ops, depends_on }) => ({ id, change, purpose, measure, ops, ...(depends_on ? { depends_on } : {}) })),
  dropped,
})
