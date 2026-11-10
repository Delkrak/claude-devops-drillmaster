import type { DrillmasterEvent } from './events.js'
import { judgeExperiments } from './experiments.js'
import { averageMeasure, BASELINE_WINDOW, measureDeliveredItems, splitMeasureByMetric, type ItemMeasures } from './measures.js'
import { findVersion, foldState, type ProjectState } from './state.js'

export interface ProjectSummary {
  id: string
  dir: string
  objective: string
  workflow_version: string
  work_items: number
  active: number
  last_activity: string | null
}

export type ProposalStatus = 'applied' | 'approved' | 'declined' | 'open'

const lastEventAt = (events: readonly DrillmasterEvent[]) => events.at(-1)?.at ?? null

export function summarizeProject(projectId: string, events: readonly DrillmasterEvent[]): ProjectSummary | undefined {
  const initEvent = events.find((event) => event.type === 'project_initialized')
  if (!initEvent || initEvent.type !== 'project_initialized') return undefined
  const state = foldState(events)
  const items = Object.values(state.workItems)
  return {
    id: projectId,
    dir: initEvent.dir,
    objective: state.workflow!.objective.text,
    workflow_version: state.workflow!.version,
    work_items: items.length,
    active: items.filter((item) => item.status === 'active').length,
    last_activity: lastEventAt(events),
  }
}

function retrospectiveViewsNewestFirst(state: ProjectState, events: readonly DrillmasterEvent[]) {
  return events
    .filter((event): event is Extract<DrillmasterEvent, { type: 'retrospective_ran' }> => event.type === 'retrospective_ran')
    .map((retroEvent) => {
      const retro = state.retros[retroEvent.retro_id]!
      const proposalStatus = (proposalId: number): ProposalStatus =>
        retro.applied.includes(proposalId) ? 'applied' : retro.approved.includes(proposalId) ? 'approved' : retro.declined.includes(proposalId) ? 'declined' : 'open'
      const decisions = events
        .filter((event): event is Extract<DrillmasterEvent, { type: 'owner_decided' }> => event.type === 'owner_decided' && event.retro_id === retroEvent.retro_id)
        .map((decision) => ({ at: decision.at, prompt: decision.prompt }))
      return {
        retro_id: retroEvent.retro_id,
        at: retroEvent.at,
        work_items: retroEvent.work_items,
        findings: retroEvent.findings,
        proposals: retroEvent.proposals.map((proposal) => ({ ...proposal, status: proposalStatus(proposal.id) })),
        decisions,
      }
    })
    .reverse()
}

export function projectView(projectId: string, events: readonly DrillmasterEvent[]) {
  const summary = summarizeProject(projectId, events)
  if (!summary) return undefined
  const state = foldState(events)
  const measuresByItemId = new Map<string, ItemMeasures>(measureDeliveredItems(events).map((measured) => [measured.work_item_id, measured]))
  const deliveredItems = [...measuresByItemId.values()]
  const workflow = state.workflow!
  return {
    summary,
    workflow,
    versions: events
      .filter((event): event is Extract<DrillmasterEvent, { type: 'project_initialized' | 'workflow_changed' }> => event.type === 'project_initialized' || event.type === 'workflow_changed')
      .map((event, index) => ({
        version: state.versions[index]!.version,
        at: event.at,
        reason: event.type === 'workflow_changed' ? event.reason : "Owner's objective (workflow 0.0.0)",
        workflow: state.versions[index]!,
      })),
    measures: workflow.objective.measures.map((measure) => ({
      name: measure,
      last_5: averageMeasure(deliveredItems.slice(-BASELINE_WINDOW), measure),
      all: averageMeasure(deliveredItems, measure),
      per_item: deliveredItems.map((item) => ({ work_item_id: item.work_item_id, issue: item.issue, value: item.values[measure] })),
      by_metric: workflow.metrics.map((metric) => ({ metric: metric.name, categories: splitMeasureByMetric(deliveredItems, measure, metric.name) })),
    })),
    work_items: Object.values(state.workItems)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .map((item) => ({
        work_item_id: item.work_item_id,
        issue: item.issue,
        status: item.status,
        stage: item.stage,
        step: item.step,
        pending_gate: item.pending_gate,
        workflow_version: item.workflow_version,
        started_at: item.started_at,
        pr: item.pr,
        reports: item.reports,
        traces: item.traces,
        rejections: item.rejections,
        post_mortems: item.post_mortems,
        added_steps: events.filter((event) => event.type === 'work_reported' && event.work_item_id === item.work_item_id && event.kind === 'added_step').length,
        measures: measuresByItemId.get(item.work_item_id)?.values ?? null,
      })),
    retrospectives: retrospectiveViewsNewestFirst(state, events),
    sessions: Object.values(state.sessions),
    experiment_verdicts: judgeExperiments(state.workflow!, measureDeliveredItems(events)),
  }
}

function withoutSecrets(event: DrillmasterEvent) {
  if (event.type === 'work_trace') {
    const { raw: _raw, ...trace } = event
    return trace
  }
  if (event.type === 'work_item_started') {
    const { token_hash: _tokenHash, ...started } = event
    return started
  }
  return event
}

export function workItemView(events: readonly DrillmasterEvent[], workItemId: string) {
  const state = foldState(events)
  const item = state.workItems[workItemId]
  if (!item) return undefined
  const { token_hash: _tokenHash, ...itemWithoutHash } = item
  const timeline = events.filter((event) => 'work_item_id' in event && event.work_item_id === workItemId).map(withoutSecrets)
  return {
    item: itemWithoutHash,
    workflow: findVersion(state, item.workflow_version),
    measures: measureDeliveredItems(events).find((measured) => measured.work_item_id === workItemId)?.values ?? null,
    timeline,
    post_mortems: timeline.filter((event) => event.type === 'post_mortem_written'),
  }
}
