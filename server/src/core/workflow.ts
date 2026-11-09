// The workflow document: one machine-only document per project, folded from the workflow events.
// It holds Owner's objective, the work stages and their work steps, the work policies and the
// running workflow experiments. workflow_0 holds only the objective.

import { z } from 'zod'
import { MEASURE_NAMES } from './measures.js'

export const GateKind = z.enum(['self', 'drillmaster', 'owner'])

export const WorkStep = z.object({
  n: z.number().int().positive(),
  name: z.string().min(1),
  gate: GateKind,
  /** References to specific work policy rules, written "<policy> <rule id>", e.g. "pr 1.1". */
  rules: z.array(z.string().regex(/^\S+ \S+$/, 'a rule reference is "<policy> <rule id>"')),
  /** What Agent must report at this step's gate. */
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
  .superRefine((doc, ctx) => {
    // Work stages and their work steps are numbered and carried out in order: 1, 2, 3 ...
    doc.stages.forEach((stage, i) => {
      if (stage.n !== i + 1) {
        ctx.addIssue({ code: 'custom', message: `work stage ${i + 1} is numbered ${stage.n}` })
      }
      stage.steps.forEach((step, j) => {
        if (step.n !== j + 1) {
          ctx.addIssue({
            code: 'custom',
            message: `work step ${stage.n}.${j + 1} is numbered ${stage.n}.${step.n}`,
          })
        }
        // A work gate references specific rules that must exist.
        for (const ref of step.rules) {
          if (!findRule(doc, ref)) {
            ctx.addIssue({
              code: 'custom',
              message: `work step ${stage.n}.${step.n} references unknown rule "${ref}"`,
            })
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

/** workflow_0: the first workflow holds only Owner's objective. */
export const workflowZero = (objective: Objective): WorkflowDocument =>
  WorkflowDocument.parse({ version: 0, objective, stages: [], policies: [], experiments: [] })

/** Resolves a rule reference like "pr 1.1" to its rule. */
export function findRule(doc: Pick<WorkflowDocument, 'policies'>, ref: string) {
  const [policyName, ruleId] = ref.split(' ')
  const policy = doc.policies.find((p) => p.name === policyName)
  const rule = policy?.rules.find((r) => r.id === ruleId)
  return rule ? { ref, policy: policyName!, ...rule } : undefined
}
