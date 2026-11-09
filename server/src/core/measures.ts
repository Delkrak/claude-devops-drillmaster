// The measures v1 can compute from the work traces. Owner's objective names measures from this set.

export const MEASURES = {
  owner_corrections_per_item: 'Owner corrections per work item',
  gate_rejections_per_item: 'Work gate rejections per work item',
  review_rounds_per_item: 'Review rounds per work item',
  minutes_per_item: 'Minutes per work item',
  tool_calls_per_item: 'Tool calls per work item',
} as const

export type MeasureName = keyof typeof MEASURES

export const MEASURE_NAMES = Object.keys(MEASURES) as [MeasureName, ...MeasureName[]]
