// Read-only views for the human viewer. Pure: events in, what a page shows out.

import type { DrillmasterEvent } from './events.js'
import { average, measureItems, type ItemMeasures } from './measures.js'
import { foldState, type ProjectState } from './state.js'

export interface ProjectSummary {
  id: string
  dir: string
  objective: string
  workflow_version: number
  work_items: number
  active: number
  last_activity: string | null
}

const lastAt = (events: readonly DrillmasterEvent[]) => events.at(-1)?.at ?? null

export function summarizeProject(id: string, events: readonly DrillmasterEvent[]): ProjectSummary | undefined {
  const init = events.find((e) => e.type === 'project_initialized')
  if (!init || init.type !== 'project_initialized') return undefined
  const state = foldState(events)
  const items = Object.values(state.workItems)
  return {
    id,
    dir: init.dir,
    objective: state.workflow!.objective.text,
    workflow_version: state.workflow!.version,
    work_items: items.length,
    active: items.filter((i) => i.status === 'active').length,
    last_activity: lastAt(events),
  }
}

export type ProposalStatus = 'applied' | 'approved' | 'declined' | 'open'

function retrosOf(state: ProjectState, events: readonly DrillmasterEvent[]) {
  return events
    .filter((e): e is Extract<DrillmasterEvent, { type: 'retrospective_ran' }> => e.type === 'retrospective_ran')
    .map((e) => {
      const retro = state.retros[e.retro_id]!
      const status = (id: number): ProposalStatus =>
        retro.applied.includes(id) ? 'applied' : retro.approved.includes(id) ? 'approved' : retro.declined.includes(id) ? 'declined' : 'open'
      const decisions = events.filter((d) => d.type === 'owner_decided' && d.retro_id === e.retro_id).map((d) => ({ at: d.at, prompt: (d as { prompt: string }).prompt }))
      return {
        retro_id: e.retro_id,
        at: e.at,
        work_items: e.work_items,
        findings: e.findings,
        proposals: e.proposals.map((p) => ({ ...p, status: status(p.id) })),
        decisions,
      }
    })
    .reverse()
}

export function projectView(id: string, events: readonly DrillmasterEvent[]) {
  const summary = summarizeProject(id, events)
  if (!summary) return undefined
  const state = foldState(events)
  const measured = new Map<string, ItemMeasures>(measureItems(events).map((m) => [m.work_item_id, m]))
  const workflow = state.workflow!
  const all = [...measured.values()]
  return {
    summary,
    workflow,
    versions: events
      .filter((e) => e.type === 'project_initialized' || e.type === 'workflow_changed')
      .map((e) => ({ version: (e as { workflow: { version: number } }).workflow.version, at: e.at, reason: e.type === 'workflow_changed' ? e.reason : "Owner's objective (workflow_0)", workflow: (e as { workflow: unknown }).workflow })),
    measures: workflow.objective.measures.map((m) => ({ name: m, last_5: average(all.slice(-5), m), all: average(all, m), per_item: all.map((i) => ({ work_item_id: i.work_item_id, issue: i.issue, value: i.values[m] })) })),
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
        added_steps: events.filter((e) => e.type === 'work_reported' && e.work_item_id === item.work_item_id && e.kind === 'added_step').length,
        measures: measured.get(item.work_item_id)?.values ?? null,
      })),
    retrospectives: retrosOf(state, events),
    sessions: Object.values(state.sessions),
  }
}

export function workItemView(events: readonly DrillmasterEvent[], workItemId: string) {
  const state = foldState(events)
  const item = state.workItems[workItemId]
  if (!item) return undefined
  const { token_hash: _hash, ...shown } = item
  // Neither raw hook payloads nor the token hash ever leave the server.
  const timeline = events
    .filter((e) => 'work_item_id' in e && e.work_item_id === workItemId)
    .map((e) => (e.type === 'work_trace' ? (({ raw: _raw, ...rest }) => rest)(e) : e.type === 'work_item_started' ? (({ token_hash: _hash, ...rest }) => rest)(e) : e))
  return {
    item: shown,
    workflow: state.versions[item.workflow_version],
    measures: measureItems(events).find((m) => m.work_item_id === workItemId)?.values ?? null,
    timeline,
    post_mortems: timeline.filter((e) => e.type === 'post_mortem_written'),
  }
}
