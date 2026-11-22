import type { WorkItemRef } from '../../types'

export const describeItems = (items: readonly WorkItemRef[], where: string) =>
  `${items.length} work item${items.length === 1 ? '' : 's'} ${where}: ${items.map((item) => item.issue).join(', ')}`

export type OpenItems = (title: string, items: readonly WorkItemRef[], point: { x: number; y: number }) => void

export const stageAnchorId = (stageNumber: number) => `stage-${stageNumber}`

/** Friction counted during the work whose stage is not known, shown before delivery so the count adds up. */
export const unplacedTip = (count: number) => `you stepped in ${count} times during the work; the stage is not known`

export const estimatedLabelWidth = (text: string, fontSize: number) => Math.ceil(text.length * fontSize * 0.55)
