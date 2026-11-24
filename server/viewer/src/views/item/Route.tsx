import type { ReactNode } from 'react'
import type { ItemMark, WorkItemPage, WorkItemPageStep } from '../../types'
import { UnderRow } from '../../ui/item/route'
import { AXIS, BRANCH_OFFSET, MEASURE_COLUMN, ITEM_COLUMN, ROUTE_ROW, ROUTE_SPLIT, splitAlternatives } from '../../ui/workflow/geometry'
import { Drawing } from '../../ui/workflow/layout'
import { AfterDeliveryLine, Branch, DeliveryBar, ItemBox, Line, LineWord, MeasurePills, Opener, RowName, ReviewMarks, StageLabel, StageRule, Stop, StepLabel, stopKindOf, type LineTone, type MeasurePill, type Reached } from '../../ui/workflow/marks'
import { estimatedLabelWidth, NO_STEP_ROW_NAME } from '../workflow/describe'
import { measureTip, shortOfMeasure, toneOfMeasure } from '../measures'
import { DeliveryDetail, NoStepMarksDetail, StepDetail, type DetailDepth } from './StepDetail'
import { stepNoteOf } from './words'

const STEP_NAME_FONT_SIZE = 17
const STAGE_HEAD_ROOM = 16

const reachedOf = (step: WorkItemPageStep): Reached => (step.status === 'skipped' ? 'skipped' : step.status === 'ahead' ? 'ahead' : 'yes')
const lineToneAbove = (step: WorkItemPageStep): LineTone => (step.status === 'ahead' ? 'ahead' : 'lit')
const lineToneBelow = (step: WorkItemPageStep): LineTone => (step.status === 'passed' || step.status === 'skipped' ? 'lit' : 'ahead')
const branchToneOf = (step: WorkItemPageStep): LineTone => (step.status === 'skipped' ? 'faded' : lineToneBelow(step))

export type OpenedDepths = ReadonlyMap<string, DetailDepth>
const DELIVERY_KEY = 'delivery'
const NO_STEP_KEY = 'no step'

/** A pill per measure among the marks, in the key's order. */
function pillsOfMarks(page: WorkItemPage, marks: readonly ItemMark[], where: string): MeasurePill[] {
  return page.measures.flatMap((measure) => {
    const count = marks.filter((mark) => mark.measure === measure.name).length
    return count ? [{ measure: measure.name, short: shortOfMeasure(page.measures, measure.name), count, tone: toneOfMeasure(page.measures, measure.name), tip: measureTip(page.measures, measure.name, count, where) }] : []
  })
}

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
      <MeasurePills x={side === 'right' ? x + 30 + nameWidth + (sentBackCount > 0 ? 70 : 24) : x + 30} y={y} pills={pillsOfMarks(page, step.marks, '; this step should have caught it')} />
    </Opener>
  )
}

function OpenedUnderRow({ steps, tone, page, opened, onOpen }: { steps: readonly WorkItemPageStep[]; tone: LineTone } & RouteProps) {
  const openSteps = steps.filter((step) => opened.has(step.guid))
  if (openSteps.length === 0) return null
  return (
    <UnderRow tone={tone}>
      {openSteps.map((step) => (
        <StepDetail key={step.guid} step={step} measures={page.measures} depth={opened.get(step.guid)!} onOpenDeeper={(depth) => onOpen(step.guid, depth)} />
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

const NO_STEP_ROW = 56
const NO_STEP_PILL_Y = 26
const DELIVERY_BAR_Y = 20

function RouteEnd({ page, opened, onOpen }: RouteProps) {
  const delivered = page.delivered
  const noStepMarks = page.marks_no_step
  const top = noStepMarks.length > 0 ? NO_STEP_ROW : 0
  const height = top + (delivered ? 70 : 40)
  const deliveryOpen = opened.has(DELIVERY_KEY)
  const noStepOpen = opened.has(NO_STEP_KEY)
  const lineTone = delivered ? 'lit' : 'ahead'
  return (
    <>
      <Drawing height={height} testId="route-end">
        <StageRule y={0} />
        {noStepMarks.length > 0 && (
          <Opener y={NO_STEP_PILL_Y} height={36} label="what no step covers" open={noStepOpen} onToggle={() => onOpen(NO_STEP_KEY, noStepOpen ? null : 1)} testId="no-step">
            <RowName y={NO_STEP_PILL_Y + 5}>{NO_STEP_ROW_NAME}</RowName>
            <MeasurePills x={MEASURE_COLUMN} y={NO_STEP_PILL_Y} pills={pillsOfMarks(page, noStepMarks, '; no step of the workflow covers it')} />
          </Opener>
        )}
        {noStepMarks.length > 0 && <StageRule y={top} />}
        <Line from={0} to={top + DELIVERY_BAR_Y} tone={lineTone} />
        <DeliveryBar y={top + DELIVERY_BAR_Y} reached={delivered !== null} />
        {delivered && (
          <Opener y={top + DELIVERY_BAR_Y} height={36} label="delivered" open={deliveryOpen} onToggle={() => onOpen(DELIVERY_KEY, deliveryOpen ? null : 1)} testId="delivered">
            <LineWord x={AXIS + 26} y={top + DELIVERY_BAR_Y}>
              delivered
            </LineWord>
          </Opener>
        )}
        {delivered && <AfterDeliveryLine from={top + DELIVERY_BAR_Y + 2} to={height} />}
      </Drawing>
      {(deliveryOpen || noStepOpen) && (
        <UnderRow tone={delivered ? 'lit' : 'ahead'}>
          {deliveryOpen && delivered && <DeliveryDetail delivered={delivered} />}
          {noStepOpen && <NoStepMarksDetail marks={noStepMarks} measures={page.measures} />}
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

