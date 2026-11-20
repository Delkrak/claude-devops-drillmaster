import type { ReactNode } from 'react'
import type { WorkflowPageStage, WorkflowPageStep } from '../../types'
import { AFTER_SPLIT, AXIS, ITEM_COLUMN, itemBoxWidth, PROBLEM_COLUMN, SPLIT, SPLIT_HEIGHT, splitAlternatives, STAGE_HEADER, STEP_ROW } from '../../ui/workflow/geometry'
import { Drawing } from '../../ui/workflow/layout'
import { Branch, FrictionRing, ItemBox, Line, ReviewMarks, StageLabel, StageRule, Stop, StepLabel, type StopKind } from '../../ui/workflow/marks'
import { describeItems, labelWidth, stageAnchor } from './describe'

const STEP_NAME_SIZE = 17

const kindOf = (step: WorkflowPageStep): StopKind => (step.gate === 'owner' ? 'approve' : step.gate === 'drillmaster' ? 'review' : step.if ? 'if' : 'always')

/**
 * One step drawn at (x, y), its name on `side`. Its work items stand on the work-item side of it: in
 * the item column for a step on the line, beside the stop for a step on a branch.
 */
function DrawnStep({ step, x, y, side, onBranch }: { step: WorkflowPageStep; x: number; y: number; side: 'left' | 'right'; onBranch: boolean }) {
  const nameWidth = labelWidth(step.name, STEP_NAME_SIZE)
  const itemsDotX = !onBranch ? ITEM_COLUMN : side === 'left' ? x - 30 - nameWidth - 20 : x - 22
  const items = step.here_now.length
  return (
    <g data-testid="walk-step">
      <Stop x={x} y={y} kind={kindOf(step)} condition={step.if} />
      <StepLabel x={x} y={y} side={side} name={step.name} note={onBranch && step.alternative ? step.alternative.value : step.when && `only when ${step.when}`} />
      {items > 0 && <ItemBox dotX={itemsDotX} y={y} count={items} tip={describeItems(step.here_now, 'here now')} />}
      <ReviewMarks
        passedX={items > 0 ? itemsDotX + 12 - itemBoxWidth(items) - 14 : itemsDotX + 12}
        sentBackX={side === 'right' ? x + 30 + nameWidth + 16 : AXIS + 40}
        y={y}
        passed={step.reviews.passed}
        sentBack={step.reviews.sent_back}
      />
    </g>
  )
}

/** A stage of the walkthrough: its steps down the line, alternatives as a split that joins again. */
export function StageWalk({ stage }: { stage: WorkflowPageStage }) {
  const parts: ReactNode[] = []
  let y = STAGE_HEADER
  let straightFrom = 0
  for (const placed of splitAlternatives(stage.steps)) {
    if (Array.isArray(placed)) {
      const [left, right] = placed
      const top = y
      const bottom = y + SPLIT_HEIGHT
      const middle = (top + bottom) / 2
      parts.push(<Line key={`line-${top}`} from={straightFrom} to={top} />)
      parts.push(<Branch key={`left-${top}`} from={top} to={bottom} x={AXIS - SPLIT} />, <Branch key={`right-${top}`} from={top} to={bottom} x={AXIS + SPLIT} />)
      parts.push(<DrawnStep key={left.guid} step={left} x={AXIS - SPLIT} y={middle} side="left" onBranch />)
      parts.push(<DrawnStep key={right.guid} step={right} x={AXIS + SPLIT} y={middle} side="right" onBranch />)
      straightFrom = bottom
      y = bottom + AFTER_SPLIT
    } else {
      parts.push(<DrawnStep key={placed.guid} step={placed} x={AXIS} y={y + 20} side="right" onBranch={false} />)
      y += STEP_ROW
    }
  }
  const height = y
  return (
    <Drawing height={height} testId="walk-stage" id={stageAnchor(stage.n)} label={`stage ${stage.n}, ${stage.name}${stage.when ? `, only when ${stage.when}` : ''}`}>
      <StageRule y={0} />
      <StageLabel x={44} y={30} n={stage.n} name={stage.name} />
      <Line from={straightFrom} to={height} />
      {parts}
      {stage.friction > 0 && <FrictionRing x={PROBLEM_COLUMN} y={26} count={stage.friction} tip={`you stepped in ${stage.friction} times in this stage`} />}
    </Drawing>
  )
}
