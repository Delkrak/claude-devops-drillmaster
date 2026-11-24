import { Fragment } from 'react'
import { timeOfDay } from '../../time'
import type { ItemMark, ShownMeasure, WorkItemPage, WorkItemPageStep } from '../../types'
import { CallLine, DeeperButton, KeptOutput, Label, Level, Para, Quote, UnderStep } from '../../ui/item/route'
import { toneOfMeasure } from '../measures'
import { asSentence, hasEvidence, keptOutputName, markLabel, whoDecided } from './words'

export type DetailDepth = 1 | 2 | 3

function MarkText({ mark, measures, placed }: { mark: ItemMark; measures: readonly ShownMeasure[]; placed: boolean }) {
  return (
    <>
      <Label tone={toneOfMeasure(measures, mark.measure)}>
        {markLabel(mark)} · {timeOfDay(mark.at)}
      </Label>
      {mark.prompts.map((prompt) => (
        <Quote key={prompt}>{prompt}</Quote>
      ))}
      <Label>why it counts</Label>
      <Para>{mark.why}</Para>
      {mark.placed_why && (
        <>
          <Label>{placed ? 'why this step should have caught it' : 'why no step covers it'}</Label>
          <Para>{mark.placed_why}</Para>
        </>
      )}
    </>
  )
}

function WhatHappened({ step, measures }: { step: WorkItemPageStep; measures: readonly ShownMeasure[] }) {
  const { happened } = step
  const nothingHappened = !happened.skip && happened.verdicts.length === 0 && !happened.submitted && happened.reports.length === 0 && step.marks.length === 0
  return (
    <>
      {step.marks.map((mark, index) => (
        <MarkText key={index} mark={mark} measures={measures} placed />
      ))}
      {happened.skip && (
        <>
          <Label>skipped</Label>
          <Para>{asSentence(happened.skip.why)}</Para>
        </>
      )}
      {happened.verdicts.map((verdict) => (
        <Fragment key={verdict.at}>
          <Label tone={verdict.accepted ? undefined : 'sand'}>
            {verdict.accepted ? 'passed' : 'sent back'} · {whoDecided(verdict.by)} · {timeOfDay(verdict.at)}
          </Label>
          {verdict.by !== 'agent' && <Para>{verdict.why}</Para>}
        </Fragment>
      ))}
      {step.status === 'here' && (
        <Label tone="sand">{happened.waiting_for === 'drillmaster' ? "waiting for Drillmaster's review" : happened.waiting_for === 'owner' ? 'waiting for you' : 'Agent is working on this step'}</Label>
      )}
      {happened.submitted && (
        <>
          <Label>Agent reported</Label>
          <Para>{happened.submitted}</Para>
        </>
      )}
      {happened.reports.map((report, index) => (
        <Fragment key={index}>
          <Label>{report.kind}</Label>
          <Para>{report.text}</Para>
        </Fragment>
      ))}
      {nothingHappened && <Para quiet>{step.status === 'here' ? 'Nothing reported here yet.' : 'Not reached yet.'}</Para>}
    </>
  )
}

function Evidence({ step }: { step: WorkItemPageStep }) {
  return (
    <>
      {step.evidence.self_check.map((check) => (
        <Fragment key={check.rule}>
          <Label>
            {check.accepted ? '✓' : '✗'} Agent checked rule {check.rule}
          </Label>
          <Para>{check.evidence}</Para>
        </Fragment>
      ))}
      {step.evidence.kept_output.map((output, index) => (
        <Fragment key={index}>
          <Label>{keptOutputName(output.name)}, as the tool printed them</Label>
          <KeptOutput lines={output.lines} />
        </Fragment>
      ))}
    </>
  )
}

export function StepDetail({ step, measures, depth, onOpenDeeper }: { step: WorkItemPageStep; measures: readonly ShownMeasure[]; depth: DetailDepth; onOpenDeeper: (depth: DetailDepth) => void }) {
  const isReached = step.status === 'passed' || step.status === 'here'
  const showsEvidence = isReached && hasEvidence(step)
  const callsDepth: DetailDepth = showsEvidence ? 3 : 2
  const deeperButton = () => {
    if (showsEvidence && depth === 1) return <DeeperButton onOpen={() => onOpenDeeper(2)}>the evidence ›</DeeperButton>
    if (isReached && step.calls.length > 0 && depth === callsDepth - 1) return <DeeperButton onOpen={() => onOpenDeeper(callsDepth)}>every tool call · {step.calls.length} ›</DeeperButton>
    return null
  }
  return (
    <UnderStep testId="step-detail">
      <Level>
        <WhatHappened step={step} measures={measures} />
        {depth === 1 && deeperButton()}
      </Level>
      {showsEvidence && depth >= 2 && (
        <Level deeper>
          <Evidence step={step} />
          {depth === 2 && deeperButton()}
        </Level>
      )}
      {depth >= callsDepth && (
        <Level deeper>
          {step.calls.map((call, index) => (
            <CallLine key={index} time={timeOfDay(call.at)} tool={call.tool} failed={call.failed} did={call.did} />
          ))}
        </Level>
      )}
    </UnderStep>
  )
}

export function DeliveryDetail({ delivered }: { delivered: NonNullable<WorkItemPage['delivered']> }) {
  return (
    <UnderStep testId="delivery-detail">
      <Level>
        <Label>delivered · {timeOfDay(delivered.at)}</Label>
        {delivered.summary && <Para>{delivered.summary}</Para>}
        {delivered.added_steps.map((addedStep) => (
          <Fragment key={addedStep.at}>
            <Label tone="sand">added after delivery · {timeOfDay(addedStep.at)}</Label>
            <Para>{addedStep.text}</Para>
            {addedStep.why && <Para quiet>{addedStep.why}</Para>}
          </Fragment>
        ))}
        {delivered.post_mortems.map((postMortem) => (
          <Fragment key={postMortem.author}>
            <Label>{postMortem.author === 'drillmaster' ? 'Drillmaster' : 'Agent'}: keep</Label>
            {postMortem.keep.map((text, index) => (
              <Para key={index}>{text}</Para>
            ))}
            {postMortem.change.length > 0 && (
              <Label tone="sand">{postMortem.author === 'drillmaster' ? 'Drillmaster' : 'Agent'}: change</Label>
            )}
            {postMortem.change.map((text, index) => (
              <Para key={index}>{text}</Para>
            ))}
          </Fragment>
        ))}
      </Level>
    </UnderStep>
  )
}

export const NoStepMarksDetail = ({ marks, measures }: { marks: readonly ItemMark[]; measures: readonly ShownMeasure[] }) => (
  <UnderStep testId="no-step-detail">
    <Level>
      {marks.map((mark, index) => (
        <MarkText key={index} mark={mark} measures={measures} placed={false} />
      ))}
    </Level>
  </UnderStep>
)
