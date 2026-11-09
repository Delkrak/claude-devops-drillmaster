import { averageMeasure, type ItemMeasures } from './measures.js'
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
}

/**
 * Every measure is lower-is-better. The null hypothesis (the change makes no difference) is
 * rejected when the mean over the first `judge_after` items beats the baseline by more than the
 * baseline's standard deviation.
 */
export function judgeExperiment(experiment: WorkflowExperiment, deliveredItems: readonly ItemMeasures[], overlapping: number[] = []): ExperimentVerdict {
  const countedItems = deliveredItems.filter((item) => compareVersions(item.workflow_version, experiment.version) >= 0)
  const judgedItems = countedItems.slice(0, experiment.judge_after)
  const mean = averageMeasure(judgedItems, experiment.measure)
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
  }
  if (judgedItems.length < experiment.judge_after || mean === null) return verdict
  const nullRejected = mean < experiment.baseline - experiment.baseline_sd
  const targetMet = experiment.target === null || mean <= experiment.target
  return { ...verdict, null_rejected: nullRejected, target_met: targetMet, status: nullRejected && targetMet ? 'keep' : 'rethink' }
}

export function judgeExperiments(workflow: WorkflowDocument, deliveredItems: readonly ItemMeasures[]) {
  return workflow.experiments.map((experiment) => {
    const overlapping = workflow.experiments.filter((other) => other.id !== experiment.id && other.measure === experiment.measure).map((other) => other.id)
    return judgeExperiment(experiment, deliveredItems, overlapping)
  })
}

export const experimentsReadyToJudge = (workflow: WorkflowDocument, deliveredItems: readonly ItemMeasures[]) =>
  judgeExperiments(workflow, deliveredItems).filter((verdict) => verdict.status !== 'running')
