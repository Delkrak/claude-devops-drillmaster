import type { WorkflowPage } from '../../types'
import { FRICTION_COLUMN, ITEM_COLUMN, itemBoxWidth, OVERVIEW_ROW } from '../../ui/workflow/geometry'
import { Drawing } from '../../ui/workflow/layout'
import { AfterDeliveryLine, DeliveryBar, FrictionRing, ItemBox, Jump, Line, StageLabel, StageRule, StageTick } from '../../ui/workflow/marks'
import { describeItems, stageAnchorId, unplacedTip, type OpenItems } from './describe'

export function Overview({ page, openItems, openDelivered }: { page: WorkflowPage; openItems: OpenItems; openDelivered: () => void }) {
  const deliveryY = page.stages.length * OVERVIEW_ROW
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
            {stage.friction > 0 && <FrictionRing x={FRICTION_COLUMN} y={middle} count={stage.friction} tip={`you stepped in ${stage.friction} times in this stage`} onOpen={(point) => openItems('you stepped in on', stage.stepped_in, point)} />}
            </g>
          </Jump>
        )
      })}
      <StageRule y={deliveryY} />
      <Line from={deliveryY} to={deliveryY + OVERVIEW_ROW / 2} />
      <DeliveryBar y={deliveryY + OVERVIEW_ROW / 2} />
      {page.delivered > 0 && <ItemBox dotX={ITEM_COLUMN} y={deliveryY + OVERVIEW_ROW / 2} boxText={page.delivered} tip={`${page.delivered} work items delivered`} testId="delivered" onOpen={openDelivered} />}
      {page.friction.unplaced > 0 && <FrictionRing x={FRICTION_COLUMN} y={deliveryY + OVERVIEW_ROW / 2} count={page.friction.unplaced} tip={unplacedTip(page.friction.unplaced)} onOpen={(point) => openItems('you stepped in on', page.friction.unplaced_items, point)} />}
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
      {page.friction.after_delivery > 0 && (
        <FrictionRing x={FRICTION_COLUMN} y={afterDeliveryY + OVERVIEW_ROW / 2} count={page.friction.after_delivery} tip={`you stepped in ${page.friction.after_delivery} times after delivery`} onOpen={(point) => openItems('you stepped in after delivery on', page.friction.after_delivery_items, point)} />
      )}
    </Drawing>
  )
}
