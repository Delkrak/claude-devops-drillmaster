import type { WorkItemRef } from '../../types'

/** "2 work items here now: #5, #7" */
export const describeItems = (items: readonly WorkItemRef[], where: string) =>
  `${items.length} work item${items.length === 1 ? '' : 's'} ${where}: ${items.map((item) => item.issue).join(', ')}`

/** Opens the work items behind a mark: `title` says what they have in common. */
export type OpenItems = (title: string, items: readonly WorkItemRef[], at: { x: number; y: number }) => void

/** Where a stage is drawn in full, for the overview's rows to jump to. */
export const stageAnchor = (n: number) => `stage-${n}`

/** Friction counted during the work whose stage is not known, shown before delivery so the count adds up. */
export const unplacedTip = (count: number) => `you stepped in ${count} times during the work; the stage is not known`

/** About how wide a label is, in drawing units, for placing what stands beside it. */
export const labelWidth = (text: string, size: number) => Math.ceil(text.length * size * 0.55)
