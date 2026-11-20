import type { WorkflowPage } from '../../types'
import { ITEM_COLUMN, itemBoxWidth, PROBLEM_COLUMN } from '../../ui/workflow/geometry'
import { Drawing } from '../../ui/workflow/layout'
import { AfterDeliveryLine, DeliveryBar, FrictionRing, ItemBox, Line, StageRule } from '../../ui/workflow/marks'
import { describeItems } from './describe'

const DELIVERY_Y = 40
const AFTER_Y = 70
const HEIGHT = 120

/** The end of the line: delivery, and where Owner stepped in after it. */
export function PipelineEnd({ page }: { page: WorkflowPage }) {
  return (
    <Drawing height={HEIGHT} testId="pipeline-end">
      <Line from={0} to={DELIVERY_Y} />
      <DeliveryBar y={DELIVERY_Y} />
      <ItemBox dotX={ITEM_COLUMN} y={DELIVERY_Y} count={page.delivered} tip={`${page.delivered} work items delivered`} testId="delivered" />
      {page.waiting_to_deliver.length > 0 && (
        <ItemBox dotX={ITEM_COLUMN - itemBoxWidth(page.delivered) - 16} y={DELIVERY_Y} count={page.waiting_to_deliver.length} tip={describeItems(page.waiting_to_deliver, 'waiting to be delivered')} />
      )}
      <StageRule y={AFTER_Y} dotted />
      <AfterDeliveryLine from={DELIVERY_Y + 6} to={HEIGHT} />
      {page.friction.after_delivery > 0 && (
        <FrictionRing x={PROBLEM_COLUMN} y={95} count={page.friction.after_delivery} tip={`you stepped in ${page.friction.after_delivery} times after delivery`} />
      )}
    </Drawing>
  )
}
