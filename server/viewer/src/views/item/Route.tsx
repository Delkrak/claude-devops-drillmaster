import type { ReactNode } from 'react'
import type { WorkItemPage, WorkItemPageStep } from '../../types'
import { UnderRow } from '../../ui/item/route'
import { AXIS, ITEM_COLUMN, PROBLEM_COLUMN, ROUTE_ROW, ROUTE_SPLIT, SPLIT, splitAlternatives } from '../../ui/workflow/geometry'
import { Drawing } from '../../ui/workflow/layout'
import { AfterDeliveryLine, Branch, DeliveryBar, FrictionRing, ItemBox, Line, LineWord, Opener, ReviewMarks, StageLabel, StageRule, Stop, StepLabel, stopKindOf, type LineTone, type Reached } from '../../ui/workflow/marks'
import { labelWidth } from '../workflow/describe'
import { DeliveryDetail, StepDetail, StepInsDetail, type Depth } from './StepDetail'
import { noteOf } from './words'

const STEP_NAME_SIZE = 17
/** Room above the first row of a stage, for its rule and its name. */
const STAGE_TOP = 16

const reachedOf = (step: WorkItemPageStep): Reached => (step.status === 'skipped' ? 'skipped' : step.status === 'ahead' ? 'ahead' : 'yes')
/** The line above a step is lit once the work item got there; below it once it went on. */
const toneAbove = (step: WorkItemPageStep): LineTone => (step.status === 'ahead' ? 'ahead' : 'lit')
const toneBelow = (step: WorkItemPageStep): LineTone => (step.status === 'passed' || step.status === 'skipped' ? 'lit' : 'ahead')
const toneOfBranch = (step: WorkItemPageStep): LineTone => (step.status === 'skipped' ? 'faded' : toneBelow(step))

/** What Owner has opened on the route: a step by its GUID, the delivery, or the step-ins no step should have caught. */
export type Opened = ReadonlyMap<string, Depth>
export const DELIVERY = 'delivery'
export const UNPLACED = 'unplaced'

interface RouteProps {
  page: WorkItemPage
  opened: Opened
  onOpen: (key: string, depth: Depth | null) => void
}

/** A step on the route at (x, y): its stop, its name, the work item if it is here, Drillmaster's marks, and Owner's step-ins. */
function RouteStep({ step, stageN, x, y, side, onBranch, page, opened, onOpen }: { step: WorkItemPageStep; stageN: number; x: number; y: number; side: 'left' | 'right'; onBranch: boolean } & RouteProps) {
  const nameWidth = labelWidth(step.name, STEP_NAME_SIZE)
  const passed = step.happened.verdicts.filter((verdict) => verdict.by === 'drillmaster' && verdict.accepted).length
  const sentBack = step.happened.verdicts.filter((verdict) => !verdict.accepted && verdict.by !== 'agent').length
  const itemX = !onBranch ? ITEM_COLUMN : side === 'left' ? x - 30 - nameWidth - 20 : x - 22
  const note = noteOf(step)
  const open = opened.has(step.guid)
  return (
    <Opener y={y + (note ? 4 : 0)} height={ROUTE_ROW} label={`${stageN}.${step.n} ${step.name}`} open={open} onToggle={() => onOpen(step.guid, open ? null : 1)} testId="route-step">
      <Stop x={x} y={y} kind={stopKindOf(step)} condition={step.when && `only when ${step.when}`} reached={reachedOf(step)} />
      <StepLabel x={x} y={y} side={side} name={step.name} note={note} reached={reachedOf(step)} noteTone={step.status === 'here' ? 'sand' : 'dim'} />
      {step.status === 'here' && <ItemBox dotX={itemX} y={y} count={page.issue} tip={`${page.issue} is here now`} testId="here" />}
      <ReviewMarks passedX={side === 'left' ? x - 30 - nameWidth - 16 : x - 24} sentBackX={side === 'right' ? x + 30 + nameWidth + 16 : AXIS + 40} y={y} passed={passed} sentBack={sentBack} counted={false} />
      {step.step_ins.length > 0 && (
        <FrictionRing
          x={side === 'right' ? x + 30 + nameWidth + (sentBack > 0 ? 70 : 24) : x + 30}
          y={y}
          count={step.step_ins.length}
          tip={`you stepped in ${step.step_ins.length === 1 ? 'once' : `${step.step_ins.length} times`}; this step should have caught it`}
        />
      )}
    </Opener>
  )
}

/** What is opened under a row of steps, the line running on beside it. */
function Opened({ steps, tone, page, opened, onOpen }: { steps: readonly WorkItemPageStep[]; tone: LineTone } & RouteProps) {
  const open = steps.filter((step) => opened.has(step.guid))
  if (open.length === 0) return null
  return (
    <UnderRow tone={tone}>
      {open.map((step) => (
        <StepDetail key={step.guid} step={step} item={page} depth={opened.get(step.guid)!} onDeeper={(depth) => onOpen(step.guid, depth)} />
      ))}
    </UnderRow>
  )
}

function StageRows({ stage, ...props }: { stage: WorkItemPage['stages'][number] } & RouteProps) {
  const rows: ReactNode[] = []
  splitAlternatives(stage.steps).forEach((placed, index) => {
    const first = index === 0
    const stageHead = first && (
      <>
        <StageRule y={0} />
        <StageLabel x={44} y={30} n={stage.n} name={stage.name} />
      </>
    )
    if (Array.isArray(placed)) {
      const [left, right] = placed
      const top = first ? STAGE_TOP : 4
      const bottom = top + ROUTE_SPLIT * 2 + ROUTE_ROW
      const height = bottom + 14
      const middle = top + ROUTE_SPLIT + ROUTE_ROW / 2
      const below: LineTone = placed.some((step) => toneBelow(step) === 'ahead' && step.status !== 'skipped') ? 'ahead' : 'lit'
      // the branch it took is drawn over the one it did not
      const branches = left.status === 'skipped' ? ([[left, AXIS - SPLIT], [right, AXIS + SPLIT]] as const) : ([[right, AXIS + SPLIT], [left, AXIS - SPLIT]] as const)
      rows.push(
        <Drawing key={left.guid} height={height} testId="route-row">
          {stageHead}
          <Line from={0} to={top} tone={placed.every((step) => step.status === 'ahead') ? 'ahead' : 'lit'} />
          {branches.map(([step, x]) => (
            <Branch key={step.guid} from={top} to={bottom} x={x} tone={toneOfBranch(step)} />
          ))}
          <Line from={bottom} to={height} tone={below} />
          <RouteStep step={left} stageN={stage.n} x={AXIS - SPLIT} y={middle} side="left" onBranch {...props} />
          <RouteStep step={right} stageN={stage.n} x={AXIS + SPLIT} y={middle} side="right" onBranch {...props} />
        </Drawing>,
        <Opened key={`${left.guid}-opened`} steps={placed} tone={below} {...props} />,
      )
      return
    }
    const top = first ? STAGE_TOP : 0
    const height = top + ROUTE_ROW + (noteOf(placed) ? 8 : 0)
    const middle = top + ROUTE_ROW / 2
    rows.push(
      <Drawing key={placed.guid} height={height} testId="route-row">
        {stageHead}
        <Line from={0} to={middle} tone={toneAbove(placed)} />
        <Line from={middle} to={height} tone={toneBelow(placed)} />
        <RouteStep step={placed} stageN={stage.n} x={AXIS} y={middle} side="right" onBranch={false} {...props} />
      </Drawing>,
      <Opened key={`${placed.guid}-opened`} steps={[placed]} tone={toneBelow(placed)} {...props} />,
    )
  })
  return <>{rows}</>
}

const BAR_Y = 20
const AFTER_RING_Y = 66

/** The end of the route: delivered, and Owner's step-ins that no step should have caught. */
function RouteEnd({ page, opened, onOpen }: RouteProps) {
  const delivered = page.delivered
  const unplaced = page.step_ins_unplaced
  const height = delivered ? 100 : unplaced.length > 0 ? 90 : 40
  const deliveryOpen = opened.has(DELIVERY)
  const unplacedOpen = opened.has(UNPLACED)
  return (
    <>
      <Drawing height={height} testId="route-end">
        <StageRule y={0} />
        <Line from={0} to={BAR_Y} tone={delivered ? 'lit' : 'ahead'} />
        <DeliveryBar y={BAR_Y} reached={delivered !== null} />
        {delivered && (
          <Opener y={BAR_Y} height={36} label="delivered" open={deliveryOpen} onToggle={() => onOpen(DELIVERY, deliveryOpen ? null : 1)} testId="delivered">
            <LineWord x={AXIS + 26} y={BAR_Y}>
              delivered
            </LineWord>
          </Opener>
        )}
        {delivered && <AfterDeliveryLine from={BAR_Y + 2} to={height} />}
        {unplaced.length > 0 && (
          <Opener y={AFTER_RING_Y} height={36} label="your step-ins no step should have caught" open={unplacedOpen} onToggle={() => onOpen(UNPLACED, unplacedOpen ? null : 1)} testId="unplaced">
            <FrictionRing x={PROBLEM_COLUMN} y={AFTER_RING_Y} count={unplaced.length} tip={`you stepped in ${unplaced.length === 1 ? 'once' : `${unplaced.length} times`}${delivered ? ' after delivery' : ''}; no step should have caught it`} />
          </Opener>
        )}
      </Drawing>
      {(deliveryOpen || unplacedOpen) && (
        <UnderRow tone={delivered ? 'lit' : 'ahead'}>
          {deliveryOpen && delivered && <DeliveryDetail delivered={delivered} />}
          {unplacedOpen && <StepInsDetail stepIns={unplaced} />}
        </UnderRow>
      )}
    </>
  )
}

/** The work item's route along the workflow it runs on, with what Owner opened under its steps. */
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

