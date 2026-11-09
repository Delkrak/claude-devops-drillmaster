// The folded state of one project. Every function here is pure: events in, state out.

import type { DrillmasterEvent } from './events.js'
import { findRule, type WorkflowDocument } from './workflow.js'

export interface ProjectState {
  initialized: boolean
  /** The current workflow, or undefined before the project is initialized. */
  workflow?: WorkflowDocument
  /** Every version, by number. */
  versions: WorkflowDocument[]
  eventCount: number
}

export function foldState(events: readonly DrillmasterEvent[]): ProjectState {
  const state: ProjectState = { initialized: false, versions: [], eventCount: 0 }
  for (const event of events) {
    state.eventCount++
    switch (event.type) {
      case 'project_initialized':
        state.initialized = true
        state.workflow = event.workflow
        state.versions = [event.workflow]
        break
      case 'workflow_changed':
        state.workflow = event.workflow
        state.versions.push(event.workflow)
        break
    }
  }
  return state
}

/** What workflow_get returns. It describes the workflow only; work status is elsewhere. */
export type WorkflowView =
  | { kind: 'overview'; version: number; objective: WorkflowDocument['objective']; stages: { n: number; name: string; steps: number }[]; experiments: WorkflowDocument['experiments'] }
  | { kind: 'stage'; version: number; stage: { n: number; name: string }; steps: StepView[] }
  | { kind: 'full'; workflow: WorkflowDocument }

export interface StepView {
  n: string
  name: string
  gate: string
  rules: { ref: string; rule: string; verified_by: string }[]
  report: string[]
}

export interface WorkflowQuery {
  stage?: number
  full?: boolean
  version?: number
}

export class WorkflowQueryError extends Error {}

export function viewWorkflow(state: ProjectState, query: WorkflowQuery): WorkflowView {
  if (!state.workflow) {
    throw new WorkflowQueryError('This project has no workflow yet. Owner sets the objective first (setup).')
  }
  const doc = query.version === undefined ? state.workflow : state.versions[query.version]
  if (!doc) {
    throw new WorkflowQueryError(`There is no workflow version ${query.version}; the latest is ${state.workflow.version}.`)
  }
  if (query.full) return { kind: 'full', workflow: doc }
  if (query.stage !== undefined) {
    const stage = doc.stages.find((s) => s.n === query.stage)
    if (!stage) {
      throw new WorkflowQueryError(
        doc.stages.length === 0
          ? `Workflow version ${doc.version} has no work stages yet.`
          : `There is no work stage ${query.stage}; the work stages are 1-${doc.stages.length}.`,
      )
    }
    return {
      kind: 'stage',
      version: doc.version,
      stage: { n: stage.n, name: stage.name },
      steps: stage.steps.map((step) => ({
        n: `${stage.n}.${step.n}`,
        name: step.name,
        gate: step.gate,
        rules: step.rules.map((ref) => {
          const rule = findRule(doc, ref)!
          return { ref, rule: rule.rule, verified_by: rule.verified_by }
        }),
        report: step.report,
      })),
    }
  }
  return {
    kind: 'overview',
    version: doc.version,
    objective: doc.objective,
    stages: doc.stages.map((s) => ({ n: s.n, name: s.name, steps: s.steps.length })),
    experiments: doc.experiments,
  }
}
