// The folded state of one project. Every function here is pure: events in, state out.

import type { DrillmasterEvent, WorkTrace } from './events.js'
import { findRule, type WorkflowDocument } from './workflow.js'

export interface WorkItemState {
  work_item_id: string
  issue: string
  workflow_version: number
  token_hash: string
  stage: number | null
  step: number | null
  sessions: string[]
  started_at: string
  traces: number
}

export interface SessionState {
  session_id: string
  /** The work item the session is bound to now, if any. */
  work_item_id: string | null
}

export interface ProjectState {
  initialized: boolean
  /** The current workflow, or undefined before the project is initialized. */
  workflow?: WorkflowDocument
  /** Every version, by number. */
  versions: WorkflowDocument[]
  sessions: Record<string, SessionState>
  workItems: Record<string, WorkItemState>
  traces: number
  eventCount: number
}

export function foldState(events: readonly DrillmasterEvent[]): ProjectState {
  const state: ProjectState = { initialized: false, versions: [], sessions: {}, workItems: {}, traces: 0, eventCount: 0 }
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
      case 'session_registered':
        state.sessions[event.session_id] ??= { session_id: event.session_id, work_item_id: null }
        break
      case 'work_item_started':
        state.workItems[event.work_item_id] = {
          work_item_id: event.work_item_id,
          issue: event.issue,
          workflow_version: event.workflow_version,
          token_hash: event.token_hash,
          stage: event.stage,
          step: event.step,
          sessions: [],
          started_at: event.at,
          traces: 0,
        }
        break
      case 'session_bound': {
        const session = (state.sessions[event.session_id] ??= { session_id: event.session_id, work_item_id: null })
        session.work_item_id = event.work_item_id
        const item = state.workItems[event.work_item_id]
        if (item && !item.sessions.includes(event.session_id)) item.sessions.push(event.session_id)
        break
      }
      case 'work_trace':
        state.traces++
        if (event.work_item_id) {
          const item = state.workItems[event.work_item_id]
          if (item) item.traces++
        }
        break
    }
  }
  return state
}

/** The work item whose token hashes to `tokenHash`. */
export const itemByTokenHash = (state: ProjectState, tokenHash: string) =>
  Object.values(state.workItems).find((item) => item.token_hash === tokenHash)

/** The work traces of one work item, optionally only those captured at one work step. */
export function tracesOf(events: readonly DrillmasterEvent[], workItemId: string, at?: { stage?: number; step?: number }) {
  return events.filter(
    (e): e is WorkTrace =>
      e.type === 'work_trace' &&
      e.work_item_id === workItemId &&
      (at?.stage === undefined || e.stage === at.stage) &&
      (at?.step === undefined || e.step === at.step),
  )
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
