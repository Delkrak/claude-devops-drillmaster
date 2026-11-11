import { z } from 'zod'
import { comparisonsOf, InvalidCondition, parseCondition } from './conditions.js'
import { InvalidPipeline, parsePipeline } from './logPipeline.js'
import { currentMeasureName, MEASURE_NAMES } from './measures.js'
import { guidFromSeed, stepPosition } from './refs.js'
import { toSemver } from './versions.js'

export { bumpVersion, compareVersions, isMajorChange, toSemver } from './versions.js'

/** Owner chooses through AskUserQuestion, which shows at most four options. */
const MAX_OWNER_CHOICES = 4

export const GateKind = z.enum(['self', 'drillmaster', 'owner'])
/** Who decides that a skippable step is skipped: Agent itself, Drillmaster, or Owner. */
export const SkipDecider = z.enum(['self', 'drillmaster', 'owner'])
/** How big a newer workflow version must be for a work item to update to it before this step. */
export const UpdateLevel = z.enum(['patch', 'minor', 'major', 'none'])
export const InputSetter = z.enum(['agent', 'drillmaster', 'owner'])

export const SEMVER = /^\d+\.\d+\.\d+$/
export const WorkflowVersion = z.string().regex(SEMVER, 'a workflow version is major.minor.patch')
export type { VersionLevel } from './versions.js'

const Guid = z.string().min(1)
const StepName = z.string().regex(/^\d+\.\d+$/, 'a work step is written <stage>.<step>, e.g. "1.2"')
/** The set_at of a work item input given in work_start. */
export const AT_START = 'start'

export const WorkStep = z.object({
  guid: Guid,
  n: z.number().int().positive(),
  name: z.string().min(1),
  instruction: z.string(),
  gate: GateKind,
  rules: z.array(z.string().regex(/^\S+ \S+$/, 'a rule reference is "<policy> <rule id>"')),
  report: z.array(z.string()),
  skippable: SkipDecider.optional(),
  update: UpdateLevel.optional(),
  if: z.string().min(1).optional(),
})

export const WorkStage = z.object({
  guid: Guid,
  n: z.number().int().positive(),
  name: z.string().min(1),
  purpose: z.string(),
  if: z.string().min(1).optional(),
  steps: z.array(WorkStep),
})

export const PolicyRule = z.object({
  guid: Guid,
  id: z.string().min(1),
  rule: z.string().min(1),
  verified_by: z.string().min(1),
})

export const WorkPolicy = z.object({
  guid: Guid,
  name: z.string().regex(/^\S+$/, 'a work policy name has no spaces'),
  rules: z.array(PolicyRule),
})

export const InputOption = z.object({ value: z.string().min(1), description: z.string().min(1) })

export const WorkItemInput = z.object({
  guid: Guid,
  name: z.string().regex(/^[A-Za-z_][\w-]*$/, 'a work item input is named with letters, digits, _ and -, starting with a letter or _'),
  options: z.array(InputOption).min(2),
  set_at: z.union([z.literal(AT_START), StepName]),
  by: InputSetter,
  instruction: z.string().min(1),
})

/** What the trace of a Bash or PowerShell call keeps of a matching command's output, instead of its last lines. */
export const ToolCapture = z.object({
  guid: Guid,
  name: z.string().regex(/^[A-Za-z_][\w-]*$/, 'a tool capture is named with letters, digits, _ and -'),
  /** A regular expression the command must match. */
  command: z.string().min(1),
  /** A pipeline in LogQL's syntax. */
  keep: z.string().min(1),
})

export const WorkflowExperiment = z.object({
  id: z.number().int().positive(),
  change: z.string().min(1),
  purpose: z.string().min(1),
  hypothesis: z.string(),
  null_hypothesis: z.string(),
  measure: z.enum(MEASURE_NAMES),
  baseline: z.number(),
  baseline_sd: z.number().nonnegative(),
  target: z.number().nullable(),
  judge_after: z.number().int().positive(),
  version: WorkflowVersion,
  started: z.string().min(1),
})

export const Objective = z.object({
  text: z.string().min(1),
  measures: z.array(z.enum(MEASURE_NAMES)).min(1),
})

export const WorkflowDocument = z
  .object({
    version: WorkflowVersion,
    objective: Objective,
    stages: z.array(WorkStage),
    policies: z.array(WorkPolicy),
    inputs: z.array(WorkItemInput),
    tool_captures: z.array(ToolCapture),
    experiments: z.array(WorkflowExperiment),
  })
  .superRefine((workflow, refinement) => {
    const issue = (message: string) => refinement.addIssue({ code: 'custom', message })
    workflow.stages.forEach((stage, stageIndex) => {
      if (stage.n !== stageIndex + 1) issue(`work stage ${stageIndex + 1} is numbered ${stage.n}`)
      stage.steps.forEach((step, stepIndex) => {
        if (step.n !== stepIndex + 1) issue(`work step ${stage.n}.${stepIndex + 1} is numbered ${stage.n}.${step.n}`)
        for (const ruleRef of step.rules) {
          if (!findRule(workflow, ruleRef)) issue(`work step ${stage.n}.${step.n} references unknown rule "${ruleRef}"`)
        }
      })
    })
    const inputNames = new Set<string>()
    for (const input of workflow.inputs) {
      if (inputNames.has(input.name)) issue(`input "${input.name}" is defined twice`)
      inputNames.add(input.name)
      if (input.set_at !== AT_START) {
        const at = stepPosition(input.set_at)
        if (!at || !workflow.stages[at.stage - 1]?.steps[at.step - 1]) issue(`input "${input.name}" is set at work step ${input.set_at}, which does not exist`)
      }
      const values = input.options.map((option) => option.value)
      if (new Set(values).size !== values.length) issue(`input "${input.name}" repeats an option`)
      if (input.by === 'owner' && values.length > MAX_OWNER_CHOICES) issue(`input "${input.name}" is Owner's to set, so it has at most ${MAX_OWNER_CHOICES} options`)
    }
    for (const stage of workflow.stages) {
      if (stage.if) for (const problem of conditionProblems(workflow, stage.if, { stage: stage.n, step: 0 })) issue(`the if of work stage ${stage.n}: ${problem}`)
      for (const step of stage.steps) {
        if (step.if) for (const problem of conditionProblems(workflow, step.if, { stage: stage.n, step: step.n })) issue(`the if of work step ${stage.n}.${step.n}: ${problem}`)
      }
    }
    const captureNames = new Set<string>()
    for (const capture of workflow.tool_captures) {
      if (captureNames.has(capture.name)) issue(`tool capture "${capture.name}" is defined twice`)
      captureNames.add(capture.name)
      try {
        new RegExp(capture.command)
      } catch {
        issue(`tool capture "${capture.name}": its command ${capture.command} is not a regular expression`)
      }
      try {
        parsePipeline(capture.keep)
      } catch (error) {
        if (!(error instanceof InvalidPipeline)) throw error
        issue(`tool capture "${capture.name}": ${error.message}`)
      }
    }
    const guids = guidsOf(workflow)
    const repeated = guids.find((guid, index) => guids.indexOf(guid) !== index)
    if (repeated) issue(`GUID ${repeated} is used twice`)
  })

/**
 * What is wrong with a condition at `at` (step 0 for a stage's): it may read only known inputs and
 * their options, set before it.
 */
function conditionProblems(workflow: Pick<WorkflowDocument, 'inputs'>, text: string, at: { stage: number; step: number }): string[] {
  let condition
  try {
    condition = parseCondition(text)
  } catch (error) {
    if (error instanceof InvalidCondition) return [error.message]
    throw error
  }
  return comparisonsOf(condition).flatMap((comparison) => {
    const input = workflow.inputs.find((candidate) => candidate.name === comparison.input)
    if (!input) return [`it reads input "${comparison.input}", which does not exist`]
    const options = input.options.map((option) => option.value)
    const problems = comparison.values
      .filter((value) => !options.includes(value))
      .map((value) => `input "${input.name}" has no option "${value}"; its options are ${options.join(', ')}`)
    if (input.set_at !== AT_START && !isSetBefore(stepPosition(input.set_at), at)) problems.push(`it reads input "${input.name}", which is set at work step ${input.set_at}, not before`)
    return problems
  })
}

const isSetBefore = (setAt: { stage: number; step: number } | undefined, at: { stage: number; step: number }) =>
  setAt !== undefined && (setAt.stage < at.stage || (setAt.stage === at.stage && setAt.step < at.step))

const guidsOf = (workflow: Pick<WorkflowDocument, 'stages' | 'policies' | 'inputs' | 'tool_captures'>) => [
  ...workflow.stages.flatMap((stage) => [stage.guid, ...stage.steps.map((step) => step.guid)]),
  ...workflow.policies.flatMap((policy) => [policy.guid, ...policy.rules.map((rule) => rule.guid)]),
  ...workflow.inputs.map((input) => input.guid),
  ...workflow.tool_captures.map((capture) => capture.guid),
]

export type WorkflowDocument = z.infer<typeof WorkflowDocument>
export type WorkStage = z.infer<typeof WorkStage>
export type WorkStep = z.infer<typeof WorkStep>
export type WorkPolicy = z.infer<typeof WorkPolicy>
export type PolicyRule = z.infer<typeof PolicyRule>
export type Objective = z.infer<typeof Objective>
export type WorkItemInput = z.infer<typeof WorkItemInput>
export type ToolCapture = z.infer<typeof ToolCapture>
export type WorkflowExperiment = z.infer<typeof WorkflowExperiment>

export const FIRST_VERSION = '0.0.0'

export const workflowZero = (objective: Objective): WorkflowDocument =>
  WorkflowDocument.parse({ version: FIRST_VERSION, objective, stages: [], policies: [], inputs: [], tool_captures: [], experiments: [] })

export function findRule(workflow: Pick<WorkflowDocument, 'policies'>, ruleRef: string) {
  const [policyName, ruleId] = ruleRef.split(' ')
  const policy = workflow.policies.find((candidate) => candidate.name === policyName)
  const rule = policy?.rules.find((candidate) => candidate.id === ruleId)
  return rule ? { ref: ruleRef, policy: policyName!, ...rule } : undefined
}


/**
 * Reads a workflow document written by any earlier Drillmaster, also from before work item inputs
 * were called metrics (with categories, taken at a step). Missing text becomes an empty
 * string, which the retrospective is asked to fill in. A component without a GUID takes the GUID
 * of the component with its name in `previous`, the version before it, so it is followed across
 * versions; a new one gets a GUID made from its name.
 */
export function migrateWorkflow(raw: unknown, previous?: WorkflowDocument): WorkflowDocument {
  const { storage: _storage, metrics: oldMetrics, ...document } = structuredClone(raw) as Record<string, any>
  const version = toSemver(document.version)
  const used = new Set<string>()
  const guidFor = (existing: unknown, earlier: string | undefined, seed: string) => {
    let guid = typeof existing === 'string' && existing ? existing : earlier && !used.has(earlier) ? earlier : guidFromSeed(seed)
    for (let attempt = 1; used.has(guid); attempt++) guid = guidFromSeed(`${seed}#${attempt}`)
    used.add(guid)
    return guid
  }
  const earlierStage = (name: string) => previous?.stages.find((stage) => stage.name === name)
  const earlierStep = (stageName: string, name: string) =>
    earlierStage(stageName)?.steps.find((step) => step.name === name) ?? previous?.stages.flatMap((stage) => stage.steps).find((step) => step.name === name)
  const earlierPolicy = (name: string) => previous?.policies.find((policy) => policy.name === name)
  return {
    ...document,
    version,
    ...(document.objective ? { objective: { ...document.objective, measures: (document.objective.measures ?? []).map(currentMeasureName) } } : {}),
    stages: (document.stages ?? []).map((stage: Record<string, any>) => ({
      ...stage,
      guid: guidFor(stage.guid, earlierStage(stage.name)?.guid, `stage:${stage.name}`),
      purpose: stage.purpose ?? '',
      steps: (stage.steps ?? []).map((step: Record<string, any>) => ({
        ...step,
        guid: guidFor(step.guid, earlierStep(stage.name, step.name)?.guid, `step:${stage.name}/${step.name}`),
        instruction: step.instruction ?? '',
        rules: (step.rules ?? []).map((ruleRef: string) => ruleRef.replace(/^rule\s+/, '')),
      })),
    })),
    policies: (document.policies ?? []).map((policy: Record<string, any>) => ({
      ...policy,
      guid: guidFor(policy.guid, earlierPolicy(policy.name)?.guid, `policy:${policy.name}`),
      rules: (policy.rules ?? []).map((rule: Record<string, any>) => ({
        ...rule,
        guid: guidFor(rule.guid, earlierPolicy(policy.name)?.rules.find((candidate) => candidate.id === rule.id)?.guid, `rule:${policy.name} ${rule.id}`),
      })),
    })),
    inputs: (document.inputs ?? oldMetrics ?? []).map(({ at, at_step: atStep, categories, ...input }: Record<string, any>) => ({
      ...input,
      // Seeded as a metric, so an input keeps the GUID it had as one.
      guid: guidFor(input.guid, previous?.inputs.find((candidate) => candidate.name === input.name)?.guid, `metric:${input.name}`),
      options: input.options ?? categories,
      set_at: input.set_at ?? atStep ?? (at ? `${at.stage}.${at.step}` : ''),
    })),
    tool_captures: (document.tool_captures ?? []).map((capture: Record<string, any>) => ({
      ...capture,
      guid: guidFor(capture.guid, previous?.tool_captures.find((candidate) => candidate.name === capture.name)?.guid, `capture:${capture.name}`),
    })),
    experiments: (document.experiments ?? []).map((experiment: Record<string, any>) => ({
      hypothesis: '',
      null_hypothesis: '',
      baseline_sd: 0,
      target: null,
      judge_after: 3,
      version,
      ...experiment,
      measure: currentMeasureName(experiment.measure),
    })),
  } as WorkflowDocument
}
