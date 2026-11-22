import type { ReactNode } from 'react'
import type { WorkflowPageStage, WorkflowPageStep } from '../../types'
import { AFTER_SPLIT, AXIS, BRANCH_OFFSET, FRICTION_COLUMN, ITEM_COLUMN, itemBoxWidth, SPLIT_HEIGHT, splitAlternatives, STAGE_HEADER, STEP_ROW } from '../../ui/workflow/geometry'
import { Drawing } from '../../ui/workflow/layout'
import { Branch, FrictionRing, ItemBox, Line, ReviewMarks, StageLabel, StageRule, Stop, StepLabel, stopKindOf } from '../../ui/workflow/marks'
import { describeItems, estimatedLabelWidth, stageAnchorId, type OpenItems } from './describe'

const STEP_NAME_FONT_SIZE = 17

function DrawnStep({ step, x, y, side, onBranch, openItems }: { step: WorkflowPageStep; x: number; y: number; side: 'left' | 'right'; onBranch: boolean; openItems: OpenItems }) {
  const nameWidth = estimatedLabelWidth(step.name, STEP_NAME_FONT_SIZE)
  const itemsDotX = !onBranch ? ITEM_COLUMN : side === 'left' ? x - 30 - nameWidth - 20 : x - 22
  const hereNowCount = step.here_now.length
  return (
    <g data-testid="walk-step">
      <Stop x={x} y={y} kind={stopKindOf(step)} condition={step.if} />
      <StepLabel x={x} y={y} side={side} name={step.name} note={onBranch && step.alternative ? step.alternative.value : step.when && `only when ${step.when}`} />
      {hereNowCount > 0 && <ItemBox dotX={itemsDotX} y={y} boxText={hereNowCount} tip={describeItems(step.here_now, 'here now')} onOpen={(point) => openItems('here now', step.here_now, point)} />}
      <ReviewMarks
        passedX={hereNowCount > 0 ? itemsDotX + 12 - itemBoxWidth(hereNowCount) - 14 : itemsDotX + 12}
        sentBackX={side === 'right' ? x + 30 + nameWidth + 16 : AXIS + 40}
        y={y}
        passedCount={step.reviews.passed}
        sentBackCount={step.reviews.sent_back}
      />
    </g>
  )
}

export function StageWalk({ stage, openItems }: { stage: WorkflowPageStage; openItems: OpenItems }) {
  const drawnParts: ReactNode[] = []
  let y = STAGE_HEADER
  let straightLineFrom = 0
  for (const stepOrAlternatives of splitAlternatives(stage.steps)) {
    if (Array.isArray(stepOrAlternatives)) {
      const [left, right] = stepOrAlternatives
      const top = y
      const bottom = y + SPLIT_HEIGHT
      const middle = (top + bottom) / 2
      drawnParts.push(<Line key={`line-${top}`} from={straightLineFrom} to={top} />)
      drawnParts.push(<Branch key={`left-${top}`} from={top} to={bottom} x={AXIS - BRANCH_OFFSET} />, <Branch key={`right-${top}`} from={top} to={bottom} x={AXIS + BRANCH_OFFSET} />)
      drawnParts.push(<DrawnStep key={left.guid} step={left} x={AXIS - BRANCH_OFFSET} y={middle} side="left" onBranch openItems={openItems} />)
      drawnParts.push(<DrawnStep key={right.guid} step={right} x={AXIS + BRANCH_OFFSET} y={middle} side="right" onBranch openItems={openItems} />)
      straightLineFrom = bottom
      y = bottom + AFTER_SPLIT
    } else {
      drawnParts.push(<DrawnStep key={stepOrAlternatives.guid} step={stepOrAlternatives} x={AXIS} y={y + 20} side="right" onBranch={false} openItems={openItems} />)
      y += STEP_ROW
    }
  }
  const height = y
  return (
    <Drawing height={height} testId="walk-stage" id={stageAnchorId(stage.n)} label={`stage ${stage.n}, ${stage.name}${stage.when ? `, only when ${stage.when}` : ''}`}>
      <StageRule y={0} />
      <StageLabel x={44} y={30} n={stage.n} name={stage.name} />
      <Line from={straightLineFrom} to={height} />
      {drawnParts}
      {stage.friction > 0 && <FrictionRing x={FRICTION_COLUMN} y={26} count={stage.friction} tip={`you stepped in ${stage.friction} times in this stage`} onOpen={(point) => openItems('you stepped in on', stage.stepped_in, point)} />}
    </Drawing>
  )
}
