import type { DrillmasterEvent } from './events.js'
import { toSemver } from './versions.js'

export const MEASURES = {
  owner_corrections_per_item:
    "Owner's prompts during a work item that were not Owner-gate approvals, plus prompts after delivery that made Agent change the work",
  gate_rejections_per_item: 'Work gate rejections per work item',
  review_rounds_per_item: 'Drillmaster and Owner gate hand-ins per work item',
  minutes_per_item: 'Minutes from start to delivery',
  tool_calls_per_item: 'Tool calls per work item',
} as const

export type MeasureName = keyof typeof MEASURES

export const MEASURE_NAMES = Object.keys(MEASURES) as [MeasureName, ...MeasureName[]]

export interface ItemMeasures {
  work_item_id: string
  issue: string
  workflow_version: string
  delivered_at: string
  values: Record<MeasureName, number>
  metrics: Record<string, string>
}

const WORK_CHANGING_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/

const zeroMeasures = (): Record<MeasureName, number> => ({
  owner_corrections_per_item: 0,
  gate_rejections_per_item: 0,
  review_rounds_per_item: 0,
  minutes_per_item: 0,
  tool_calls_per_item: 0,
})

export function measureDeliveredItems(events: readonly DrillmasterEvent[]): ItemMeasures[] {
  const ownerPromptAwaitingChange = new Map<string, boolean>()
  const items = new Map<
    string,
    { issue: string; workflowVersion: string; startedAt: string; deliveredAt?: string; values: Record<MeasureName, number>; metrics: Record<string, string> }
  >()
  for (const event of events) {
    if (event.type === 'work_item_started') {
      items.set(event.work_item_id, { issue: event.issue, workflowVersion: toSemver(event.workflow_version), startedAt: event.at, values: zeroMeasures(), metrics: {} })
      continue
    }
    if (event.type === 'work_item_restarted') {
      const restarted = items.get(event.work_item_id)
      if (restarted) restarted.workflowVersion = event.to_version
      continue
    }
    if (event.type === 'metric_recorded') {
      const measured = items.get(event.work_item_id)
      if (measured) measured.metrics[event.name] = event.value
      continue
    }
    if (!('work_item_id' in event) || !event.work_item_id) continue
    const item = items.get(event.work_item_id)
    if (!item) continue
    if (item.deliveredAt) {
      // Without gates, Owner can often only correct after delivery. A prompt counts as a correction
      // when Agent then changes the work; a next-issue instruction or retrospective talk does not.
      if (event.type === 'work_trace' && event.hook === 'UserPromptSubmit') ownerPromptAwaitingChange.set(event.work_item_id, true)
      if (event.type === 'work_trace' && event.hook === 'PostToolUse' && WORK_CHANGING_TOOLS.test(event.tool ?? '') && ownerPromptAwaitingChange.get(event.work_item_id)) {
        item.values.owner_corrections_per_item++
        ownerPromptAwaitingChange.set(event.work_item_id, false)
      }
      continue
    }
    switch (event.type) {
      case 'work_trace':
        if (event.hook === 'UserPromptSubmit') item.values.owner_corrections_per_item++
        if (event.hook === 'PostToolUse') item.values.tool_calls_per_item++
        break
      case 'gate_submitted':
        if (event.gate !== 'self') item.values.review_rounds_per_item++
        break
      case 'gate_verdict':
        if (!event.accepted) item.values.gate_rejections_per_item++
        // A prompt that decided the gate was not a correction; a rejection asked through AskUserQuestion is one.
        if (event.by === 'owner' && event.via !== 'question' && event.accepted) item.values.owner_corrections_per_item--
        if (event.by === 'owner' && event.via === 'question' && !event.accepted) item.values.owner_corrections_per_item++
        break
      case 'work_item_delivered':
        item.deliveredAt = event.at
        item.values.minutes_per_item = Math.round(((Date.parse(event.at) - Date.parse(item.startedAt)) / 60000) * 10) / 10
        break
    }
  }
  return [...items.entries()]
    .filter(([, item]) => item.deliveredAt)
    .map(([workItemId, item]) => ({
      work_item_id: workItemId,
      issue: item.issue,
      workflow_version: item.workflowVersion,
      delivered_at: item.deliveredAt!,
      values: item.values,
      metrics: item.metrics,
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

export function splitMeasureByMetric(items: readonly ItemMeasures[], measure: MeasureName, metricName: string) {
  const itemsByCategory = new Map<string, ItemMeasures[]>()
  for (const item of items) {
    const category = item.metrics[metricName] ?? 'not recorded'
    itemsByCategory.set(category, [...(itemsByCategory.get(category) ?? []), item])
  }
  return [...itemsByCategory.entries()].map(([category, categoryItems]) => ({ category, items: categoryItems.length, mean: averageMeasure(categoryItems, measure) }))
}
