import type { DrillmasterEvent, MeasureJudgement } from './events.js'
import { frictionJudgementsOf, isFriction, ownerInputsOf } from './ownerInputs.js'
import { compareVersions, toSemver } from './versions.js'

/** The measures Drillmaster counts from every work item's events. */
export const COUNTED_MEASURES = {
  gate_rejections_per_item: 'Work gate rejections per work item',
  review_rounds_per_item: 'Drillmaster and Owner gate hand-ins per work item',
  minutes_per_item: 'Minutes from start to delivery',
  tool_calls_per_item: 'Tool calls per work item',
} as const

export type CountedMeasure = keyof typeof COUNTED_MEASURES

export const COUNTED_MEASURE_NAMES = Object.keys(COUNTED_MEASURES) as CountedMeasure[]

export const isCountedMeasure = (name: string): name is CountedMeasure => Object.hasOwn(COUNTED_MEASURES, name)

/**
 * The measure Drillmaster judged with a friction judge of its own before workflows defined their
 * measures. A workflow that names it keeps it as a measure it defines.
 */
export const OWNER_FRICTION = {
  name: 'owner_friction_per_item',
  short: 'OF',
  color: 'orange',
  definition:
    "Owner's inputs on a work item that were friction: Owner had to correct, redirect or add to the work, rather than approve it or answer a question Agent asked. An Owner gate Owner rejected counts too.",
  show: true,
} as const

/** The first Drillmaster that judges a workflow's measures in its post mortem, instead of judging friction apart. */
const FIRST_VERSION_JUDGING_MEASURES = '0.4.0'

/** Measures as earlier Drillmasters named them. */
const OLD_MEASURE_NAMES: Record<string, string> = { owner_corrections_per_item: OWNER_FRICTION.name }

export const currentMeasureName = (name: string): string => OLD_MEASURE_NAMES[name] ?? name
export const isOldMeasureName = (name: string) => name in OLD_MEASURE_NAMES

export interface ItemMeasures {
  work_item_id: string
  issue: string
  workflow_version: string
  delivered_at: string
  /** By measure; a judged measure Drillmaster has not judged for the item is missing. */
  values: Record<string, number>
  inputs: Record<string, string>
  /** GUIDs of the steps whose gate passed. */
  passed_step_guids: string[]
  /** Gate rejections by the rule they cite. */
  rejections_by_rule: Record<string, number>
}

const zeroCounts = (): Record<CountedMeasure, number> => ({
  gate_rejections_per_item: 0,
  review_rounds_per_item: 0,
  minutes_per_item: 0,
  tool_calls_per_item: 0,
})

const judgedValues = (judgements: readonly MeasureJudgement[]) => Object.fromEntries(judgements.map((judgement) => [judgement.measure, judgement.occurrences.length]))

/** Whether a Drillmaster that judged friction apart, before workflows defined their measures, wrote it. */
export const writtenBeforeMeasuresWereJudged = (drillmasterVersion: string | undefined) => drillmasterVersion === undefined || compareVersions(drillmasterVersion, FIRST_VERSION_JUDGING_MEASURES) < 0

/**
 * Each delivered work item's judged measures: its post mortem's, with the occurrences Drillmaster
 * judged later added. A work item whose post mortem judged no measures has none.
 */
export function judgedMeasuresOf(events: readonly DrillmasterEvent[]) {
  const judgementsByItemId = new Map<string, MeasureJudgement[]>()
  for (const event of events) {
    if (event.type === 'post_mortem_written' && event.author === 'drillmaster' && event.measured) judgementsByItemId.set(event.work_item_id, event.measured)
    if (event.type !== 'late_measures_judged') continue
    const judgements = judgementsByItemId.get(event.work_item_id)
    if (!judgements) continue
    judgementsByItemId.set(
      event.work_item_id,
      judgements.map((judgement) => ({ ...judgement, occurrences: [...judgement.occurrences, ...(event.measured.find((late) => late.measure === judgement.measure)?.occurrences ?? [])] })),
    )
  }
  return judgementsByItemId
}

export function measureDeliveredItems(events: readonly DrillmasterEvent[]): ItemMeasures[] {
  const items = new Map<
    string,
    {
      issue: string
      workflowVersion: string
      startedAt: string
      deliveredAt?: string
      deliveredBy?: string
      counts: Record<CountedMeasure, number>
      oldFriction: number
      inputs: Record<string, string>
      passedSteps: string[]
      rejectionsByRule: Record<string, number>
    }
  >()
  for (const event of events) {
    if (event.type === 'work_item_started') {
      items.set(event.work_item_id, { issue: event.issue, workflowVersion: toSemver(event.workflow_version), startedAt: event.at, counts: zeroCounts(), oldFriction: 0, inputs: {}, passedSteps: [], rejectionsByRule: {} })
      continue
    }
    if (event.type === 'work_item_updated') {
      const updated = items.get(event.work_item_id)
      if (updated) updated.workflowVersion = event.to_version
      continue
    }
    if (event.type === 'input_set') {
      const measured = items.get(event.work_item_id)
      if (measured) measured.inputs[event.name] = event.value
      continue
    }
    if (!('work_item_id' in event) || !event.work_item_id) continue
    const item = items.get(event.work_item_id)
    if (!item) continue
    if (item.deliveredAt) continue
    switch (event.type) {
      case 'work_trace':
        if (event.hook === 'PostToolUse' || event.hook === 'PostToolUseFailure') item.counts.tool_calls_per_item++
        break
      case 'gate_submitted':
        if (event.gate !== 'self') item.counts.review_rounds_per_item++
        break
      case 'gate_verdict':
        if (event.accepted && event.step_guid) item.passedSteps.push(event.step_guid)
        if (!event.accepted) item.counts.gate_rejections_per_item++
        if (!event.accepted && event.rule) for (const rule of event.rule.split(', ')) item.rejectionsByRule[rule] = (item.rejectionsByRule[rule] ?? 0) + 1
        if (event.by === 'owner' && !event.accepted) item.oldFriction++
        break
      case 'work_item_delivered':
        item.deliveredAt = event.at
        item.deliveredBy = event.drillmaster_version
        item.counts.minutes_per_item = Math.round(((Date.parse(event.at) - Date.parse(item.startedAt)) / 60000) * 10) / 10
        break
    }
  }
  const judgedByItemId = judgedMeasuresOf(events)
  const frictionJudgements = frictionJudgementsOf(events)
  for (const input of ownerInputsOf(events)) {
    const item = input.work_item_id ? items.get(input.work_item_id) : undefined
    if (item && isFriction(input, frictionJudgements)) item.oldFriction++
  }
  return [...items.entries()]
    .filter(([, item]) => item.deliveredAt)
    .map(([workItemId, item]) => ({
      work_item_id: workItemId,
      issue: item.issue,
      workflow_version: item.workflowVersion,
      delivered_at: item.deliveredAt!,
      values: {
        ...(!judgedByItemId.has(workItemId) && writtenBeforeMeasuresWereJudged(item.deliveredBy) ? { [OWNER_FRICTION.name]: item.oldFriction } : {}),
        ...judgedValues(judgedByItemId.get(workItemId) ?? []),
        ...item.counts,
      },
      inputs: item.inputs,
      passed_step_guids: item.passedSteps,
      rejections_by_rule: item.rejectionsByRule,
    }))
    .sort((a, b) => a.delivered_at.localeCompare(b.delivered_at))
}

/** Gate rejections by the rule they cite, over the items. */
export function rejectionsByRule(items: readonly ItemMeasures[]) {
  const counts: Record<string, number> = {}
  for (const item of items) for (const [rule, count] of Object.entries(item.rejections_by_rule)) counts[rule] = (counts[rule] ?? 0) + count
  return counts
}

/** The items with a value for the measure: every item for a counted measure, the judged ones for a judged one. */
export const itemsWithMeasure = (items: readonly ItemMeasures[], measure: string) => items.filter((item) => item.values[measure] !== undefined)

export function averageMeasure(items: readonly ItemMeasures[], measure: string): number | null {
  const values = itemsWithMeasure(items, measure).map((item) => item.values[measure]!)
  if (values.length === 0) return null
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
}

export const BASELINE_WINDOW = 5

export const lastItemsWithMeasure = (items: readonly ItemMeasures[], measure: string) => itemsWithMeasure(items, measure).slice(-BASELINE_WINDOW)

export const measureBaseline = (items: readonly ItemMeasures[], measure: string) => averageMeasure(lastItemsWithMeasure(items, measure), measure) ?? 0

export function standardDeviation(values: readonly number[]) {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.round(Math.sqrt(variance) * 100) / 100
}

export const measureBaselineSd = (items: readonly ItemMeasures[], measure: string) => standardDeviation(lastItemsWithMeasure(items, measure).map((item) => item.values[measure]!))

export function splitMeasureByInput(items: readonly ItemMeasures[], measure: string, inputName: string) {
  const itemsByOption = new Map<string, ItemMeasures[]>()
  for (const item of itemsWithMeasure(items, measure)) {
    const option = item.inputs[inputName] ?? 'not set'
    itemsByOption.set(option, [...(itemsByOption.get(option) ?? []), item])
  }
  return [...itemsByOption.entries()].map(([option, optionItems]) => ({ option, items: optionItems.length, mean: averageMeasure(optionItems, measure) }))
}
