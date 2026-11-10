import type { DrillmasterEvent } from './events.js'
import type { ProjectState, WorkItemState } from './state.js'
import type { WorkflowDocument } from './workflow.js'

export type Storage = NonNullable<WorkflowDocument['storage']>

export const DEFAULT_BRANCH_PATTERN = 'drillmaster/{work_item_id}'

export const itemBranch = (storage: Storage, workItemId: string) => storage.branch.pattern.split('{work_item_id}').join(workItemId)
export const itemFolder = (storage: Storage, workItemId: string) => `${storage.path}/items/${workItemId}`
export const projectFile = (storage: Storage, writer: string) => `${storage.path}/project/${writer}.jsonl`
export const itemFile = (storage: Storage, workItemId: string, writer: string) => `${itemFolder(storage, workItemId)}/${writer}.jsonl`
export const artifactFile = (storage: Storage, workItemId: string, name: string) => `${itemFolder(storage, workItemId)}/artifacts/${name}`

export const isComplete = (item: WorkItemState) => item.status === 'delivered' && item.post_mortems.includes('agent') && item.post_mortems.includes('drillmaster')

const toJsonl = (events: readonly DrillmasterEvent[]) => events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '')

/**
 * The files this writer owns in the store: one per work item, and one for the project. Writers
 * never share a file, so branches from different machines merge without conflicts.
 */
export function filesOfWriter(events: readonly DrillmasterEvent[], state: ProjectState, storage: Storage, writer: string) {
  const ours = events.filter((event) => (event.writer ?? writer) === writer)
  const projectEvents = ours.filter((event) => !('work_item_id' in event) || !event.work_item_id)
  const items = Object.values(state.workItems).map((item) => ({
    item,
    branch: itemBranch(storage, item.work_item_id),
    folder: itemFolder(storage, item.work_item_id),
    files: { [itemFile(storage, item.work_item_id, writer)]: toJsonl(ours.filter((event) => 'work_item_id' in event && event.work_item_id === item.work_item_id)) },
    artifacts: ours.some((event) => event.type === 'work_item_delivered' && event.work_item_id === item.work_item_id) ? item.artifacts : [],
    complete: isComplete(item),
  }))
  return { project: { [projectFile(storage, writer)]: toJsonl(projectEvents) }, items: items.filter((entry) => Object.values(entry.files)[0] !== '') }
}

export function isPublishMoment(event: DrillmasterEvent) {
  switch (event.type) {
    case 'gate_verdict':
      return event.accepted && (event.done || event.next.stage !== event.stage)
    case 'project_initialized':
    case 'workflow_changed':
    case 'retrospective_ran':
    case 'owner_decided':
    case 'work_item_delivered':
    case 'post_mortem_written':
    case 'work_item_updated':
      return true
    case 'step_skip_decided':
      return event.accepted && (event.done || event.next.stage !== event.stage)
    default:
      return false
  }
}

export const mergeMessage = (item: WorkItemState) =>
  `${item.work_item_id} (${item.issue}): delivered as ${item.pr ?? 'no PR'} on workflow ${item.workflow_version}, ${item.rejections} gate rejection${item.rejections === 1 ? '' : 's'}`
