import type { WorkflowPage } from '../../types'
import { MEASURE_COLUMN, ITEM_COLUMN, itemBoxWidth, OVERVIEW_ROW } from '../../ui/workflow/geometry'
import { Drawing } from '../../ui/workflow/layout'
import { AfterDeliveryLine, DeliveryBar, ItemBox, Jump, Line, MeasurePills, RowName, StageLabel, StageRule, StageTick } from '../../ui/workflow/marks'
import { describeItems, IN_THIS_STAGE, NO_STEP_COVERS, NO_STEP_ROW_NAME, pillsOf, stageAnchorId, type OpenItems } from './describe'

export function Overview({ page, openItems, openDelivered }: { page: WorkflowPage; openItems: OpenItems; openDelivered: () => void }) {
  const noStepY = page.stages.length * OVERVIEW_ROW
  const deliveryY = noStepY + (page.no_step.length > 0 ? OVERVIEW_ROW : 0)
  const afterDeliveryY = deliveryY + OVERVIEW_ROW
  return (
    <Drawing height={afterDeliveryY + OVERVIEW_ROW} testId="workflow-overview" label="overview of the pipeline">
      {page.stages.map((stage, index) => {
        const top = index * OVERVIEW_ROW
        const middle = top + OVERVIEW_ROW / 2
        return (
          <Jump key={stage.guid} y={top} height={OVERVIEW_ROW} label={`go to stage ${stage.n}, ${stage.name}`} onJump={() => document.getElementById(stageAnchorId(stage.n))?.scrollIntoView({ block: 'start' })}>
            <g data-testid="stage-row">
            <StageRule y={top} />
            <StageLabel x={44} y={top + 34} n={stage.n} name={stage.name} />
            <Line from={top} to={top + OVERVIEW_ROW} />
            <StageTick y={middle} />
            {stage.here_now.length > 0 && <ItemBox dotX={ITEM_COLUMN} y={middle} boxText={stage.here_now.length} tip={describeItems(stage.here_now, 'here now')} onOpen={(point) => openItems('here now', stage.here_now, point)} />}
            <MeasurePills x={MEASURE_COLUMN} y={middle} pills={pillsOf(page.measures, stage.marks, IN_THIS_STAGE, openItems)} />
            </g>
          </Jump>
        )
      })}
      {page.no_step.length > 0 && (
        <g data-testid="no-step-row">
          <StageRule y={noStepY} />
          <RowName y={noStepY + 34}>{NO_STEP_ROW_NAME}</RowName>
          <Line from={noStepY} to={deliveryY} />
          <MeasurePills x={MEASURE_COLUMN} y={noStepY + OVERVIEW_ROW / 2} pills={pillsOf(page.measures, page.no_step, NO_STEP_COVERS, openItems)} />
        </g>
      )}
      <StageRule y={deliveryY} />
      <Line from={deliveryY} to={deliveryY + OVERVIEW_ROW / 2} />
      <DeliveryBar y={deliveryY + OVERVIEW_ROW / 2} />
      {page.delivered > 0 && <ItemBox dotX={ITEM_COLUMN} y={deliveryY + OVERVIEW_ROW / 2} boxText={page.delivered} tip={`${page.delivered} work items delivered`} testId="delivered" onOpen={openDelivered} />}
      {page.waiting_to_deliver.length > 0 && (
        <ItemBox
          dotX={ITEM_COLUMN - itemBoxWidth(page.delivered) - 16}
          y={deliveryY + OVERVIEW_ROW / 2}
          boxText={page.waiting_to_deliver.length}
          tip={describeItems(page.waiting_to_deliver, 'waiting to be delivered')}
          onOpen={(point) => openItems('waiting to be delivered', page.waiting_to_deliver, point)}
        />
      )}
      <StageRule y={afterDeliveryY} dotted />
      <AfterDeliveryLine from={afterDeliveryY - OVERVIEW_ROW / 2 + 4} to={afterDeliveryY + OVERVIEW_ROW} />
    </Drawing>
  )
}
