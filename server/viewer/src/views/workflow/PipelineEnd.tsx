import type { WorkflowPage } from '../../types'
import { ITEM_COLUMN, itemBoxWidth, MEASURE_COLUMN } from '../../ui/workflow/geometry'
import { Drawing } from '../../ui/workflow/layout'
import { AfterDeliveryLine, DeliveryBar, ItemBox, Line, MeasurePills, RowName, StageRule } from '../../ui/workflow/marks'
import { describeItems, NO_STEP_COVERS, NO_STEP_ROW_NAME, pillsOf, type OpenItems } from './describe'

const NO_STEP_ROW = 70
const DELIVERY_Y = 40
const AFTER_DELIVERY_Y = 70
const AFTER_DELIVERY_HEIGHT = 120

export function PipelineEnd({ page, openItems, openDelivered }: { page: WorkflowPage; openItems: OpenItems; openDelivered: () => void }) {
  const top = page.no_step.length > 0 ? NO_STEP_ROW : 0
  return (
    <Drawing height={top + AFTER_DELIVERY_HEIGHT} testId="pipeline-end">
      {page.no_step.length > 0 && (
        <g data-testid="no-step-row">
          <StageRule y={0} />
          <RowName y={30}>{NO_STEP_ROW_NAME}</RowName>
          <Line from={0} to={top} />
          <MeasurePills x={MEASURE_COLUMN} y={26} pills={pillsOf(page.measures, page.no_step, NO_STEP_COVERS, openItems)} />
        </g>
      )}
      <Line from={top} to={top + DELIVERY_Y} />
      <DeliveryBar y={top + DELIVERY_Y} />
      {page.delivered > 0 && <ItemBox dotX={ITEM_COLUMN} y={top + DELIVERY_Y} boxText={page.delivered} tip={`${page.delivered} work items delivered`} testId="delivered" onOpen={openDelivered} />}
      {page.waiting_to_deliver.length > 0 && (
        <ItemBox
          dotX={ITEM_COLUMN - itemBoxWidth(page.delivered) - 16}
          y={top + DELIVERY_Y}
          boxText={page.waiting_to_deliver.length}
          tip={describeItems(page.waiting_to_deliver, 'waiting to be delivered')}
          onOpen={(point) => openItems('waiting to be delivered', page.waiting_to_deliver, point)}
        />
      )}
      <StageRule y={top + AFTER_DELIVERY_Y} dotted />
      <AfterDeliveryLine from={top + DELIVERY_Y + 6} to={top + AFTER_DELIVERY_HEIGHT} />
    </Drawing>
  )
}
