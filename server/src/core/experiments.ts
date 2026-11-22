import { averageMeasure, measureBaseline, measureBaselineSd, rejectionsByRule, type ItemMeasures } from './measures.js'
import { refOfGuid } from './refs.js'
import { compareVersions, type WorkflowDocument, type WorkflowExperiment } from './workflow.js'

export interface ExperimentVerdict {
  id: number
  change: string
  measure: string
  status: 'running' | 'keep' | 'rethink'
  counted: number
  judge_after: number
  baseline: number
  baseline_sd: number
  mean: number | null
  target: number | null
  null_rejected: boolean | null
  target_met: boolean | null
  overlapping: number[]
  /** The steps an item must go through to count, by name; none when every item counts. */
  through_steps: string[]
  /** Rejections citing the rules of those steps, over the judged items. */
  rule_rejections: Record<string, number>
}

/** The delivered items an experiment counts: on its version or later, and through a step its change touched. */
export const itemsCountedFor = (experiment: WorkflowExperiment, deliveredItems: readonly ItemMeasures[]) =>
  deliveredItems.filter(
    (item) =>
      compareVersions(item.workflow_version, experiment.version) >= 0 &&
      (!experiment.affects?.length || item.passed_step_guids.some((guid) => experiment.affects!.includes(guid))),
  )

/**
 * Every measure is lower-is-better. The null hypothesis (the change makes no difference) is
 * rejected when the mean over the first `judge_after` items beats the baseline by more than the
 * baseline's standard deviation.
 */
export function judgeExperiment(experimentAsWritten: WorkflowExperiment, deliveredItems: readonly ItemMeasures[], overlapping: number[] = [], workflow?: WorkflowDocument): ExperimentVerdict {
  const before = deliveredItems.filter((item) => compareVersions(item.workflow_version, experimentAsWritten.version) < 0)
  const experiment = experimentAsWritten.rebaseline
    ? { ...experimentAsWritten, baseline: measureBaseline(before, experimentAsWritten.measure), baseline_sd: measureBaselineSd(before, experimentAsWritten.measure) }
    : experimentAsWritten
  const countedItems = itemsCountedFor(experiment, deliveredItems)
  const judgedItems = countedItems.slice(0, experiment.judge_after)
  const mean = averageMeasure(judgedItems, experiment.measure)
  const affects = experiment.affects ?? []
  const throughSteps = workflow ? affects.flatMap((guid) => refOfGuid(workflow, guid)?.name ?? []) : []
  const touchedRules = new Set(workflow ? workflow.stages.flatMap((stage) => stage.steps).filter((step) => affects.includes(step.guid)).flatMap((step) => step.rules) : [])
  const ruleRejections = Object.fromEntries([...touchedRules].map((rule) => [rule, rejectionsByRule(judgedItems)[rule] ?? 0]))
  const verdict: ExperimentVerdict = {
    id: experiment.id,
    change: experiment.change,
    measure: experiment.measure,
    status: 'running',
    counted: countedItems.length,
    judge_after: experiment.judge_after,
    baseline: experiment.baseline,
    baseline_sd: experiment.baseline_sd,
    mean,
    target: experiment.target,
    null_rejected: null,
    target_met: null,
    overlapping,
    through_steps: throughSteps,
    rule_rejections: ruleRejections,
  }
  if (judgedItems.length < experiment.judge_after || mean === null) return verdict
  const nullRejected = mean < experiment.baseline - experiment.baseline_sd
  const targetMet = experiment.target === null || mean <= experiment.target
  return { ...verdict, null_rejected: nullRejected, target_met: targetMet, status: nullRejected && targetMet ? 'keep' : 'rethink' }
}

export function judgeExperiments(workflow: WorkflowDocument, deliveredItems: readonly ItemMeasures[]) {
  return workflow.experiments.map((experiment) => {
    const overlapping = workflow.experiments.filter((other) => other.id !== experiment.id && other.measure === experiment.measure).map((other) => other.id)
    return judgeExperiment(experiment, deliveredItems, overlapping, workflow)
  })
}

export const experimentsReadyToJudge = (workflow: WorkflowDocument, deliveredItems: readonly ItemMeasures[]) =>
  judgeExperiments(workflow, deliveredItems).filter((verdict) => verdict.status !== 'running')
