import type { NewEvent, Position } from './events.js'
import { refOfGuid, stepName } from './refs.js'
import type { ProjectState, WorkItemState } from './state.js'
import { compareVersions, findRule, type VersionLevel, type WorkflowDocument, type WorkStage, type WorkStep } from './workflow.js'

export type UpdateLevel = VersionLevel | 'none'

const LEVEL_RANK: Record<VersionLevel, number> = { patch: 0, minor: 1, major: 2 }

/** How much a later version differs from an earlier one: the highest part of the version that changed. */
export function levelBetween(from: string, to: string): VersionLevel | null {
  if (compareVersions(to, from) <= 0) return null
  const [fromMajor, fromMinor] = from.split('.')
  const [toMajor, toMinor] = to.split('.')
  if (fromMajor !== toMajor) return 'major'
  return fromMinor !== toMinor ? 'minor' : 'patch'
}

function findStep(workflow: WorkflowDocument, guid: string): { stage: WorkStage; step: WorkStep } | undefined {
  for (const stage of workflow.stages) {
    const step = stage.steps.find((candidate) => candidate.guid === guid)
    if (step) return { stage, step }
  }
  return undefined
}

/** JSON with keys in one order, so two documents compare equal however their keys were written. */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, field: unknown) =>
    field && typeof field === 'object' && !Array.isArray(field) ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => a.localeCompare(b))) : field,
  )

const withoutNumber = ({ n: _n, ...rest }: { n: number } & Record<string, unknown>) => canonicalJson(rest)

/** The work policies a step's rules belong to, as they are in `workflow`. */
const policiesOf = (workflow: WorkflowDocument, step: WorkStep) =>
  [...new Set(step.rules.map((ruleRef) => findRule(workflow, ruleRef)?.policy))].map((name) => canonicalJson(workflow.policies.find((policy) => policy.name === name) ?? null))

/** A step is the same when it, its stage and the policies its rules belong to are unchanged. */
export function stepUnchanged(from: WorkflowDocument, to: WorkflowDocument, guid: string) {
  const before = findStep(from, guid)
  const after = findStep(to, guid)
  if (!before || !after) return false
  return (
    withoutNumber(before.step) === withoutNumber(after.step) &&
    before.stage.guid === after.stage.guid &&
    before.stage.name === after.stage.name &&
    before.stage.purpose === after.stage.purpose &&
    policiesOf(from, before.step).join() === policiesOf(to, after.step).join()
  )
}

export interface ItemUpdate {
  event: NewEvent & { type: 'work_item_updated' }
  from: WorkflowDocument
  to: WorkflowDocument
  kept: string[]
  next: Position
  done: boolean
  changes: string[]
}

/**
 * Checks the update a work item reaching `next` is due. The step it reaches says, in the item's own
 * workflow version, how big a newer version must be to update to it. On an update the item moves to
 * the latest version and keeps every step it passed or skipped that is unchanged, from the first
 * step on; it resumes at the first step that is not, even one before where it was.
 */
export function updateOnReaching(state: ProjectState, item: WorkItemState, from: WorkflowDocument, next: Position, doneNow: readonly string[] = []): ItemUpdate | undefined {
  const latest = state.workflow
  if (!latest || next.stage === null || next.step === null) return undefined
  const reached = from.stages.find((stage) => stage.n === next.stage)?.steps.find((step) => step.n === next.step)
  const wanted = reached?.update ?? 'none'
  const newer = levelBetween(from.version, latest.version)
  if (wanted === 'none' || !newer || LEVEL_RANK[newer] < LEVEL_RANK[wanted]) return undefined

  const done = new Set([...item.passed_step_guids, ...item.skipped_step_guids, ...doneNow])
  const kept: string[] = []
  let resumesAt: Position & { step_guid?: string } = { stage: null, step: null }
  walk: for (const stage of latest.stages) {
    for (const step of stage.steps) {
      if (done.has(step.guid) && stepUnchanged(from, latest, step.guid)) {
        kept.push(step.guid)
        continue
      }
      resumesAt = { stage: stage.n, step: step.n, step_guid: step.guid }
      break walk
    }
  }
  const finished = resumesAt.stage === null
  return {
    event: { type: 'work_item_updated', work_item_id: item.work_item_id, from_version: from.version, to_version: latest.version, kept, resumes_at: resumesAt, done: finished },
    from,
    to: latest,
    kept: kept.map((guid) => refOfGuid(latest, guid)!.name),
    next: { stage: resumesAt.stage, step: resumesAt.step },
    done: finished,
    changes: describeWorkflowChange(from, latest),
  }
}

/** What changed in the work steps between two versions, matched by GUID. */
export function describeWorkflowChange(from: WorkflowDocument, to: WorkflowDocument) {
  const lines: string[] = []
  const stepsOf = (workflow: WorkflowDocument) => workflow.stages.flatMap((stage) => stage.steps.map((step) => ({ label: stepName(stage.n, step.n), step })))
  const before = stepsOf(from)
  for (const { label, step } of stepsOf(to)) {
    const earlier = before.find((candidate) => candidate.step.guid === step.guid)
    if (!earlier) lines.push(`- new: step ${label} "${step.name}" (${step.gate} gate)`)
    else if (!stepUnchanged(from, to, step.guid)) lines.push(`- changed: step ${label} "${step.name}"${earlier.label !== label ? ` (was ${earlier.label})` : ''}`)
    else if (earlier.label !== label) lines.push(`- moved: step ${label} "${step.name}" (was ${earlier.label})`)
  }
  for (const { label, step } of before) if (!findStep(to, step.guid)) lines.push(`- removed: step ${label} "${step.name}"`)
  return lines.length ? lines : ['- the work steps are the same']
}
