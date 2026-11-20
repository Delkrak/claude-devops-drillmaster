import type { DrillmasterEvent, RetrospectiveRan, WorkflowChanged } from './events.js'
import { judgeExperiment } from './experiments.js'
import { measureDeliveredItems } from './measures.js'
import { stepName } from './refs.js'
import { foldState } from './state.js'
import { canonicalJson, stepUnchanged } from './updates.js'
import type { WorkflowDocument } from './workflow.js'

/** One thing a change did to the workflow: a step or rule that is new, changed, moved or removed. */
export interface WorkflowEdit {
  what: 'new' | 'changed' | 'moved' | 'removed'
  kind: 'step' | 'rule'
  /** "step 3.1" or "rule test 1.2", as it is called after the change (before it, when removed). */
  ref: string
  /** The step's name or the rule's text. */
  name: string
  /** Where a moved step was before. */
  was: string | null
}

/** A change to the workflow, and whether it did what it was for. */
export interface ChangeRow {
  at: string
  /** Null for an event written before Drillmaster recorded the version it was made on. */
  from_version: string | null
  version: string
  change: string
  /** Why it was made: the purpose the retrospective gave it. Null for a change made outside one. */
  purpose: string | null
  hypothesis: string | null
  measure: string | null
  /** The measure over the work items before the change, and over those counted since. */
  before: number | null
  after: number | null
  counted: number
  judge_after: number | null
  /** keep: it made the measure better beyond chance; rethink: it did not show that; running: too few items yet. */
  verdict: 'keep' | 'rethink' | 'running' | null
  edits: WorkflowEdit[]
}

const stepsOf = (workflow: WorkflowDocument) => workflow.stages.flatMap((stage) => stage.steps.map((step) => ({ ref: stepName(stage.n, step.n), step })))
const rulesOf = (workflow: WorkflowDocument) => workflow.policies.flatMap((policy) => policy.rules.map((rule) => ({ ref: `${policy.name} ${rule.id}`, rule })))

/** What a change did to the steps and rules of the workflow, matched by GUID. */
export function workflowEdits(from: WorkflowDocument, to: WorkflowDocument): WorkflowEdit[] {
  const edits: WorkflowEdit[] = []
  const stepsBefore = stepsOf(from)
  for (const { ref, step } of stepsOf(to)) {
    const earlier = stepsBefore.find((candidate) => candidate.step.guid === step.guid)
    if (!earlier) edits.push({ what: 'new', kind: 'step', ref: `step ${ref}`, name: step.name, was: null })
    else if (!stepUnchanged(from, to, step.guid)) edits.push({ what: 'changed', kind: 'step', ref: `step ${ref}`, name: step.name, was: earlier.ref !== ref ? `step ${earlier.ref}` : null })
    else if (earlier.ref !== ref) edits.push({ what: 'moved', kind: 'step', ref: `step ${ref}`, name: step.name, was: `step ${earlier.ref}` })
  }
  const stepsAfter = new Set(stepsOf(to).map(({ step }) => step.guid))
  for (const { ref, step } of stepsBefore) if (!stepsAfter.has(step.guid)) edits.push({ what: 'removed', kind: 'step', ref: `step ${ref}`, name: step.name, was: null })
  const rulesBefore = rulesOf(from)
  for (const { ref, rule } of rulesOf(to)) {
    const earlier = rulesBefore.find((candidate) => candidate.rule.guid === rule.guid)
    if (!earlier) edits.push({ what: 'new', kind: 'rule', ref: `rule ${ref}`, name: rule.rule, was: null })
    else if (canonicalJson(earlier.rule) !== canonicalJson(rule)) edits.push({ what: 'changed', kind: 'rule', ref: `rule ${ref}`, name: rule.rule, was: null })
  }
  const rulesAfter = new Set(rulesOf(to).map(({ rule }) => rule.guid))
  for (const { ref, rule } of rulesBefore) if (!rulesAfter.has(rule.guid)) edits.push({ what: 'removed', kind: 'rule', ref: `rule ${ref}`, name: rule.rule, was: null })
  return edits
}

/** Every change to the workflow up to `at` (or now), latest first, each with its measure before and after. */
export function changesView(events: readonly DrillmasterEvent[], at?: string): ChangeRow[] {
  const seen = at ? events.filter((event) => event.at <= at) : events
  const state = foldState(seen)
  const delivered = measureDeliveredItems(seen)
  const retrospectives = seen.filter((event): event is RetrospectiveRan => event.type === 'retrospective_ran')
  const changes = seen.filter((event): event is WorkflowChanged => event.type === 'workflow_changed')
  return changes
    .flatMap((event): ChangeRow[] => {
      // The workflow the change produced is the version after the one it was made on.
      const index = state.versions.findIndex((version) => version.version === event.workflow_version)
      const from = state.versions[index]
      const to = state.versions[index + 1]
      // Writing the first workflow, as setup or a seed does, changes nothing that was there.
      if (index < 0 || !from || !to) return []
      const proposal = retrospectives.find((retro) => retro.retro_id === event.retro_id)?.proposals.find((candidate) => candidate.id === event.proposal)
      const experiment = to.experiments.find((candidate) => candidate.version === to.version)
      const judged = experiment ? judgeExperiment(experiment, delivered, [], to) : undefined
      return [{
        at: event.at,
        from_version: event.workflow_version ?? null,
        version: to.version,
        change: event.reason,
        purpose: proposal?.purpose ?? null,
        hypothesis: experiment?.hypothesis || proposal?.hypothesis || null,
        measure: experiment?.measure ?? null,
        before: judged?.baseline ?? null,
        after: judged?.mean ?? null,
        counted: judged ? Math.min(judged.counted, judged.judge_after) : 0,
        judge_after: judged?.judge_after ?? null,
        verdict: judged?.status ?? null,
        edits: workflowEdits(from, to),
      }]
    })
    .reverse()
}
