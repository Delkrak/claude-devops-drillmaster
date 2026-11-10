import type { Artifact, DrillmasterEvent, Proposal, WorkTrace } from './events.js'
import { stepGuidAt } from './refs.js'
import { findRule, migrateWorkflow, toSemver, type WorkflowDocument } from './workflow.js'

export interface WorkItemState {
  work_item_id: string
  issue: string
  description: string
  workflow_version: string
  token_hash: string
  stage: number | null
  step: number | null
  pending_gate: { stage: number; step: number; gate: 'drillmaster' | 'owner'; review_failed?: string } | null
  gates_done: boolean
  status: 'active' | 'delivered'
  pr: string | null
  summary: string | null
  artifacts: Artifact[]
  metrics: Record<string, { value: string; by: string; explanation?: string }>
  sessions: string[]
  started_at: string
  traces: number
  reports: number
  rejections: number
  /** GUIDs of the steps whose gate passed, and of the steps skipped. */
  passed_step_guids: string[]
  skipped_step_guids: string[]
  pending_skip: { stage: number; step: number; decided_by: 'drillmaster' | 'owner'; why: string } | null
  last_update: { from_version: string; to_version: string } | null
  post_mortems: ('agent' | 'drillmaster')[]
}

export interface SessionState {
  session_id: string
  work_item_id: string | null
}

export interface RetroState {
  retro_id: string
  at: string
  proposals: Proposal[]
  approved: number[]
  declined: number[]
  applied: number[]
}

export interface ProjectState {
  initialized: boolean
  retros: Record<string, RetroState>
  latestRetroId: string | null
  workflow?: WorkflowDocument
  versions: WorkflowDocument[]
  sessions: Record<string, SessionState>
  workItems: Record<string, WorkItemState>
  ownerAsked: Record<string, string[]>
  traceCount: number
  eventCount: number
}

export function foldState(events: readonly DrillmasterEvent[]): ProjectState {
  const state: ProjectState = {
    initialized: false,
    retros: {},
    latestRetroId: null,
    versions: [],
    sessions: {},
    workItems: {},
    ownerAsked: {},
    traceCount: 0,
    eventCount: 0,
  }
  for (const event of events) {
    state.eventCount++
    switch (event.type) {
      case 'project_initialized': {
        const workflow = migrateWorkflow(event.workflow)
        state.initialized = true
        state.workflow = workflow
        state.versions = [workflow]
        break
      }
      case 'workflow_changed': {
        const workflow = migrateWorkflow(event.workflow, state.workflow)
        state.workflow = workflow
        state.versions.push(workflow)
        if (event.retro_id && event.proposal !== undefined) state.retros[event.retro_id]?.applied.push(event.proposal)
        break
      }
      case 'retrospective_ran':
        state.retros[event.retro_id] = { retro_id: event.retro_id, at: event.at, proposals: event.proposals, approved: [], declined: [], applied: [] }
        state.latestRetroId = event.retro_id
        break
      case 'owner_decided': {
        const retro = state.retros[event.retro_id]
        if (retro) {
          retro.approved = [...new Set([...retro.approved, ...event.approved])]
          retro.declined = [...new Set([...retro.declined, ...event.declined])]
        }
        break
      }
      case 'owner_asked':
        state.ownerAsked[event.tool_use_id] = event.questions
        break
      case 'session_registered':
        state.sessions[event.session_id] ??= { session_id: event.session_id, work_item_id: null }
        break
      case 'work_item_started':
        state.workItems[event.work_item_id] = {
          work_item_id: event.work_item_id,
          issue: event.issue,
          description: event.description ?? '',
          workflow_version: toSemver(event.workflow_version),
          token_hash: event.token_hash,
          stage: event.stage,
          step: event.step,
          pending_gate: null,
          gates_done: event.stage === null,
          status: 'active',
          pr: null,
          summary: null,
          artifacts: [],
          metrics: {},
          sessions: [],
          started_at: event.at,
          traces: 0,
          reports: 0,
          rejections: 0,
          passed_step_guids: [],
          skipped_step_guids: [],
          pending_skip: null,
          last_update: null,
          post_mortems: [],
        }
        break
      case 'work_reported': {
        const item = state.workItems[event.work_item_id]
        if (item) item.reports++
        break
      }
      case 'gate_submitted': {
        const item = state.workItems[event.work_item_id]
        if (item) {
          item.reports++
          if (event.gate !== 'self') item.pending_gate = { stage: event.stage, step: event.step, gate: event.gate }
        }
        break
      }
      case 'gate_verdict': {
        const item = state.workItems[event.work_item_id]
        if (item) {
          item.pending_gate = null
          item.stage = event.next.stage
          item.step = event.next.step
          item.gates_done = event.done
          if (!event.accepted) item.rejections++
          const guid = event.step_guid ?? stepGuidOfItem(state, item, event.stage, event.step)
          if (event.accepted && guid) item.passed_step_guids.push(guid)
        }
        break
      }
      case 'review_failed': {
        const item = state.workItems[event.work_item_id]
        if (item?.pending_gate) item.pending_gate.review_failed = event.error
        break
      }
      case 'work_item_delivered': {
        const item = state.workItems[event.work_item_id]
        if (item) {
          item.status = 'delivered'
          item.pr = event.pr
          item.summary = event.summary ?? null
          item.artifacts = event.artifacts ?? []
        }
        break
      }
      case 'work_item_updated': {
        const item = state.workItems[event.work_item_id]
        if (item) {
          const kept = new Set(event.kept)
          Object.assign(item, {
            workflow_version: event.to_version,
            stage: event.resumes_at.stage,
            step: event.resumes_at.step,
            pending_gate: null,
            gates_done: event.done,
            passed_step_guids: item.passed_step_guids.filter((guid) => kept.has(guid)),
            skipped_step_guids: item.skipped_step_guids.filter((guid) => kept.has(guid)),
            last_update: { from_version: event.from_version, to_version: event.to_version },
          })
        }
        break
      }
      case 'step_skip_requested': {
        const item = state.workItems[event.work_item_id]
        if (item && event.decided_by !== 'self') item.pending_skip = { stage: event.stage, step: event.step, decided_by: event.decided_by, why: event.why }
        break
      }
      case 'step_skip_decided': {
        const item = state.workItems[event.work_item_id]
        if (item) {
          item.pending_skip = null
          const guid = event.step_guid ?? stepGuidOfItem(state, item, event.stage, event.step)
          if (event.accepted) {
            if (guid) item.skipped_step_guids.push(guid)
            item.stage = event.next.stage
            item.step = event.next.step
            item.gates_done = event.done
          }
        }
        break
      }
      case 'metric_recorded': {
        const item = state.workItems[event.work_item_id]
        if (item) item.metrics[event.name] = { value: event.value, by: event.by, ...(event.explanation ? { explanation: event.explanation } : {}) }
        break
      }
      case 'post_mortem_written': {
        const item = state.workItems[event.work_item_id]
        if (item) item.post_mortems.push(event.author)
        break
      }
      case 'session_bound': {
        const session = (state.sessions[event.session_id] ??= { session_id: event.session_id, work_item_id: null })
        session.work_item_id = event.work_item_id
        const item = state.workItems[event.work_item_id]
        if (item && !item.sessions.includes(event.session_id)) item.sessions.push(event.session_id)
        break
      }
      case 'work_trace':
        state.traceCount++
        if (event.work_item_id) {
          const item = state.workItems[event.work_item_id]
          if (item) item.traces++
        }
        break
    }
  }
  return state
}
function stepGuidOfItem(state: ProjectState, item: WorkItemState, stage: number, step: number) {
  const workflow = findVersion(state, item.workflow_version)
  return workflow ? stepGuidAt(workflow, stage, step) : undefined
}

export function firstPosition(workflow: WorkflowDocument): { stage: number | null; step: number | null } {
  const firstStage = workflow.stages.find((stage) => stage.steps.length > 0)
  return firstStage ? { stage: firstStage.n, step: 1 } : { stage: null, step: null }
}

export const findWorkItemByTokenHash = (state: ProjectState, tokenHash: string) =>
  Object.values(state.workItems).find((item) => item.token_hash === tokenHash)
export function workReportsOf(events: readonly DrillmasterEvent[], workItemId: string, atStep?: { stage?: number; step?: number }) {
  return events.filter(
    (event): event is Extract<DrillmasterEvent, { type: 'work_reported' | 'gate_submitted' }> =>
      (event.type === 'work_reported' || event.type === 'gate_submitted') &&
      event.work_item_id === workItemId &&
      (atStep?.stage === undefined || event.stage === atStep.stage) &&
      (atStep?.step === undefined || event.step === atStep.step),
  )
}
export function workTracesOf(events: readonly DrillmasterEvent[], workItemId: string, atStep?: { stage?: number; step?: number }) {
  return events.filter(
    (event): event is WorkTrace =>
      event.type === 'work_trace' &&
      event.work_item_id === workItemId &&
      (atStep?.stage === undefined || event.stage === atStep.stage) &&
      (atStep?.step === undefined || event.step === atStep.step),
  )
}
export type WorkflowView =
  | {
      kind: 'overview'
      version: string
      objective: WorkflowDocument['objective']
      stages: { n: number; name: string; purpose: string; steps: number }[]
      metrics: WorkflowDocument['metrics']
      experiments: WorkflowDocument['experiments']
    }
  | { kind: 'stage'; version: string; stage: { n: number; name: string; purpose: string }; steps: StepView[] }
  | { kind: 'full'; workflow: WorkflowDocument }

export interface StepView {
  n: string
  name: string
  instruction: string
  gate: string
  rules: { ref: string; rule: string; verified_by: string }[]
  report: string[]
}

export interface WorkflowQuery {
  stage?: number
  full?: boolean
  version?: string
}

export const findVersion = (state: ProjectState, version: string) => state.versions.find((candidate) => candidate.version === version)

export class WorkflowQueryError extends Error {}

export function viewWorkflow(state: ProjectState, query: WorkflowQuery): WorkflowView {
  if (!state.workflow) {
    throw new WorkflowQueryError('This project has no workflow yet. Owner sets the objective first (setup).')
  }
  const workflow = query.version === undefined ? state.workflow : findVersion(state, query.version)
  if (!workflow) {
    throw new WorkflowQueryError(`There is no workflow version ${query.version}; the latest is ${state.workflow.version}.`)
  }
  if (query.full) return { kind: 'full', workflow }
  if (query.stage !== undefined) {
    const stage = workflow.stages.find((candidate) => candidate.n === query.stage)
    if (!stage) {
      throw new WorkflowQueryError(
        workflow.stages.length === 0
          ? `Workflow version ${workflow.version} has no work stages yet.`
          : `There is no work stage ${query.stage}; the work stages are 1-${workflow.stages.length}.`,
      )
    }
    return {
      kind: 'stage',
      version: workflow.version,
      stage: { n: stage.n, name: stage.name, purpose: stage.purpose },
      steps: stage.steps.map((step) => ({
        n: `${stage.n}.${step.n}`,
        name: step.name,
        instruction: step.instruction,
        gate: step.gate,
        rules: step.rules.map((ruleRef) => {
          const rule = findRule(workflow, ruleRef)!
          return { ref: ruleRef, rule: rule.rule, verified_by: rule.verified_by }
        }),
        report: step.report,
      })),
    }
  }
  return {
    kind: 'overview',
    version: workflow.version,
    objective: workflow.objective,
    stages: workflow.stages.map((stage) => ({ n: stage.n, name: stage.name, purpose: stage.purpose, steps: stage.steps.length })),
    metrics: workflow.metrics,
    experiments: workflow.experiments,
  }
}
