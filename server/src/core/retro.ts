import { z } from 'zod'
import type { DrillmasterEvent, MeasureJudgement, Proposal, RetroFindings, RetrospectiveRan } from './events.js'
import { eventLine, MEASURED_ANSWER_EXAMPLE, measuresToJudge, readMeasuredAnswer } from './judgedMeasures.js'
import { FEEDBACK_REFS_HELP, FeedbackInput, ReflectionInput, resolveFeedback } from './feedback.js'
import { itemsCountedFor, judgeExperiments } from './experiments.js'
import { stepUnchanged } from './updates.js'
import { averageMeasure, BASELINE_WINDOW, currentMeasureName, isCountedMeasure, itemsWithMeasure, judgedMeasuresOf, measureBaseline, measureBaselineSd, measureDeliveredItems, rejectionsByRule, type ItemMeasures } from './measures.js'
import { frictionJudgementsOf, ownerInputsOf, type OwnerInput } from './ownerInputs.js'
import { extractFirstJsonObject, InvalidAnswer } from './review.js'
import { InvalidReference, newGuid, parseRef, refOfGuid, resolveRef, stepGuidAt, stepPosition, type RefKind } from './refs.js'
import type { ProjectState, WorkItemState } from './state.js'
import type { PostMortemArgs } from './work.js'
import { AT_START, bumpVersion, GateKind, InputOption, InputSetter, isMeasureOf, JudgedMeasure, PolicyRule, ToolCapture, SkipDecider, UpdateLevel, WorkflowDocument, workflowForReading, WorkItemInput, type VersionLevel } from './workflow.js'

export const RETRO_REVIEW_KIND = 'retrospective'
export const POST_MORTEM_REVIEW_KIND = 'post_mortem'
export const MAX_PROPOSALS = 4
const DEFAULT_JUDGE_AFTER = 3
const MAX_EVENTS_IN_POST_MORTEM_PROMPT = 200
const MAX_ANSWER_IN_ERROR = 300

const StepInput = z
  .object({
    name: z.string().min(1),
    instruction: z.string().min(1),
    gate: GateKind,
    rules: z.array(z.string()),
    report: z.array(z.string()),
    skippable: SkipDecider.optional(),
    update: UpdateLevel.optional(),
    if: z.string().min(1).optional(),
  })
  .strict()
const RuleInput = PolicyRule.omit({ guid: true }).strict()
const NewInput = WorkItemInput.omit({ guid: true }).strict()
const NewToolCapture = ToolCapture.omit({ guid: true }).strict()
/** An `if` to set, or "" to remove it. */
const ChangedCondition = z.string()

const StageRef = z.union([z.string().min(1), z.number().int().nonnegative()]).transform(String)
const Ref = z.string().min(1)

/**
 * Operations written before references (positions as numbers, rules and metrics by other keys), and
 * before metrics were called work item inputs.
 */
function upgradeLegacyOp(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const op = { ...(raw as Record<string, any>) }
  const asInput = (metric: Record<string, any>) => {
    const { categories, at_step: atStep, ...input } = metric
    return { ...input, ...(categories ? { options: categories } : {}), ...(atStep ? { set_at: atStep } : {}) }
  }
  const position = (at: { stage: number; step: number }) => `${at.stage}.${at.step}`
  switch (op.op) {
    case 'add_step':
      if (typeof op.after === 'number') op.after = op.after === 0 ? '0' : `${op.stage}.${op.after}`
      break
    case 'change_step':
    case 'remove_step':
      if (typeof op.stage === 'number' && typeof op.step === 'number') {
        op.step = position(op as { stage: number; step: number })
        delete op.stage
      }
      break
    case 'change_rule':
      if ('ref' in op) {
        if (op.rule !== undefined) op.text = op.rule
        op.rule = op.ref
        delete op.ref
      }
      break
    case 'remove_rule':
      if ('ref' in op) {
        op.rule = op.ref
        delete op.ref
      }
      break
    case 'set_objective':
      if (Array.isArray(op.measures)) op.measures = op.measures.map(currentMeasureName)
      break
    case 'add_metric': {
      const { at, ...metric } = op.metric ?? {}
      return { op: 'add_input', input: asInput(at ? { ...metric, at_step: position(at) } : metric) }
    }
    case 'change_metric':
    case 'remove_metric': {
      const { op: legacyOp, name, metric, at, ...changes } = op
      return { op: legacyOp === 'change_metric' ? 'change_input' : 'remove_input', input: metric ?? name, ...asInput({ ...changes, ...(at ? { at_step: position(at) } : {}) }) }
    }
  }
  return op
}

export const WorkflowOp = z.preprocess(
  upgradeLegacyOp,
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('add_stage'), name: z.string().min(1), purpose: z.string().min(1), if: z.string().min(1).optional(), after: StageRef.optional(), steps: z.array(StepInput).min(1) }).strict(),
    z.object({ op: z.literal('change_stage'), stage: StageRef, name: z.string().min(1).optional(), purpose: z.string().min(1).optional(), if: ChangedCondition.optional() }).strict(),
    z.object({ op: z.literal('remove_stage'), stage: StageRef }).strict(),
    z.object({ op: z.literal('add_step'), stage: StageRef, after: Ref.optional(), step: StepInput }).strict(),
    z
      .object({
        op: z.literal('change_step'),
        step: Ref,
        name: z.string().min(1).optional(),
        instruction: z.string().min(1).optional(),
        gate: GateKind.optional(),
        rules: z.array(z.string()).optional(),
        report: z.array(z.string()).optional(),
        skippable: z.union([SkipDecider, z.literal('no')]).optional(),
        update: UpdateLevel.optional(),
        if: ChangedCondition.optional(),
      })
      .strict(),
    z.object({ op: z.literal('remove_step'), step: Ref }).strict(),
    z.object({ op: z.literal('add_policy'), name: z.string().regex(/^\S+$/), rules: z.array(RuleInput) }).strict(),
    z.object({ op: z.literal('add_rule'), policy: z.string().min(1), rule: RuleInput }).strict(),
    z.object({ op: z.literal('change_rule'), rule: Ref, text: z.string().min(1).optional(), verified_by: z.string().min(1).optional() }).strict(),
    z.object({ op: z.literal('remove_rule'), rule: Ref }).strict(),
    z.object({ op: z.literal('add_input'), input: NewInput }).strict(),
    z
      .object({
        op: z.literal('change_input'),
        input: Ref,
        options: z.array(InputOption).min(2).optional(),
        set_at: Ref.optional(),
        by: InputSetter.optional(),
        instruction: z.string().min(1).optional(),
      })
      .strict(),
    z.object({ op: z.literal('remove_input'), input: Ref }).strict(),
    z.object({ op: z.literal('add_tool_capture'), capture: NewToolCapture }).strict(),
    z.object({ op: z.literal('change_tool_capture'), capture: Ref, command: z.string().min(1).optional(), keep: z.string().min(1).optional() }).strict(),
    z.object({ op: z.literal('remove_tool_capture'), capture: Ref }).strict(),
    z.object({ op: z.literal('set_objective'), text: z.string().min(1).optional(), measures: z.array(z.string().min(1)).min(1).optional() }).strict(),
    z.object({ op: z.literal('add_measure'), measure: JudgedMeasure }).strict(),
    z.object({ op: z.literal('change_measure'), measure: z.string().min(1), definition: z.string().min(1).optional(), show: z.boolean().optional() }).strict(),
    z.object({ op: z.literal('remove_measure'), measure: z.string().min(1) }).strict(),
    z.object({ op: z.literal('end_experiment'), id: z.number().int().positive(), outcome: z.enum(['kept', 'rethought']) }).strict(),
  ]),
)
export type WorkflowOp = z.infer<typeof WorkflowOp>

export class InvalidChange extends Error {}

const LEVEL_RANK: Record<VersionLevel, number> = { patch: 0, minor: 1, major: 2 }

/**
 * Major: the path or its checks change, including whether a step can be skipped and when a stage or
 * step applies. Minor: what Agent is told changes, including when a work item updates. Patch:
 * nothing Agent does.
 */
export function levelOfOp(op: WorkflowOp): VersionLevel {
  switch (op.op) {
    case 'add_stage':
    case 'remove_stage':
    case 'add_step':
    case 'remove_step':
      return 'major'
    case 'change_step':
      return op.gate !== undefined || op.rules !== undefined || op.skippable !== undefined || op.if !== undefined ? 'major' : 'minor'
    case 'change_stage':
      return op.if !== undefined ? 'major' : 'minor'
    case 'end_experiment':
    case 'add_measure':
    case 'change_measure':
    case 'remove_measure':
      return 'patch'
    default:
      return 'minor'
  }
}

/** A change to what Agent does opens an experiment; ending one, or changing what is measured, doesn't. */
export const opensWorkflowExperiment = (ops: readonly WorkflowOp[]) => ops.some((op) => !['end_experiment', 'add_measure', 'change_measure', 'remove_measure'].includes(op.op))

export function levelOfOps(ops: readonly WorkflowOp[]): VersionLevel {
  const highest = ops.map(levelOfOp).reduce<VersionLevel>((level, opLevel) => (LEVEL_RANK[opLevel] > LEVEL_RANK[level] ? opLevel : level), 'patch')
  return opensWorkflowExperiment(ops) && highest === 'patch' ? 'minor' : highest
}

const renumberStagesAndSteps = (workflow: WorkflowDocument): WorkflowDocument => ({
  ...workflow,
  stages: workflow.stages.map((stage, stageIndex) => ({ ...stage, n: stageIndex + 1, steps: stage.steps.map((step, stepIndex) => ({ ...step, n: stepIndex + 1 })) })),
})

function resolveForChange(workflow: WorkflowDocument, text: string, kind: RefKind) {
  try {
    return resolveRef(workflow, text, { impliedKind: kind })
  } catch (error) {
    if (error instanceof InvalidReference) throw new InvalidChange(error.message)
    throw error
  }
}

function requireStage(workflow: WorkflowDocument, stageRef: string) {
  const { guid } = resolveForChange(workflow, stageRef, 'stage')
  return workflow.stages.find((stage) => stage.guid === guid)!
}

function requireStep(workflow: WorkflowDocument, stepRef: string) {
  const { guid } = resolveForChange(workflow, stepRef, 'step')
  for (const stage of workflow.stages) {
    const step = stage.steps.find((candidate) => candidate.guid === guid)
    if (step) return { stage, step }
  }
  throw new InvalidChange(`There is no work step ${stepRef}.`)
}

function requireRule(workflow: WorkflowDocument, ruleRef: string) {
  const { guid } = resolveForChange(workflow, ruleRef, 'rule')
  const policy = workflow.policies.find((candidate) => candidate.rules.some((rule) => rule.guid === guid))!
  return { policy, ruleIndex: policy.rules.findIndex((rule) => rule.guid === guid) }
}

function requireToolCapture(workflow: WorkflowDocument, captureRef: string) {
  const { guid } = resolveForChange(workflow, captureRef, 'capture')
  return workflow.tool_captures.find((capture) => capture.guid === guid)!
}

function requireMeasure(workflow: WorkflowDocument, name: string) {
  const measure = workflow.measures.find((candidate) => candidate.name === name)
  if (!measure) throw new InvalidChange(`The workflow defines no measure "${name}"; it defines ${workflow.measures.map((candidate) => `"${candidate.name}"`).join(', ') || 'none'}.`)
  return measure
}

function requireInput(workflow: WorkflowDocument, inputRef: string) {
  const { guid } = resolveForChange(workflow, inputRef, 'input')
  return workflow.inputs.find((input) => input.guid === guid)!
}

/** Sets `if` on a stage or step from a change: "" removes it. */
function setCondition(component: { if?: string }, condition: string | undefined) {
  if (condition === undefined) return
  if (condition.trim() === '') delete component.if
  else component.if = condition
}

const withoutUndefined = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))

const ruleRefsOf = (rules: readonly string[]) => rules.map((ruleRef) => parseRef(ruleRef, 'rule').name)

/**
 * Applies the operations in order. Stages and steps are renumbered after each one; an input set at
 * a work step stays at it, followed by GUID, even when the step's number changes.
 */
export function applyWorkflowOps(current: WorkflowDocument, ops: readonly WorkflowOp[], makeGuid: () => string = newGuid): WorkflowDocument {
  let workflow: WorkflowDocument = structuredClone(current)
  const stepGuidOfInput = new Map<string, string>()
  const followStepOf = (input: { guid: string; set_at: string }) => {
    const at = stepPosition(input.set_at)
    const stepGuid = at && stepGuidAt(workflow, at.stage, at.step)
    if (stepGuid) stepGuidOfInput.set(input.guid, stepGuid)
    else stepGuidOfInput.delete(input.guid)
  }
  for (const input of workflow.inputs) followStepOf(input)
  const newStep = (step: z.infer<typeof StepInput>) => ({ guid: makeGuid(), n: 0, ...step, rules: ruleRefsOf(step.rules) })
  for (const op of ops) {
    switch (op.op) {
      case 'add_stage': {
        const insertAt = op.after === undefined ? workflow.stages.length : op.after === '0' ? 0 : requireStage(workflow, op.after).n
        workflow.stages.splice(insertAt, 0, { guid: makeGuid(), n: 0, name: op.name, purpose: op.purpose, ...(op.if ? { if: op.if } : {}), steps: op.steps.map(newStep) })
        break
      }
      case 'change_stage': {
        const { op: _op, stage: stageRef, if: condition, ...stageChanges } = op
        const stage = requireStage(workflow, stageRef)
        Object.assign(stage, withoutUndefined(stageChanges))
        setCondition(stage, condition)
        break
      }
      case 'remove_stage': {
        const removed = requireStage(workflow, op.stage)
        workflow.stages = workflow.stages.filter((stage) => stage.guid !== removed.guid)
        break
      }
      case 'add_step': {
        const stage = requireStage(workflow, op.stage)
        let insertAt = stage.steps.length
        if (op.after === '0') insertAt = 0
        else if (op.after !== undefined) {
          const after = requireStep(workflow, op.after)
          if (after.stage.guid !== stage.guid) throw new InvalidChange(`Work step ${op.after} is not in stage ${stage.n}.`)
          insertAt = after.step.n
        }
        stage.steps.splice(insertAt, 0, newStep(op.step))
        break
      }
      case 'change_step': {
        const { op: _op, step: stepRef, ...stepChanges } = op
        const { step } = requireStep(workflow, stepRef)
        const { skippable, if: condition, ...otherChanges } = stepChanges
        Object.assign(step, withoutUndefined({ ...otherChanges, rules: stepChanges.rules && ruleRefsOf(stepChanges.rules) }))
        if (skippable === 'no') delete step.skippable
        else if (skippable !== undefined) step.skippable = skippable
        setCondition(step, condition)
        break
      }
      case 'remove_step': {
        const { stage, step: removed } = requireStep(workflow, op.step)
        stage.steps = stage.steps.filter((step) => step.guid !== removed.guid)
        break
      }
      case 'add_policy':
        if (workflow.policies.some((policy) => policy.name === op.name)) throw new InvalidChange(`Work policy "${op.name}" already exists; add rules to it.`)
        workflow.policies.push({ guid: makeGuid(), name: op.name, rules: op.rules.map((rule) => ({ guid: makeGuid(), ...rule })) })
        break
      case 'add_rule': {
        const policy = workflow.policies.find((candidate) => candidate.name === parseRef(op.policy, 'policy').name)
        if (!policy) throw new InvalidChange(`There is no work policy "${op.policy}".`)
        if (policy.rules.some((rule) => rule.id === op.rule.id)) throw new InvalidChange(`Rule "${policy.name} ${op.rule.id}" already exists.`)
        policy.rules.push({ guid: makeGuid(), ...op.rule })
        break
      }
      case 'change_rule': {
        const { policy, ruleIndex } = requireRule(workflow, op.rule)
        const rule = policy.rules[ruleIndex]!
        policy.rules[ruleIndex] = { ...rule, ...(op.text ? { rule: op.text } : {}), ...(op.verified_by ? { verified_by: op.verified_by } : {}) }
        break
      }
      case 'remove_rule': {
        const { policy, ruleIndex } = requireRule(workflow, op.rule)
        policy.rules.splice(ruleIndex, 1)
        break
      }
      case 'add_input': {
        if (workflow.inputs.some((input) => input.name === op.input.name)) throw new InvalidChange(`Input "${op.input.name}" already exists; change it instead.`)
        const setAt = op.input.set_at === AT_START ? AT_START : requireStep(workflow, op.input.set_at).step
        const input = { guid: makeGuid(), ...op.input }
        workflow.inputs.push(input)
        if (setAt !== AT_START) stepGuidOfInput.set(input.guid, setAt.guid)
        break
      }
      case 'change_input': {
        const { op: _op, input: inputRef, set_at: setAt, ...inputChanges } = op
        const input = requireInput(workflow, inputRef)
        Object.assign(input, withoutUndefined(inputChanges))
        if (setAt === AT_START) {
          input.set_at = AT_START
          stepGuidOfInput.delete(input.guid)
        } else if (setAt !== undefined) stepGuidOfInput.set(input.guid, requireStep(workflow, setAt).step.guid)
        break
      }
      case 'remove_input': {
        const removed = requireInput(workflow, op.input)
        workflow.inputs = workflow.inputs.filter((input) => input.guid !== removed.guid)
        break
      }
      case 'add_tool_capture':
        if (workflow.tool_captures.some((capture) => capture.name === op.capture.name)) throw new InvalidChange(`Tool capture "${op.capture.name}" already exists; change it instead.`)
        workflow.tool_captures.push({ guid: makeGuid(), ...op.capture })
        break
      case 'change_tool_capture': {
        const { op: _op, capture: captureRef, ...captureChanges } = op
        Object.assign(requireToolCapture(workflow, captureRef), withoutUndefined(captureChanges))
        break
      }
      case 'remove_tool_capture': {
        const removed = requireToolCapture(workflow, op.capture)
        workflow.tool_captures = workflow.tool_captures.filter((capture) => capture.guid !== removed.guid)
        break
      }
      case 'set_objective':
        workflow.objective = { text: op.text ?? workflow.objective.text, measures: op.measures ?? workflow.objective.measures }
        break
      case 'add_measure':
        if (workflow.measures.some((measure) => measure.name === op.measure.name)) throw new InvalidChange(`Measure "${op.measure.name}" already exists; change it instead.`)
        workflow.measures.push(op.measure)
        break
      case 'change_measure': {
        const { op: _op, measure: measureName, ...measureChanges } = op
        Object.assign(requireMeasure(workflow, measureName), withoutUndefined(measureChanges))
        break
      }
      case 'remove_measure': {
        const removed = requireMeasure(workflow, op.measure)
        workflow.measures = workflow.measures.filter((measure) => measure !== removed)
        break
      }
      case 'end_experiment':
        if (!workflow.experiments.some((experiment) => experiment.id === op.id)) throw new InvalidChange(`There is no running workflow experiment ${op.id}.`)
        workflow.experiments = workflow.experiments.filter((experiment) => experiment.id !== op.id)
        break
    }
    workflow = renumberStagesAndSteps(workflow)
    for (const input of workflow.inputs) {
      const stepGuid = stepGuidOfInput.get(input.guid)
      if (!stepGuid) continue
      const step = refOfGuid(workflow, stepGuid)
      if (!step) throw new InvalidChange(`Input "${input.name}" is set at work step ${input.set_at}, which this change removes. Move the input (change_input with set_at) or remove it.`)
      input.set_at = step.name
    }
  }
  const parsed = WorkflowDocument.safeParse({ ...workflow, version: bumpVersion(current.version, levelOfOps(ops)) })
  if (!parsed.success) throw new InvalidChange(`The changed workflow is invalid: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

export function applyProposal(current: WorkflowDocument, proposal: Proposal, deliveredItems: readonly ItemMeasures[], today: string) {
  const ops = z.array(WorkflowOp).parse(proposal.ops)
  const next = applyWorkflowOps(current, ops)
  if (opensWorkflowExperiment(ops)) {
    const named = currentMeasureName(proposal.measure)
    const measure = isMeasureOf(next, named) ? named : current.objective.measures[0]!
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
      affects: next.stages.flatMap((stage) => stage.steps).filter((step) => !stepUnchanged(current, next, step.guid)).map((step) => step.guid),
      version: next.version,
      started: today,
    })
  }
  return { workflow: WorkflowDocument.parse(next), level: levelOfOps(ops) }
}


const noDifference = (change: string, measure: string) => `"${change}" makes no difference to ${measure}.`

const WORKFLOW_OP_REFERENCE = `Operations. They name what they change by reference: a stage by its number ("1"), a step by "<stage>.<step>" ("1.2"), a rule by "<policy> <rule id>" ("pr 1.1"), a work item input by its name. Stages and steps are renumbered after each operation; refer to them as they are after the previous operation. An input stays at its step when the step's number changes.
{"op":"add_stage","name":"build","purpose":"<what the stage achieves>","after":"1","steps":[{"name":"write the tests first","instruction":"<the work to do in this step, as an order to Agent>","gate":"self","rules":["test 1.1"],"report":["test result"]}]}   (after: the stage it follows, "0" to put it first; omit to append)
{"op":"change_stage","stage":"1","purpose":"..."}   (any of name, purpose, if ("" removes it))
{"op":"remove_stage","stage":"2"}
{"op":"add_step","stage":"1","after":"1.1","step":{"name":"...","instruction":"...","gate":"self|drillmaster|owner","rules":["<policy> <rule id>"],"report":["..."],"skippable":"self|drillmaster|owner","update":"patch|minor|major|none","if":"kind == 'bug'"}}   (after: the step it follows, "0" to put it first; omit to append. skippable, update and if are optional, see below)
{"op":"change_step","step":"1.2","gate":"drillmaster"}   (any of name, instruction, gate, rules, report, skippable ("no" makes it unskippable), update, if ("" removes it))
A stage's or step's if makes it apply only to some work items, by their inputs, as a pipeline step's if does: "kind == 'bug'", "kind != 'bug'", "kind in ['bug', 'chore']", joined with &&, || and !. Drillmaster skips it, saying why, for a work item it doesn't apply to. It may read only inputs set at work_start or at a step before it. Use it for work only some work items need (a failing test first for a bug, a spec for a feature); use skippable when only the work can tell.
A step's skippable says who decides that a work item can skip it (for example a step not every kind of work item needs); leave it out for a step every work item must do.
A step's update lets an open work item move to the latest workflow version before the step starts, when the latest differs by at least that level; the item keeps the steps it did that are unchanged, and resumes at the first that changed. Put it on the first step of a stage that is done in a later session (for example the first build step), so work captured earlier runs on the current workflow. Leave it out (none) elsewhere.
{"op":"remove_step","step":"1.2"}
{"op":"add_policy","name":"pr","rules":[{"id":"1.1","rule":"the PR says what it changes","verified_by":"reading the PR description"}]}
{"op":"add_rule","policy":"pr","rule":{"id":"1.2","rule":"...","verified_by":"..."}}
{"op":"change_rule","rule":"pr 1.1","text":"...","verified_by":"..."}   (any of text, verified_by)
{"op":"remove_rule","rule":"pr 1.1"}
{"op":"add_input","input":{"name":"kind","options":[{"value":"bug","description":"existing behaviour is wrong"},{"value":"feature","description":"new behaviour"}],"set_at":"start","by":"agent|drillmaster|owner","instruction":"<how to choose the option>"}}   (set_at: "start" for work_start, or the step whose gate sets it, e.g. "1.1"; work can't go on without it)
{"op":"change_input","input":"kind","instruction":"..."}   (any of options, set_at, by, instruction)
{"op":"remove_input","input":"kind"}
{"op":"add_tool_capture","capture":{"name":"tests","command":"npm (run )?test","keep":"|~ \`^# (tests|pass|fail) \` | pattern \`# <what> <count>\`"}}   (what the trace of a Bash or PowerShell call keeps of a matching command's output, instead of its last 20 lines: command is a regular expression found anywhere in the command line (Agent often runs "cd <folder> && npm test", so don't anchor it with ^), keep a pipeline in LogQL's syntax (https://grafana.com/docs/loki/latest/logql/): line filters |= != |~ !~, | json, | logfmt, | pattern, | regexp, field filters like | count > 0, and | line_format. Add one when a gate's claim about a command's output could not be checked)
{"op":"change_tool_capture","capture":"tests","keep":"..."}   (any of command, keep)
{"op":"remove_tool_capture","capture":"tests"}
{"op":"set_objective","text":"...","measures":["gate_rejections_per_item","policy friction"]}   (measures: ones Drillmaster counts, and ones the workflow defines)
{"op":"add_measure","measure":{"name":"policy friction","definition":"<what counts as one occurrence: something that should not happen>","show":true}}   (Drillmaster judges a defined measure in its post mortem of each work item delivered from then on, placing each occurrence at the step that should have caught it; show puts it on the viewer's pages. It is never judged on work items delivered before, so an experiment can use it once ${BASELINE_WINDOW} work items are judged)
{"op":"change_measure","measure":"policy friction","definition":"..."}   (any of definition, show; work items judged before keep their judgement)
{"op":"remove_measure","measure":"policy friction"}   (not while the objective or a running experiment uses it)
{"op":"end_experiment","id":1,"outcome":"kept|rethought"}`

export function deliveredSinceLastRetro(state: ProjectState, events: readonly DrillmasterEvent[]) {
  const lastRetroAt = state.latestRetroId ? state.retros[state.latestRetroId]!.at : ''
  return measureDeliveredItems(events).filter((item) => item.delivered_at > lastRetroAt)
}

export function retrospectiveDue(state: ProjectState, events: readonly DrillmasterEvent[]): string | null {
  if (!state.workflow) return null
  const delivered = measureDeliveredItems(events)
  const ready = judgeExperiments(state.workflow, delivered).filter((verdict) => verdict.status !== 'running')
  if (ready.length) return `experiment ${ready.map((verdict) => verdict.id).join(', ')} can be judged: its judge_after items are delivered`
  const sinceLast = deliveredSinceLastRetro(state, events).length
  return sinceLast >= BASELINE_WINDOW ? `${sinceLast} work items were delivered since the last retrospective` : null
}

function lastRetrospectiveLines(state: ProjectState, events: readonly DrillmasterEvent[]) {
  const retro = state.latestRetroId ? state.retros[state.latestRetroId] : undefined
  if (!retro) return ['- none: this is the first retrospective']
  const changes = events.filter((event): event is Extract<DrillmasterEvent, { type: 'workflow_changed' }> => event.type === 'workflow_changed' && event.retro_id === retro.retro_id)
  return retro.proposals.map((proposal) => {
    const outcome = retro.applied.includes(proposal.id)
      ? `applied as workflow ${changes.find((change) => change.proposal === proposal.id)?.workflow.version ?? '?'}`
      : retro.declined.includes(proposal.id)
        ? 'declined by Owner'
        : 'not decided'
    return `- proposal ${proposal.id} "${proposal.change}" (purpose: ${proposal.purpose}${proposal.hypothesis ? `; hypothesis: ${proposal.hypothesis}` : ''}): ${outcome}`
  })
}

/** A Drillmaster tool as the retrospective is told about it: the contract the workflow works within. */
export interface ToolContract {
  name: string
  description: string
}

export function buildRetroPrompt(state: ProjectState, events: readonly DrillmasterEvent[], tools: readonly ToolContract[]) {
  const workflow = state.workflow!
  const allDelivered = measureDeliveredItems(events)
  const recentDelivered = deliveredSinceLastRetro(state, events)
  // Work items done in phases stay open across retrospectives; what happened on them counts too.
  const openItems = Object.values(state.workItems).filter((item) => item.status === 'active')
  const recentItemIds = new Set([...recentDelivered.map((item) => item.work_item_id), ...openItems.map((item) => item.work_item_id)])
  const recentItemEvents = events.filter((event) => 'work_item_id' in event && event.work_item_id && recentItemIds.has(event.work_item_id))
  const lastRetroAt = state.latestRetroId ? state.retros[state.latestRetroId]!.at : ''
  const frictionJudgements = frictionJudgementsOf(events)
  const ownerInputLines = ownerInputsOf(events)
    .filter((input) => (input.work_item_id ? recentItemIds.has(input.work_item_id) : input.at > lastRetroAt))
    .map((input) => ownerInputLine(input, frictionJudgements.get(input.event_id)))
  const judgedMeasures = judgedMeasuresOf(events)
  const occurrenceLines = [...recentItemIds].flatMap((workItemId) =>
    (judgedMeasures.get(workItemId) ?? []).flatMap((judgement) =>
      judgement.occurrences.map((occurrence) => `- ${workItemId} (${state.workItems[workItemId]!.issue}), ${judgement.measure}, ${occurrence.step_guid ? `step ${refOfGuid(workflow, occurrence.step_guid)?.name ?? 'no longer in the workflow'}` : 'no step covers it'}: ${occurrence.why}`),
    ),
  )
  const definedMeasureLines = workflow.measures.map((measure) => `- "${measure.name}" (judged): ${measure.definition}`)
  const reportLines = recentItemEvents
    .filter((event) => ['work_reported', 'gate_verdict', 'review_failed', 'post_mortem_written'].includes(event.type))
    .map((event) => `- ${JSON.stringify(event)}`)
  const measureLines = workflow.objective.measures.map(
    (measure) =>
      `- ${measure}: last ${itemsWithMeasure(recentDelivered, measure).length} items ${averageMeasure(recentDelivered, measure) ?? 'n/a'}; all ${itemsWithMeasure(allDelivered, measure).length} items ${averageMeasure(allDelivered, measure) ?? 'n/a'}`,
  )
  const experimentLines = judgeExperiments(workflow, allDelivered).map((verdict) => {
    const experiment = workflow.experiments.find((candidate) => candidate.id === verdict.id)!
    return [
      `- experiment ${experiment.id} "${experiment.change}" (purpose: ${experiment.purpose}; hypothesis: ${experiment.hypothesis || 'none'}; null hypothesis: ${experiment.null_hypothesis || 'none'})`,
      `  measure ${experiment.measure}: baseline ${experiment.baseline} (sd ${experiment.baseline_sd}), target ${experiment.target ?? 'none'}, judged after ${experiment.judge_after} items; ${verdict.counted} counted so far, mean ${verdict.mean ?? 'n/a'}`,
      `  server's verdict: ${verdict.status === 'running' ? 'still running' : `${verdict.status} (null hypothesis ${verdict.null_rejected ? 'rejected' : 'not rejected'}, target ${verdict.target_met ? 'met' : 'not met'})`}${verdict.overlapping.length ? `; runs alongside experiment ${verdict.overlapping.join(', ')} on the same measure, so the effects mix` : ''}`,
      ...(verdict.through_steps.length ? [`  counts only the work items that went through step ${verdict.through_steps.join(', ')}, which its change touched`] : []),
      ...(Object.keys(verdict.rule_rejections).length
        ? [`  gate rejections citing the rules of those steps, over the judged items: ${Object.entries(verdict.rule_rejections).map(([rule, count]) => `${rule}: ${count}`).join(', ')}`]
        : []),
    ].join('\n')
  })

  return [
    'You are Drillmaster, carrying out a workflow retrospective that Owner called for. The workflow retrospective is the only place the workflow changes.',
    "Open by judging the last retrospective's actions (findings.opening): for each change it applied, did it do what it was meant to, judged by its experiment's verdict and what happened since? Say plainly which ones did not.",
    "Then answer: what should have happened, what happened, why, what to keep and what to improve. Base it on the workflow post mortems, the work reports, the verdicts and Owner's inputs, above all the occurrences of the measures Drillmaster judged: what the workflow counts as going wrong, at the step that should have caught it.",
    'Every impediment is rust: propose deliberate workflow changes that remove impediments or deliver better ways. Each proposal is one change on trial, with a purpose, a hypothesis, a null hypothesis, a target on its measure, and how many delivered items to judge it after.',
    'Work stages hold the work. Propose the work Agent must do (a step with an instruction), not only checks on it. Every stage has a purpose, and every step an instruction written as an order to Agent. If a stage or step has no purpose or instruction yet, fill it in.',
    "Judge every running workflow experiment with the server's verdict below: end it 'kept' when the verdict is keep, and 'rethought' (plus any replacement change) when it is rethink. Leave running ones alone.",
    'Judge each proposal on a measure that can still drop: one that is 0 over the last delivered items cannot show an improvement, and a target must be below the baseline. Such a proposal is dropped.',
    `Propose at most ${MAX_PROPOSALS} changes: few, small and high-value, so each can be measured. A rule must say how it is verified. A work gate references specific rules. Work item inputs are options set at work_start or at a work step (for example whether it is a bug or a feature): steps and stages apply by them (if), and measures are split by them.`,
    `Write keep and improve as lists. In each entry, ${FEEDBACK_REFS_HELP} An entry about a tool is feedback on Drillmaster itself, which the workflow can't change; say so rather than propose a workflow change around it.`,
    'Each proposal lists in relies_on the references of what it builds on. A proposal that relies on something another proposal adds must come after it.',
    '',
    "Drillmaster's tools, and what each accepts (the workflow works within these; it can't change them):",
    ...tools.map((tool) => `- ${tool.name}: ${tool.description.replace(/\n/g, ' ')}`),
    '',
    `Current workflow (version ${workflow.version}):`,
    workflowForReading(workflow),
    '',
    `Measures (Owner's objective: "${workflow.objective.text}"). A judged measure counts only the work items Drillmaster judged it on:`,
    ...measureLines,
    'The measures the workflow defines, which Drillmaster judges:',
    ...(definedMeasureLines.length ? definedMeasureLines : ['- none']),
    `Gate rejections per rule, over the work items delivered since the last retrospective: ${Object.entries(rejectionsByRule(recentDelivered)).map(([rule, count]) => `${rule}: ${count}`).join(', ') || 'none'}`,
    '',
    "The last retrospective's actions:",
    ...lastRetrospectiveLines(state, events),
    '',
    'Running workflow experiments:',
    ...(experimentLines.length ? experimentLines : ['- none']),
    '',
    `Delivered work items since the last retrospective: ${recentDelivered.map((item) => `${item.work_item_id} (${item.issue})`).join(', ') || 'none'}`,
    `Open work items, partly done (their reports and Owner's words below count too): ${openItems.map((item) => `${item.work_item_id} (${item.issue}) at ${item.stage === null ? 'delivery' : `step ${item.stage}.${item.step}`}`).join(', ') || 'none'}`,
    '',
    "Owner's inputs (chat prompts) since the last retrospective, each where it belongs. Owner decides only in AskUserQuestion; an input is a prompt:",
    ...(ownerInputLines.length ? ownerInputLines : ['- none']),
    '',
    'Occurrences of the judged measures on those work items, each at the step that should have caught it:',
    ...(occurrenceLines.length ? occurrenceLines : ['- none']),
    '',
    'Work reports, verdicts and post mortems:',
    ...(reportLines.length ? reportLines : ['- none']),
    '',
    WORKFLOW_OP_REFERENCE,
    "Proposals are applied in order: each proposal's operations see the workflow as the proposals before it leave it. Prefer proposals that stand on their own, so Owner can approve any of them.",
    '',
    'Answer with JSON only:',
    '{"findings":{"opening":"<how the last retrospective\'s actions did>","should":"...","did":"...","why":"...","keep":[{"refs":["step 1.2"],"text":"..."}],"improve":[{"refs":["rule pr 1.1"],"text":"..."}]},"proposals":[{"id":1,"change":"<one line>","purpose":"<the impediment it removes or the better way it delivers>","measure":"<one of the objective measures>","hypothesis":"<what will improve, and why>","null_hypothesis":"<the change makes no difference to the measure>","target":<the measure value that counts as success, lower is better>,"judge_after":<delivered items to judge it after, e.g. 3>,"relies_on":["step 1.2"],"ops":[...]}]}',
  ].join('\n')
}

const ROLE_LABELS: Record<OwnerInput['role'], string> = { start: 'started it', resume: 'took it up again', retrospective: 'called a retrospective', input: 'input' }

/** An input with the verdict of the friction judge Drillmaster 0.3 had, when it judged it. */
function ownerInputLine(input: OwnerInput, frictionJudgement: { friction: boolean; why: string } | undefined) {
  const where = input.work_item_id ? `${input.work_item_id}, ${ROLE_LABELS[input.role]}${input.after_delivery ? ', after delivery' : ''}` : ROLE_LABELS[input.role]
  const verdict = frictionJudgement ? ` (${frictionJudgement.friction ? 'friction' : 'no friction'}: ${frictionJudgement.why})` : ''
  return `- ${where}: "${input.prompt}"${verdict}`
}

/** Feedback as Drillmaster wrote it: a list of entries, or plain text, which becomes one entry about nothing in particular. */
const FeedbackAnswer = z.preprocess(
  (value) => (typeof value === 'string' ? (value.trim() ? [{ refs: [], text: value }] : []) : value),
  z.array(z.preprocess((entry) => (typeof entry === 'string' ? { refs: [], text: entry } : entry), FeedbackInput.extend({ refs: z.array(z.string()).default([]) }).loose())),
)
const Findings = z.object({ opening: z.string().default(''), should: z.string(), did: z.string(), why: z.string(), keep: FeedbackAnswer, improve: FeedbackAnswer })

const resolvesIn = (workflow: WorkflowDocument, ref: string, toolNames: readonly string[]) => {
  try {
    return resolveRef(workflow, ref, { toolNames })
  } catch (error) {
    if (error instanceof InvalidReference) return undefined
    throw error
  }
}

/**
 * The proposals a proposal depends on: for each reference it relies on that the current workflow
 * doesn't have, the earlier proposal that adds it. References read as the earlier proposals leave
 * the workflow, like operations do.
 */
function proposalsReliedOn(relies: readonly string[], current: WorkflowDocument, earlier: readonly { id: number; after: WorkflowDocument }[], afterOwnOps: WorkflowDocument, toolNames: readonly string[]) {
  const beforeOwnOps = earlier.at(-1)?.after ?? current
  const dependsOn = new Set<number>()
  for (const ref of relies) {
    const target = resolvesIn(beforeOwnOps, ref, toolNames)
    if (!target) {
      if (resolvesIn(afterOwnOps, ref, toolNames)) continue
      throw new InvalidChange(`It relies on ${ref}, which workflow ${current.version} doesn't have and no earlier proposal adds.`)
    }
    if (target.guid === null || refOfGuid(current, target.guid)) continue
    const adder = earlier.find((proposal) => refOfGuid(proposal.after, target.guid!))
    if (adder) dependsOn.add(adder.id)
  }
  return [...dependsOn]
}

/** Why an experiment on this measure and target could never show an improvement, if it couldn't. */
function cannotShowImprovement(measure: string, target: unknown, deliveredItems: readonly ItemMeasures[]) {
  const judgedItems = itemsWithMeasure(deliveredItems, measure).length
  if (!isCountedMeasure(measure) && judgedItems < BASELINE_WINDOW)
    return `It is judged on ${measure}, which Drillmaster has judged on ${judgedItems} delivered work items; it needs ${BASELINE_WINDOW} for a baseline. Judge it on another measure, or wait.`
  if (deliveredItems.length === 0) return undefined
  const baseline = measureBaseline(deliveredItems, measure)
  if (baseline === 0) return `It is judged on ${measure}, which is 0 over the last ${Math.min(deliveredItems.length, BASELINE_WINDOW)} delivered work items, so it cannot show an improvement. Judge it on a measure that can still drop.`
  if (typeof target === 'number' && target >= baseline) return `Its target ${target} on ${measure} is not below the baseline ${baseline}, so meeting it shows no improvement.`
  return undefined
}

export function readRetroAnswer(workflow: WorkflowDocument, answer: unknown, toolNames: readonly string[] = [], deliveredItems: readonly ItemMeasures[] = []) {
  const retroAnswer = (typeof answer === 'string' ? extractFirstJsonObject(answer) : answer) as { findings?: unknown; proposals?: unknown } | undefined
  const parsedFindings = Findings.safeParse(retroAnswer?.findings)
  if (!parsedFindings.success) throw new InvalidAnswer(`The retrospective has no findings: ${JSON.stringify(answer).slice(0, MAX_ANSWER_IN_ERROR)}`)
  const findings: RetroFindings = {
    ...parsedFindings.data,
    keep: resolveFeedback(workflow, parsedFindings.data.keep, toolNames, 'drop'),
    improve: resolveFeedback(workflow, parsedFindings.data.improve, toolNames, 'drop'),
  }
  const proposals: Proposal[] = []
  const workflowAfterProposal: { id: number; after: WorkflowDocument }[] = []
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
      const named = typeof candidate.measure === 'string' ? currentMeasureName(candidate.measure) : ''
      const measure = isMeasureOf(workflowAfterEarlierProposals, named) ? named : workflow.objective.measures[0]!
      const noImprovement = opensWorkflowExperiment(ops) ? cannotShowImprovement(measure, candidate.target, deliveredItems) : undefined
      if (noImprovement) {
        dropped.push({ change, error: noImprovement })
        continue
      }
      const reliesOn = Array.isArray(candidate.relies_on) ? candidate.relies_on.filter((ref): ref is string => typeof ref === 'string') : []
      const afterOwnOps = { ...applyWorkflowOps(workflowAfterEarlierProposals, ops), version: workflowAfterEarlierProposals.version }
      let dependsOn = proposalsReliedOn(reliesOn, workflow, workflowAfterProposal, afterOwnOps, toolNames)
      if (dependsOn.length === 0) {
        try {
          applyWorkflowOps(workflow, ops)
        } catch {
          dependsOn = proposals.map((earlier) => earlier.id)
        }
      }
      workflowAfterEarlierProposals = afterOwnOps
      workflowAfterProposal.push({ id: proposals.length + 1, after: afterOwnOps })
      proposals.push({
        id: proposals.length + 1,
        change,
        purpose: typeof candidate.purpose === 'string' ? candidate.purpose : '',
        measure,
        ...(typeof candidate.hypothesis === 'string' ? { hypothesis: candidate.hypothesis } : {}),
        ...(typeof candidate.null_hypothesis === 'string' ? { null_hypothesis: candidate.null_hypothesis } : {}),
        ...(typeof candidate.target === 'number' ? { target: candidate.target } : {}),
        ...(Number.isInteger(candidate.judge_after) && candidate.judge_after! > 0 ? { judge_after: candidate.judge_after } : {}),
        ...(reliesOn.length ? { relies_on: reliesOn } : {}),
        ops,
        ...(dependsOn.length ? { depends_on: dependsOn } : {}),
      })
    } catch (error) {
      dropped.push({ change, error: error instanceof z.ZodError ? z.prettifyError(error) : String((error as Error).message) })
    }
  }
  return { findings, proposals, dropped }
}

export function buildPostMortemPrompt(item: WorkItemState, workflow: WorkflowDocument, events: readonly DrillmasterEvent[]) {
  const itemEvents = events.filter((event) => 'work_item_id' in event && event.work_item_id === item.work_item_id)
  const eventLines = itemEvents.map(eventLine)
  const delivered = measureDeliveredItems(events)
  const experimentLines = workflow.experiments.map((experiment) => {
    const counted = itemsCountedFor(experiment, delivered)
    const number = counted.findIndex((countedItem) => countedItem.work_item_id === item.work_item_id) + 1
    const about = `- experiment ${experiment.id} "${experiment.change}", judged after ${experiment.judge_after} work items:`
    if (number === 0) return `${about} this work item does not count for it${experiment.affects?.length ? ': it did not go through the steps the change touched' : ''}.`
    return `${about} this work item is number ${number} of them${number > experiment.judge_after ? ', past the ones it is judged on' : ''}.`
  })
  return [
    `You are Drillmaster. Work item ${item.work_item_id} (${item.issue}) is delivered. Write your workflow post mortem on the work item as a whole: it is about the workflow, not the code.`,
    'Look at what Agent did (the work traces), what it reported, the verdicts, and what Owner had to say or correct.',
    '',
    'Everything recorded for the work item, oldest first:',
    ...eventLines.slice(-MAX_EVENTS_IN_POST_MORTEM_PROMPT),
    '',
    `The workflow it ran on (version ${workflow.version}):`,
    workflowForReading(workflow),
    '',
    'Running workflow experiments, and how this work item counts for each (use these counts in experiment_reflections):',
    ...(experimentLines.length ? experimentLines : ['- none']),
    '',
    ...measuresToJudge(workflow),
    '',
    `Write keep and change as lists. In each entry, ${FEEDBACK_REFS_HELP}`,
    'Answer with JSON only:',
    `{"keep":[{"refs":["step 1.1"],"text":"what in the workflow helped"}],"change":[{"refs":["rule pr 1.1"],"text":"what got in the way, and how to change it"}],"experiment_reflections":[{"experiment":1,"text":"how this running workflow experiment did"}],${MEASURED_ANSWER_EXAMPLE}}`,
  ].join('\n')
}

const PostMortem = z.object({
  keep: FeedbackAnswer,
  change: FeedbackAnswer,
  experiment_reflections: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(ReflectionInput.loose()).catch([])),
  measured: z.unknown().optional(),
})

export function readPostMortemAnswer(answer: unknown, workflow: WorkflowDocument, toolNames: readonly string[], itemEventIds: ReadonlySet<string> = new Set()): PostMortemArgs & { measured: MeasureJudgement[] } {
  const parsed = PostMortem.safeParse(typeof answer === 'string' ? extractFirstJsonObject(answer) : answer)
  if (!parsed.success) throw new InvalidAnswer(`Drillmaster's post mortem is unreadable: ${JSON.stringify(answer).slice(0, MAX_ANSWER_IN_ERROR)}`)
  return {
    keep: resolveFeedback(workflow, parsed.data.keep, toolNames, 'drop'),
    change: resolveFeedback(workflow, parsed.data.change, toolNames, 'drop'),
    experiment_reflections: parsed.data.experiment_reflections.map(({ experiment, text }) => ({ experiment, text })),
    measured: readMeasuredAnswer(workflow, itemEventIds, parsed.data.measured),
  }
}

export const toRetroView = (event: RetrospectiveRan, dropped: { change: string; error: string }[] = []) => ({
  retro_id: event.retro_id,
  work_items: event.work_items,
  findings: event.findings,
  proposals: event.proposals.map((proposal) => ({ ...proposal, level: levelOfOps(z.array(WorkflowOp).parse(proposal.ops)) })),
  dropped,
})
