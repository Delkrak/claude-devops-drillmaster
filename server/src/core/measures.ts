import type { DrillmasterEvent } from './events.js'
import { frictionJudgementsOf, isFriction, ownerInputsOf } from './ownerInputs.js'
import { toSemver } from './versions.js'

export const MEASURES = {
  owner_friction_per_item:
    "Owner's inputs on a work item that the friction judge called friction (until it has judged: every input but the one that started or resumed it, and after delivery only one Agent then changed the work for), plus Owner gates Owner rejected",
  gate_rejections_per_item: 'Work gate rejections per work item',
  review_rounds_per_item: 'Drillmaster and Owner gate hand-ins per work item',
  minutes_per_item: 'Minutes from start to delivery',
  tool_calls_per_item: 'Tool calls per work item',
} as const

export type MeasureName = keyof typeof MEASURES

export const MEASURE_NAMES = Object.keys(MEASURES) as [MeasureName, ...MeasureName[]]

/** Measures as earlier Drillmasters named them. */
const OLD_MEASURE_NAMES: Record<string, MeasureName> = { owner_corrections_per_item: 'owner_friction_per_item' }

export const currentMeasureName = (name: string): string => OLD_MEASURE_NAMES[name] ?? name

export interface ItemMeasures {
  work_item_id: string
  issue: string
  workflow_version: string
  delivered_at: string
  values: Record<MeasureName, number>
  inputs: Record<string, string>
}

const zeroMeasures = (): Record<MeasureName, number> => ({
  owner_friction_per_item: 0,
  gate_rejections_per_item: 0,
  review_rounds_per_item: 0,
  minutes_per_item: 0,
  tool_calls_per_item: 0,
})

export function measureDeliveredItems(events: readonly DrillmasterEvent[]): ItemMeasures[] {
  const items = new Map<
    string,
    { issue: string; workflowVersion: string; startedAt: string; deliveredAt?: string; values: Record<MeasureName, number>; inputs: Record<string, string> }
  >()
  for (const event of events) {
    if (event.type === 'work_item_started') {
      items.set(event.work_item_id, { issue: event.issue, workflowVersion: toSemver(event.workflow_version), startedAt: event.at, values: zeroMeasures(), inputs: {} })
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
        if (event.hook === 'PostToolUse') item.values.tool_calls_per_item++
        break
      case 'gate_submitted':
        if (event.gate !== 'self') item.values.review_rounds_per_item++
        break
      case 'gate_verdict':
        if (!event.accepted) item.values.gate_rejections_per_item++
        if (event.by === 'owner' && !event.accepted) item.values.owner_friction_per_item++
        break
      case 'work_item_delivered':
        item.deliveredAt = event.at
        item.values.minutes_per_item = Math.round(((Date.parse(event.at) - Date.parse(item.startedAt)) / 60000) * 10) / 10
        break
    }
  }
  const judgements = frictionJudgementsOf(events)
  for (const input of ownerInputsOf(events)) {
    const item = input.work_item_id ? items.get(input.work_item_id) : undefined
    if (item && isFriction(input, judgements, events)) item.values.owner_friction_per_item++
  }
  return [...items.entries()]
    .filter(([, item]) => item.deliveredAt)
    .map(([workItemId, item]) => ({
      work_item_id: workItemId,
      issue: item.issue,
      workflow_version: item.workflowVersion,
      delivered_at: item.deliveredAt!,
      values: item.values,
      inputs: item.inputs,
    }))
    .sort((a, b) => a.delivered_at.localeCompare(b.delivered_at))
}

export function averageMeasure(items: readonly ItemMeasures[], measure: MeasureName): number | null {
  if (items.length === 0) return null
  return Math.round((items.reduce((sum, item) => sum + item.values[measure], 0) / items.length) * 100) / 100
}

export const BASELINE_WINDOW = 5

export const measureBaseline = (items: readonly ItemMeasures[], measure: MeasureName) => averageMeasure(items.slice(-BASELINE_WINDOW), measure) ?? 0

export function standardDeviation(values: readonly number[]) {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.round(Math.sqrt(variance) * 100) / 100
}

export const measureBaselineSd = (items: readonly ItemMeasures[], measure: MeasureName) =>
  standardDeviation(items.slice(-BASELINE_WINDOW).map((item) => item.values[measure]))

export function splitMeasureByInput(items: readonly ItemMeasures[], measure: MeasureName, inputName: string) {
  const itemsByOption = new Map<string, ItemMeasures[]>()
  for (const item of items) {
    const option = item.inputs[inputName] ?? 'not set'
    itemsByOption.set(option, [...(itemsByOption.get(option) ?? []), item])
  }
  return [...itemsByOption.entries()].map(([option, optionItems]) => ({ option, items: optionItems.length, mean: averageMeasure(optionItems, measure) }))
}
