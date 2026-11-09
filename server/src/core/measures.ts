// The measures v1 can compute from the events. Owner's objective names measures from this set.

import type { DrillmasterEvent } from './events.js'

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
  delivered_at: string
  values: Record<MeasureName, number>
}

/** Tools that change the work. Owner's words after delivery that lead to one were a correction. */
const CHANGES_WORK = /^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/

/** Every delivered work item's measures, in delivery order. */
export function measureItems(events: readonly DrillmasterEvent[]): ItemMeasures[] {
  const afterDelivery = new Map<string, boolean>() // work item -> an Owner prompt awaits a reaction
  const items = new Map<string, { issue: string; started: string; delivered?: string; values: Record<MeasureName, number> }>()
  const zero = (): Record<MeasureName, number> => ({
    owner_corrections_per_item: 0,
    gate_rejections_per_item: 0,
    review_rounds_per_item: 0,
    minutes_per_item: 0,
    tool_calls_per_item: 0,
  })
  for (const e of events) {
    if (e.type === 'work_item_started') {
      items.set(e.work_item_id, { issue: e.issue, started: e.at, values: zero() })
      continue
    }
    if (!('work_item_id' in e) || !e.work_item_id) continue
    const item = items.get(e.work_item_id)
    if (!item) continue
    if (item.delivered) {
      // Without gates, Owner often can only correct after delivery: count it when Agent then
      // changes the work. A next-issue instruction or retrospective talk changes nothing here.
      if (e.type === 'work_trace' && e.hook === 'UserPromptSubmit') afterDelivery.set(e.work_item_id, true)
      if (e.type === 'work_trace' && e.hook === 'PostToolUse' && CHANGES_WORK.test(e.tool ?? '') && afterDelivery.get(e.work_item_id)) {
        item.values.owner_corrections_per_item++
        afterDelivery.set(e.work_item_id, false)
      }
      continue
    }
    switch (e.type) {
      case 'work_trace':
        if (e.hook === 'UserPromptSubmit') item.values.owner_corrections_per_item++
        if (e.hook === 'PostToolUse') item.values.tool_calls_per_item++
        break
      case 'gate_submitted':
        if (e.gate !== 'self') item.values.review_rounds_per_item++
        break
      case 'gate_verdict':
        if (!e.accepted) item.values.gate_rejections_per_item++
        // Owner approving an Owner gate is not a correction.
        if (e.by === 'owner' && e.accepted) item.values.owner_corrections_per_item--
        break
      case 'work_item_delivered':
        item.delivered = e.at
        item.values.minutes_per_item = Math.round(((Date.parse(e.at) - Date.parse(item.started)) / 60000) * 10) / 10
        break
    }
  }
  return [...items.entries()]
    .filter(([, i]) => i.delivered)
    .map(([id, i]) => ({ work_item_id: id, issue: i.issue, delivered_at: i.delivered!, values: i.values }))
    .sort((a, b) => a.delivered_at.localeCompare(b.delivered_at))
}

/** The mean of a measure over work items; null when there are none. */
export function average(items: readonly ItemMeasures[], measure: MeasureName): number | null {
  if (items.length === 0) return null
  return Math.round((items.reduce((sum, i) => sum + i.values[measure], 0) / items.length) * 100) / 100
}

export const BASELINE_WINDOW = 5

/** A measure's baseline: its mean over the last few delivered work items. */
export const baseline = (items: readonly ItemMeasures[], measure: MeasureName) => average(items.slice(-BASELINE_WINDOW), measure) ?? 0
