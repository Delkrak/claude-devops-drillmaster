import type { DrillmasterEvent, RetrospectiveRan, WorkflowChanged } from './events.js'
import { judgeExperiment } from './experiments.js'
import { measureDeliveredItems } from './measures.js'
import { stepName } from './refs.js'
import { foldState } from './state.js'
import { canonicalJson, stepUnchanged } from './updates.js'
import type { WorkflowDocument } from './workflow.js'

export interface WorkflowEdit {
  what: 'new' | 'changed' | 'moved' | 'removed'
  kind: 'step' | 'rule'
  ref: string
  name: string
  was: string | null
}

export interface ChangeRow {
  at: string
  /** Null for an event written before Drillmaster recorded the version it was made on. */
  from_version: string | null
  version: string
  change: string
  purpose: string | null
  hypothesis: string | null
  measure: string | null
  before: number | null
  before_sd: number | null
  /** How many work items the baseline came from, when fewer than five: a weak baseline. */
  before_items: number | null
  after: number | null
  counted: number
  judge_after: number | null
  outcome: 'significant' | 'below target' | 'not significant' | 'insufficient data' | null
  edits: WorkflowEdit[]
}

const stepsOf = (workflow: WorkflowDocument) => workflow.stages.flatMap((stage) => stage.steps.map((step) => ({ ref: stepName(stage.n, step.n), step })))
const rulesOf = (workflow: WorkflowDocument) => workflow.policies.flatMap((policy) => policy.rules.map((rule) => ({ ref: `${policy.name} ${rule.id}`, rule })))

export function workflowEdits(from: WorkflowDocument, to: WorkflowDocument): WorkflowEdit[] {
  const edits: WorkflowEdit[] = []
  const stepsBefore = stepsOf(from)
  for (const { ref, step } of stepsOf(to)) {
    const earlierStep = stepsBefore.find((candidate) => candidate.step.guid === step.guid)
    if (!earlierStep) edits.push({ what: 'new', kind: 'step', ref: `step ${ref}`, name: step.name, was: null })
    else if (!stepUnchanged(from, to, step.guid)) edits.push({ what: 'changed', kind: 'step', ref: `step ${ref}`, name: step.name, was: earlierStep.ref !== ref ? `step ${earlierStep.ref}` : null })
    else if (earlierStep.ref !== ref) edits.push({ what: 'moved', kind: 'step', ref: `step ${ref}`, name: step.name, was: `step ${earlierStep.ref}` })
  }
  const stepGuidsAfter = new Set(stepsOf(to).map(({ step }) => step.guid))
  for (const { ref, step } of stepsBefore) if (!stepGuidsAfter.has(step.guid)) edits.push({ what: 'removed', kind: 'step', ref: `step ${ref}`, name: step.name, was: null })
  const rulesBefore = rulesOf(from)
  for (const { ref, rule } of rulesOf(to)) {
    const earlierRule = rulesBefore.find((candidate) => candidate.rule.guid === rule.guid)
    if (!earlierRule) edits.push({ what: 'new', kind: 'rule', ref: `rule ${ref}`, name: rule.rule, was: null })
    else if (canonicalJson(earlierRule.rule) !== canonicalJson(rule)) edits.push({ what: 'changed', kind: 'rule', ref: `rule ${ref}`, name: rule.rule, was: null })
  }
  const ruleGuidsAfter = new Set(rulesOf(to).map(({ rule }) => rule.guid))
  for (const { ref, rule } of rulesBefore) if (!ruleGuidsAfter.has(rule.guid)) edits.push({ what: 'removed', kind: 'rule', ref: `rule ${ref}`, name: rule.rule, was: null })
  return edits
}

export function changesView(events: readonly DrillmasterEvent[], at?: string): ChangeRow[] {
  const eventsUntilAt = at ? events.filter((event) => event.at <= at) : events
  const state = foldState(eventsUntilAt)
  const deliveredItems = measureDeliveredItems(eventsUntilAt)
  const retrospectives = eventsUntilAt.filter((event): event is RetrospectiveRan => event.type === 'retrospective_ran')
  // Each change adds one version after the project's first workflow: the i-th runs from version i to
  // version i + 1, also for events written before they recorded the version they were made on.
  const eventsSinceStart = eventsUntilAt.slice(eventsUntilAt.findLastIndex((event) => event.type === 'project_initialized') + 1)
  const changes = eventsSinceStart.filter((event): event is WorkflowChanged => event.type === 'workflow_changed')
  return changes
    .flatMap((change, index): ChangeRow[] => {
      const from = state.versions[index]
      const to = state.versions[index + 1]
      // Writing the first steps, as setup or a seed does, changes nothing that was there.
      if (!from || !to || from.stages.length === 0) return []
      const proposal = retrospectives.find((retro) => retro.retro_id === change.retro_id)?.proposals.find((candidate) => candidate.id === change.proposal)
      const experiment = to.experiments.find((candidate) => candidate.version === to.version)
      const verdict = experiment ? judgeExperiment(experiment, deliveredItems, [], to) : undefined
      return [{
        at: change.at,
        from_version: change.workflow_version ?? null,
        version: to.version,
        change: change.reason,
        purpose: proposal?.purpose ?? null,
        hypothesis: experiment?.hypothesis || proposal?.hypothesis || null,
        measure: experiment?.measure ?? null,
        before: verdict?.baseline ?? null,
        before_sd: verdict?.baseline_sd ?? null,
        before_items: verdict?.baseline_items ?? null,
        after: verdict?.mean ?? null,
        counted: verdict ? Math.min(verdict.counted, verdict.judge_after) : 0,
        judge_after: verdict?.judge_after ?? null,
        outcome: !verdict ? null : verdict.status === 'running' ? 'insufficient data' : !verdict.null_rejected ? 'not significant' : verdict.target_met ? 'significant' : 'below target',
        edits: workflowEdits(from, to),
      }]
    })
    .reverse()
}
