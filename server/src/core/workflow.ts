import { z } from 'zod'
import { MEASURE_NAMES } from './measures.js'

export const GateKind = z.enum(['self', 'drillmaster', 'owner'])

export const WorkStep = z.object({
  n: z.number().int().positive(),
  name: z.string().min(1),
  gate: GateKind,
  rules: z.array(z.string().regex(/^\S+ \S+$/, 'a rule reference is "<policy> <rule id>"')),
  report: z.array(z.string()),
})

export const WorkStage = z.object({
  n: z.number().int().positive(),
  name: z.string().min(1),
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

export const WorkflowExperiment = z.object({
  id: z.number().int().positive(),
  change: z.string().min(1),
  purpose: z.string().min(1),
  measure: z.enum(MEASURE_NAMES),
  baseline: z.number(),
  started: z.string().min(1),
})

export const Objective = z.object({
  text: z.string().min(1),
  measures: z.array(z.enum(MEASURE_NAMES)).min(1),
})

export const WorkflowDocument = z
  .object({
    version: z.number().int().nonnegative(),
    objective: Objective,
    stages: z.array(WorkStage),
    policies: z.array(WorkPolicy),
    experiments: z.array(WorkflowExperiment),
  })
  .superRefine((workflow, refinement) => {
    workflow.stages.forEach((stage, stageIndex) => {
      if (stage.n !== stageIndex + 1) {
        refinement.addIssue({ code: 'custom', message: `work stage ${stageIndex + 1} is numbered ${stage.n}` })
      }
      stage.steps.forEach((step, stepIndex) => {
        if (step.n !== stepIndex + 1) {
          refinement.addIssue({ code: 'custom', message: `work step ${stage.n}.${stepIndex + 1} is numbered ${stage.n}.${step.n}` })
        }
        for (const ruleRef of step.rules) {
          if (!findRule(workflow, ruleRef)) {
            refinement.addIssue({ code: 'custom', message: `work step ${stage.n}.${step.n} references unknown rule "${ruleRef}"` })
          }
        }
      })
    })
  })

export type WorkflowDocument = z.infer<typeof WorkflowDocument>
export type WorkStage = z.infer<typeof WorkStage>
export type WorkStep = z.infer<typeof WorkStep>
export type PolicyRule = z.infer<typeof PolicyRule>
export type Objective = z.infer<typeof Objective>

export const workflowZero = (objective: Objective): WorkflowDocument =>
  WorkflowDocument.parse({ version: 0, objective, stages: [], policies: [], experiments: [] })

export function findRule(workflow: Pick<WorkflowDocument, 'policies'>, ruleRef: string) {
  const [policyName, ruleId] = ruleRef.split(' ')
  const policy = workflow.policies.find((candidate) => candidate.name === policyName)
  const rule = policy?.rules.find((candidate) => candidate.id === ruleId)
  return rule ? { ref: ruleRef, policy: policyName!, ...rule } : undefined
}
