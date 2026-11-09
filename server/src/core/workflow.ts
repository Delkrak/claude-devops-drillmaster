import { z } from 'zod'
import { MEASURE_NAMES } from './measures.js'
import { toSemver } from './versions.js'

export { bumpVersion, compareVersions, isMajorChange, toSemver } from './versions.js'

export const GateKind = z.enum(['self', 'drillmaster', 'owner'])
export const MetricTaker = z.enum(['agent', 'drillmaster', 'owner'])

export const SEMVER = /^\d+\.\d+\.\d+$/
export const WorkflowVersion = z.string().regex(SEMVER, 'a workflow version is major.minor.patch')
export type { VersionLevel } from './versions.js'

export const WorkStep = z.object({
  n: z.number().int().positive(),
  name: z.string().min(1),
  instruction: z.string(),
  gate: GateKind,
  rules: z.array(z.string().regex(/^\S+ \S+$/, 'a rule reference is "<policy> <rule id>"')),
  report: z.array(z.string()),
})

export const WorkStage = z.object({
  n: z.number().int().positive(),
  name: z.string().min(1),
  purpose: z.string(),
  steps: z.array(WorkStep),
})

export const PolicyRule = z.object({
  id: z.string().min(1),
  rule: z.string().min(1),
  verified_by: z.string().min(1),
})

export const WorkPolicy = z.object({
  name: z.string().regex(/^\S+$/, 'a work policy name has no spaces'),
  rules: z.array(PolicyRule),
})

export const MetricCategory = z.object({ value: z.string().min(1), description: z.string().min(1) })

export const WorkflowMetric = z.object({
  name: z.string().regex(/^\S+$/, 'a metric name has no spaces'),
  categories: z.array(MetricCategory).min(2),
  at: z.object({ stage: z.number().int().positive(), step: z.number().int().positive() }),
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

export const WorkflowStorage = z.object({
  repo: z.string().min(1),
  path: z.string().min(1),
  branch: z.object({ pattern: z.string().includes('{work_item_id}') }),
})

export const WorkflowDocument = z
  .object({
    version: WorkflowVersion,
    objective: Objective,
    storage: WorkflowStorage.optional(),
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
      if (!workflow.stages[metric.at.stage - 1]?.steps[metric.at.step - 1]) {
        issue(`metric "${metric.name}" is taken at work step ${metric.at.stage}.${metric.at.step}, which does not exist`)
      }
      const values = metric.categories.map((category) => category.value)
      if (new Set(values).size !== values.length) issue(`metric "${metric.name}" repeats a category value`)
    }
  })

export type WorkflowDocument = z.infer<typeof WorkflowDocument>
export type WorkStage = z.infer<typeof WorkStage>
export type WorkStep = z.infer<typeof WorkStep>
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
 * string, which the retrospective is asked to fill in.
 */
export function migrateWorkflow(raw: unknown): WorkflowDocument {
  const document = structuredClone(raw) as Record<string, any>
  const version = toSemver(document.version)
  return {
    ...document,
    version,
    stages: (document.stages ?? []).map((stage: Record<string, any>) => ({
      ...stage,
      purpose: stage.purpose ?? '',
      steps: (stage.steps ?? []).map((step: Record<string, any>) => ({ ...step, instruction: step.instruction ?? '' })),
    })),
    policies: document.policies ?? [],
    metrics: document.metrics ?? [],
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
