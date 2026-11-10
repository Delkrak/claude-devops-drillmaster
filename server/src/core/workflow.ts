import { z } from 'zod'
import { MEASURE_NAMES } from './measures.js'
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
export const MetricTaker = z.enum(['agent', 'drillmaster', 'owner'])

export const SEMVER = /^\d+\.\d+\.\d+$/
export const WorkflowVersion = z.string().regex(SEMVER, 'a workflow version is major.minor.patch')
export type { VersionLevel } from './versions.js'

const Guid = z.string().min(1)
const StepName = z.string().regex(/^\d+\.\d+$/, 'a work step is written <stage>.<step>, e.g. "1.2"')

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
})

export const WorkStage = z.object({
  guid: Guid,
  n: z.number().int().positive(),
  name: z.string().min(1),
  purpose: z.string(),
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

export const MetricCategory = z.object({ value: z.string().min(1), description: z.string().min(1) })

export const WorkflowMetric = z.object({
  guid: Guid,
  name: z.string().regex(/^\S+$/, 'a metric name has no spaces'),
  categories: z.array(MetricCategory).min(2),
  at_step: StepName,
  by: MetricTaker,
  instruction: z.string().min(1),
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
    metrics: z.array(WorkflowMetric),
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
    const metricNames = new Set<string>()
    for (const metric of workflow.metrics) {
      if (metricNames.has(metric.name)) issue(`metric "${metric.name}" is defined twice`)
      metricNames.add(metric.name)
      const at = stepPosition(metric.at_step)
      if (!at || !workflow.stages[at.stage - 1]?.steps[at.step - 1]) {
        issue(`metric "${metric.name}" is taken at work step ${metric.at_step}, which does not exist`)
      }
      const values = metric.categories.map((category) => category.value)
      if (new Set(values).size !== values.length) issue(`metric "${metric.name}" repeats a category value`)
      if (metric.by === 'owner' && values.length > MAX_OWNER_CHOICES) issue(`metric "${metric.name}" is Owner's to take, so it has at most ${MAX_OWNER_CHOICES} categories`)
    }
    const guids = guidsOf(workflow)
    const repeated = guids.find((guid, index) => guids.indexOf(guid) !== index)
    if (repeated) issue(`GUID ${repeated} is used twice`)
  })

const guidsOf = (workflow: Pick<WorkflowDocument, 'stages' | 'policies' | 'metrics'>) => [
  ...workflow.stages.flatMap((stage) => [stage.guid, ...stage.steps.map((step) => step.guid)]),
  ...workflow.policies.flatMap((policy) => [policy.guid, ...policy.rules.map((rule) => rule.guid)]),
  ...workflow.metrics.map((metric) => metric.guid),
]

export type WorkflowDocument = z.infer<typeof WorkflowDocument>
export type WorkStage = z.infer<typeof WorkStage>
export type WorkStep = z.infer<typeof WorkStep>
export type WorkPolicy = z.infer<typeof WorkPolicy>
export type PolicyRule = z.infer<typeof PolicyRule>
export type Objective = z.infer<typeof Objective>
export type WorkflowMetric = z.infer<typeof WorkflowMetric>
export type WorkflowExperiment = z.infer<typeof WorkflowExperiment>

export const FIRST_VERSION = '0.0.0'

export const workflowZero = (objective: Objective): WorkflowDocument =>
  WorkflowDocument.parse({ version: FIRST_VERSION, objective, stages: [], policies: [], metrics: [], experiments: [] })

export function findRule(workflow: Pick<WorkflowDocument, 'policies'>, ruleRef: string) {
  const [policyName, ruleId] = ruleRef.split(' ')
  const policy = workflow.policies.find((candidate) => candidate.name === policyName)
  const rule = policy?.rules.find((candidate) => candidate.id === ruleId)
  return rule ? { ref: ruleRef, policy: policyName!, ...rule } : undefined
}


/**
 * Reads a workflow document written by any earlier Drillmaster. Missing text becomes an empty
 * string, which the retrospective is asked to fill in. A component without a GUID takes the GUID
 * of the component with its name in `previous`, the version before it, so it is followed across
 * versions; a new one gets a GUID made from its name.
 */
export function migrateWorkflow(raw: unknown, previous?: WorkflowDocument): WorkflowDocument {
  const { storage: _storage, ...document } = structuredClone(raw) as Record<string, any>
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
    metrics: (document.metrics ?? []).map(({ at, ...metric }: Record<string, any>) => ({
      ...metric,
      guid: guidFor(metric.guid, previous?.metrics.find((candidate) => candidate.name === metric.name)?.guid, `metric:${metric.name}`),
      at_step: metric.at_step ?? (at ? `${at.stage}.${at.step}` : ''),
    })),
    experiments: (document.experiments ?? []).map((experiment: Record<string, any>) => ({
      hypothesis: '',
      null_hypothesis: '',
      baseline_sd: 0,
      target: null,
      judge_after: 3,
      version,
      ...experiment,
    })),
  } as WorkflowDocument
}
