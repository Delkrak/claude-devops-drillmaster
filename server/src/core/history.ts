import type { DrillmasterEvent } from './events.js'
import { refOfGuid, type RefKind } from './refs.js'
import { foldState } from './state.js'
import { canonicalJson } from './updates.js'
import type { WorkflowDocument } from './workflow.js'

/** A component as one workflow version defines it, without what only places it. */
function definitionIn(workflow: WorkflowDocument, guid: string): { kind: RefKind; name: string; definition: unknown } | undefined {
  const ref = refOfGuid(workflow, guid)
  if (!ref) return undefined
  const withoutPlacement = <T extends object>(component: T) => Object.fromEntries(Object.entries(component).filter(([key]) => key !== 'guid' && key !== 'n' && key !== 'steps'))
  switch (ref.kind) {
    case 'stage':
      return { kind: ref.kind, name: ref.name, definition: withoutPlacement(workflow.stages.find((stage) => stage.guid === guid)!) }
    case 'step':
      return { kind: ref.kind, name: ref.name, definition: withoutPlacement(workflow.stages.flatMap((stage) => stage.steps).find((step) => step.guid === guid)!) }
    case 'policy':
      return { kind: ref.kind, name: ref.name, definition: { name: ref.name } }
    case 'rule':
      return { kind: ref.kind, name: ref.name, definition: withoutPlacement(workflow.policies.flatMap((policy) => policy.rules).find((rule) => rule.guid === guid)!) }
    default:
      return { kind: ref.kind, name: ref.name, definition: withoutPlacement(workflow.metrics.find((metric) => metric.guid === guid)!) }
  }
}

export interface HistoryEntry {
  id: string
  at: string
  type: string
  work_item_id: string | null
  text: string
}

/**
 * Everything about one component of the workflow, followed by its GUID: how each version defined
 * it, the feedback that named it, and what happened at it.
 */
export function componentHistory(events: readonly DrillmasterEvent[], guid: string) {
  const state = foldState(events)
  const versionEvents = events.filter((event) => event.type === 'project_initialized' || event.type === 'workflow_changed')
  const versions: { version: string; at: string; reason: string; name: string | null; definition: unknown; change: 'added' | 'changed' | 'same' | 'removed' }[] = []
  let kind: RefKind | undefined
  let previous: string | undefined
  state.versions.forEach((workflow, index) => {
    const event = versionEvents[index]!
    const found = definitionIn(workflow, guid)
    const json = found ? canonicalJson(found.definition) : undefined
    if (!found && previous === undefined) return
    kind ??= found?.kind
    const change = !found ? 'removed' : previous === undefined ? 'added' : json !== previous ? 'changed' : 'same'
    if (change === 'removed' && versions.at(-1)?.change === 'removed') return
    versions.push({ version: workflow.version, at: event.at, reason: event.type === 'workflow_changed' ? event.reason : "Owner's objective", name: found?.name ?? null, definition: found?.definition ?? null, change })
    previous = json
  })
  if (!kind) return undefined

  const names = new Set(versions.map((version) => version.name).filter((name): name is string => name !== null))
  const feedback: HistoryEntry[] = events.flatMap((event) => {
    const entries =
      event.type === 'post_mortem_written'
        ? [...event.keep, ...event.change].map((entry) => ({ entry, from: `${event.author}'s post mortem`, workItemId: event.work_item_id as string | null }))
        : event.type === 'retrospective_ran'
          ? [...event.findings.keep, ...event.findings.improve].map((entry) => ({ entry, from: `retrospective ${event.retro_id}`, workItemId: null }))
          : []
    return entries
      .filter(({ entry }) => entry.refs.some((mention) => mention.guid === guid))
      .map(({ entry, from, workItemId }) => ({ id: event.id, at: event.at, type: event.type, work_item_id: workItemId, text: `${from}: ${entry.text}` }))
  })
  const activity: HistoryEntry[] = events.flatMap((event): HistoryEntry[] => {
    if ('step_guid' in event && event.step_guid === guid) {
      const text =
        event.type === 'gate_verdict'
          ? `${event.accepted ? 'accepted' : 'rejected'} by ${event.by}: ${event.why}`
          : event.type === 'work_reported'
            ? `${event.kind}: ${event.text}`
            : event.type === 'step_skip_decided'
              ? `skip ${event.accepted ? 'accepted' : 'rejected'} by ${event.by}: ${event.why}`
              : event.type === 'metric_recorded'
                ? `metric ${event.name}: ${event.value}`
                : undefined
      return text && event.type !== 'work_trace' ? [{ id: event.id, at: event.at, type: event.type, work_item_id: event.work_item_id, text }] : []
    }
    if (kind === 'metric' && event.type === 'metric_recorded' && names.has(event.name)) {
      return [{ id: event.id, at: event.at, type: event.type, work_item_id: event.work_item_id, text: `${event.value} (by ${event.by})${event.explanation ? `: ${event.explanation}` : ''}` }]
    }
    if (kind === 'rule' && event.type === 'gate_verdict' && event.rule && [...names].some((name) => event.rule!.split(', ').includes(name))) {
      return [{ id: event.id, at: event.at, type: event.type, work_item_id: event.work_item_id, text: `${event.accepted ? 'accepted' : 'rejected'} by ${event.by}, citing it: ${event.why}` }]
    }
    return []
  })
  const current = state.workflow ? refOfGuid(state.workflow, guid) : undefined
  return { guid, kind, current: current ?? null, versions, feedback, activity }
}
