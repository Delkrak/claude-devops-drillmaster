import type { MarkCount, ShownMeasure, WorkItemRef } from '../../types'
import type { MeasurePill } from '../../ui/workflow/marks'
import { measureTip, shortOfMeasure, toneOfMeasure } from '../measures'

export const describeItems = (items: readonly WorkItemRef[], where: string) =>
  `${items.length} work item${items.length === 1 ? '' : 's'} ${where}: ${items.map((item) => item.issue).join(', ')}`

export type OpenItems = (title: string, items: readonly WorkItemRef[], point: { x: number; y: number }) => void

export const stageAnchorId = (stageNumber: number) => `stage-${stageNumber}`

/** The pills of the measures counted in one place, each a door to its work items. */
export const pillsOf = (measures: readonly ShownMeasure[], counts: readonly MarkCount[], where: string, openItems: OpenItems): MeasurePill[] =>
  counts.map((count) => ({
    measure: count.measure,
    short: shortOfMeasure(measures, count.measure),
    count: count.count,
    tone: toneOfMeasure(measures, count.measure),
    tip: measureTip(measures, count.measure, count.count, where),
    onOpen: (point) => openItems(`${count.measure} ${where}, on`, count.items, point),
  }))

export const IN_THIS_STAGE = 'in this stage'
export const NO_STEP_COVERS = 'where no step covers it'
/** The row of what no step of the workflow covers, between the last stage and delivery. */
export const NO_STEP_ROW_NAME = 'no step covers it'

export const estimatedLabelWidth = (text: string, fontSize: number) => Math.ceil(text.length * fontSize * 0.55)
