import type { WorkItemRef } from '../../types'

/** "2 work items here now: #5, #7" */
export const describeItems = (items: readonly WorkItemRef[], where: string) =>
  `${items.length} work item${items.length === 1 ? '' : 's'} ${where}: ${items.map((item) => item.issue).join(', ')}`

/** About how wide a label is, in drawing units, for placing what stands beside it. */
export const labelWidth = (text: string, size: number) => Math.ceil(text.length * size * 0.55)
