import type { DrillmasterEvent } from './events.js'
import type { ProjectState, WorkItemState } from './state.js'

/**
 * Where everything of a project lives in its Drillmaster repository, under the project's folder.
 * Main is the source of truth: the pin, the workflow, the project's events and every merged work item.
 */
export const itemBranch = (workItemId: string) => `drillmaster/${workItemId}`
export const pinFile = (folder: string) => `${folder}/drillmaster.json`
export const workflowFile = (folder: string) => `${folder}/workflow.json`
export const itemFolder = (folder: string, workItemId: string) => `${folder}/items/${workItemId}`
export const projectFile = (folder: string, writer: string) => `${folder}/project/${writer}.jsonl`
export const itemFile = (folder: string, workItemId: string, writer: string) => `${itemFolder(folder, workItemId)}/${writer}.jsonl`
export const artifactFile = (folder: string, workItemId: string, name: string) => `${itemFolder(folder, workItemId)}/artifacts/${name}`

export const isComplete = (item: WorkItemState) => item.status === 'delivered' && item.post_mortems.includes('agent') && item.post_mortems.includes('drillmaster')

const toJsonl = (events: readonly DrillmasterEvent[]) => events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '')

/**
 * The files this writer owns in the repository: one per work item, and one for the project.
 * Writers never share a file, so branches from different machines merge without conflicts.
 */
export function filesOfWriter(events: readonly DrillmasterEvent[], state: ProjectState, folder: string, writer: string) {
  const ours = events.filter((event) => (event.writer ?? writer) === writer)
  const projectEvents = ours.filter((event) => !('work_item_id' in event) || !event.work_item_id)
  const items = Object.values(state.workItems).map((item) => ({
    item,
    branch: itemBranch(item.work_item_id),
    folder: itemFolder(folder, item.work_item_id),
    files: { [itemFile(folder, item.work_item_id, writer)]: toJsonl(ours.filter((event) => 'work_item_id' in event && event.work_item_id === item.work_item_id)) },
    artifacts: ours.some((event) => event.type === 'work_item_delivered' && event.work_item_id === item.work_item_id) ? item.artifacts : [],
    complete: isComplete(item),
  }))
  return { project: { [projectFile(folder, writer)]: toJsonl(projectEvents) }, items: items.filter((entry) => Object.values(entry.files)[0] !== '') }
}

export function isPublishMoment(event: DrillmasterEvent) {
  switch (event.type) {
    case 'gate_verdict':
    case 'step_skip_decided':
      return event.accepted && (event.done || event.next.stage !== event.stage)
    case 'project_initialized':
    case 'workflow_changed':
    case 'retrospective_ran':
    case 'owner_decided':
    case 'work_item_delivered':
    case 'post_mortem_written':
    case 'work_item_updated':
      return true
    default:
      return false
  }
}

export const mergeMessage = (item: WorkItemState) =>
  `${item.work_item_id} (${item.issue}): delivered as ${item.pr ?? 'no PR'} on workflow ${item.workflow_version}, ${item.rejections} gate rejection${item.rejections === 1 ? '' : 's'}`
