import type { ReactNode } from 'react'
import type { WorkItemPage, WorkItemPageStep } from '../../types'
import { UnderRow } from '../../ui/item/route'
import { AXIS, BRANCH_OFFSET, FRICTION_COLUMN, ITEM_COLUMN, ROUTE_ROW, ROUTE_SPLIT, splitAlternatives } from '../../ui/workflow/geometry'
import { Drawing } from '../../ui/workflow/layout'
import { AfterDeliveryLine, Branch, DeliveryBar, FrictionRing, ItemBox, Line, LineWord, Opener, ReviewMarks, StageLabel, StageRule, Stop, StepLabel, stopKindOf, type LineTone, type Reached } from '../../ui/workflow/marks'
import { estimatedLabelWidth } from '../workflow/describe'
import { DeliveryDetail, StepDetail, UnplacedStepInsDetail, type DetailDepth } from './StepDetail'
import { stepNoteOf } from './words'

const STEP_NAME_FONT_SIZE = 17
const STAGE_HEAD_ROOM = 16

const reachedOf = (step: WorkItemPageStep): Reached => (step.status === 'skipped' ? 'skipped' : step.status === 'ahead' ? 'ahead' : 'yes')
const lineToneAbove = (step: WorkItemPageStep): LineTone => (step.status === 'ahead' ? 'ahead' : 'lit')
const lineToneBelow = (step: WorkItemPageStep): LineTone => (step.status === 'passed' || step.status === 'skipped' ? 'lit' : 'ahead')
const branchToneOf = (step: WorkItemPageStep): LineTone => (step.status === 'skipped' ? 'faded' : lineToneBelow(step))

export type OpenedDepths = ReadonlyMap<string, DetailDepth>
const DELIVERY_KEY = 'delivery'
const UNPLACED_KEY = 'unplaced'

interface RouteProps {
  page: WorkItemPage
  opened: OpenedDepths
  onOpen: (key: string, depth: DetailDepth | null) => void
}

function RouteStep({ step, stageNumber, x, y, side, onBranch, page, opened, onOpen }: { step: WorkItemPageStep; stageNumber: number; x: number; y: number; side: 'left' | 'right'; onBranch: boolean } & RouteProps) {
  const nameWidth = estimatedLabelWidth(step.name, STEP_NAME_FONT_SIZE)
  const passedCount = step.happened.verdicts.filter((verdict) => verdict.by === 'drillmaster' && verdict.accepted).length
  const sentBackCount = step.happened.verdicts.filter((verdict) => !verdict.accepted && verdict.by !== 'agent').length
  const itemX = !onBranch ? ITEM_COLUMN : side === 'left' ? x - 30 - nameWidth - 20 : x - 22
  const note = stepNoteOf(step)
  const isOpen = opened.has(step.guid)
  return (
    <Opener y={y + (note ? 4 : 0)} height={ROUTE_ROW} label={`${stageNumber}.${step.n} ${step.name}`} open={isOpen} onToggle={() => onOpen(step.guid, isOpen ? null : 1)} testId="route-step">
      <Stop x={x} y={y} kind={stopKindOf(step)} condition={step.when && `only when ${step.when}`} reached={reachedOf(step)} />
      <StepLabel x={x} y={y} side={side} name={step.name} note={note} reached={reachedOf(step)} noteTone={step.status === 'here' ? 'sand' : 'dim'} />
      {step.status === 'here' && <ItemBox dotX={itemX} y={y} boxText={page.issue} tip={`${page.issue} is here now`} testId="here" />}
      <ReviewMarks passedX={side === 'left' ? x - 30 - nameWidth - 16 : x - 24} sentBackX={side === 'right' ? x + 30 + nameWidth + 16 : AXIS + 40} y={y} passedCount={passedCount} sentBackCount={sentBackCount} showsPassedCount={false} />
      {step.step_ins.length > 0 && (
        <FrictionRing
          x={side === 'right' ? x + 30 + nameWidth + (sentBackCount > 0 ? 70 : 24) : x + 30}
          y={y}
          count={step.step_ins.length}
          tip={`you stepped in ${step.step_ins.length === 1 ? 'once' : `${step.step_ins.length} times`}; this step should have caught it`}
        />
      )}
    </Opener>
  )
}

function OpenedUnderRow({ steps, tone, page, opened, onOpen }: { steps: readonly WorkItemPageStep[]; tone: LineTone } & RouteProps) {
  const openSteps = steps.filter((step) => opened.has(step.guid))
  if (openSteps.length === 0) return null
  return (
    <UnderRow tone={tone}>
      {openSteps.map((step) => (
        <StepDetail key={step.guid} step={step} depth={opened.get(step.guid)!} onOpenDeeper={(depth) => onOpen(step.guid, depth)} />
      ))}
    </UnderRow>
  )
}

function StageRows({ stage, ...props }: { stage: WorkItemPage['stages'][number] } & RouteProps) {
  const rows: ReactNode[] = []
  splitAlternatives(stage.steps).forEach((stepOrAlternatives, index) => {
    const isFirstRow = index === 0
    const stageHead = isFirstRow && (
      <>
        <StageRule y={0} />
        <StageLabel x={44} y={30} n={stage.n} name={stage.name} />
      </>
    )
    if (Array.isArray(stepOrAlternatives)) {
      const [left, right] = stepOrAlternatives
      const top = isFirstRow ? STAGE_HEAD_ROOM : 4
      const bottom = top + ROUTE_SPLIT * 2 + ROUTE_ROW
      const height = bottom + 14
      const middle = top + ROUTE_SPLIT + ROUTE_ROW / 2
      const toneBelowRow: LineTone = stepOrAlternatives.some((step) => lineToneBelow(step) === 'ahead' && step.status !== 'skipped') ? 'ahead' : 'lit'
      // the branch it took is drawn over the one it did not
      const branches = left.status === 'skipped' ? ([[left, AXIS - BRANCH_OFFSET], [right, AXIS + BRANCH_OFFSET]] as const) : ([[right, AXIS + BRANCH_OFFSET], [left, AXIS - BRANCH_OFFSET]] as const)
      rows.push(
        <Drawing key={left.guid} height={height} testId="route-row">
          {stageHead}
          <Line from={0} to={top} tone={stepOrAlternatives.every((step) => step.status === 'ahead') ? 'ahead' : 'lit'} />
          {branches.map(([step, x]) => (
            <Branch key={step.guid} from={top} to={bottom} x={x} tone={branchToneOf(step)} />
          ))}
          <Line from={bottom} to={height} tone={toneBelowRow} />
          <RouteStep step={left} stageNumber={stage.n} x={AXIS - BRANCH_OFFSET} y={middle} side="left" onBranch {...props} />
          <RouteStep step={right} stageNumber={stage.n} x={AXIS + BRANCH_OFFSET} y={middle} side="right" onBranch {...props} />
        </Drawing>,
        <OpenedUnderRow key={`${left.guid}-opened`} steps={stepOrAlternatives} tone={toneBelowRow} {...props} />,
      )
      return
    }
    const step = stepOrAlternatives
    const top = isFirstRow ? STAGE_HEAD_ROOM : 0
    const height = top + ROUTE_ROW + (stepNoteOf(step) ? 8 : 0)
    const middle = top + ROUTE_ROW / 2
    rows.push(
      <Drawing key={step.guid} height={height} testId="route-row">
        {stageHead}
        <Line from={0} to={middle} tone={lineToneAbove(step)} />
        <Line from={middle} to={height} tone={lineToneBelow(step)} />
        <RouteStep step={step} stageNumber={stage.n} x={AXIS} y={middle} side="right" onBranch={false} {...props} />
      </Drawing>,
      <OpenedUnderRow key={`${step.guid}-opened`} steps={[step]} tone={lineToneBelow(step)} {...props} />,
    )
  })
  return <>{rows}</>
}

const DELIVERY_BAR_Y = 20
const UNPLACED_RING_Y = 66

function RouteEnd({ page, opened, onOpen }: RouteProps) {
  const delivered = page.delivered
  const unplacedStepIns = page.step_ins_unplaced
  const height = delivered ? 100 : unplacedStepIns.length > 0 ? 90 : 40
  const deliveryOpen = opened.has(DELIVERY_KEY)
  const unplacedOpen = opened.has(UNPLACED_KEY)
  return (
    <>
      <Drawing height={height} testId="route-end">
        <StageRule y={0} />
        <Line from={0} to={DELIVERY_BAR_Y} tone={delivered ? 'lit' : 'ahead'} />
        <DeliveryBar y={DELIVERY_BAR_Y} reached={delivered !== null} />
        {delivered && (
          <Opener y={DELIVERY_BAR_Y} height={36} label="delivered" open={deliveryOpen} onToggle={() => onOpen(DELIVERY_KEY, deliveryOpen ? null : 1)} testId="delivered">
            <LineWord x={AXIS + 26} y={DELIVERY_BAR_Y}>
              delivered
            </LineWord>
          </Opener>
        )}
        {delivered && <AfterDeliveryLine from={DELIVERY_BAR_Y + 2} to={height} />}
        {unplacedStepIns.length > 0 && (
          <Opener y={UNPLACED_RING_Y} height={36} label="your step-ins no step should have caught" open={unplacedOpen} onToggle={() => onOpen(UNPLACED_KEY, unplacedOpen ? null : 1)} testId="unplaced">
            <FrictionRing x={FRICTION_COLUMN} y={UNPLACED_RING_Y} count={unplacedStepIns.length} tip={`you stepped in ${unplacedStepIns.length === 1 ? 'once' : `${unplacedStepIns.length} times`}${delivered ? ' after delivery' : ''}; no step should have caught it`} />
          </Opener>
        )}
      </Drawing>
      {(deliveryOpen || unplacedOpen) && (
        <UnderRow tone={delivered ? 'lit' : 'ahead'}>
          {deliveryOpen && delivered && <DeliveryDetail delivered={delivered} />}
          {unplacedOpen && <UnplacedStepInsDetail stepIns={unplacedStepIns} />}
        </UnderRow>
      )}
    </>
  )
}

export function Route(props: RouteProps) {
  return (
    <>
      {props.page.stages.map((stage) => (
        <StageRows key={stage.guid} stage={stage} {...props} />
      ))}
      <RouteEnd {...props} />
    </>
  )
}

