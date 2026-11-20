import { Fragment } from 'react'
import { timeOfDay } from '../../time'
import type { StepIn, WorkItemPage, WorkItemPageStep } from '../../types'
import { CallLine, Deeper, Kept, Label, Level, Para, Quote, UnderStep } from '../../ui/item/route'
import { hasEvidence, keptName, stepInLabel, whoDecided } from './words'

/** How deep Owner has opened a step: what happened, then the evidence, then every tool call. */
export type Depth = 1 | 2 | 3

function StepInText({ stepIn }: { stepIn: StepIn }) {
  return (
    <>
      <Label tone="orange">
        {stepInLabel(stepIn)} · {timeOfDay(stepIn.at)}
      </Label>
      <Quote>{stepIn.prompt}</Quote>
      <Label>why it counts as friction</Label>
      <Para>{stepIn.why}</Para>
      {stepIn.placed_why && (
        <>
          <Label>why this step should have caught it</Label>
          <Para>{stepIn.placed_why}</Para>
        </>
      )}
    </>
  )
}

function WhatHappened({ step, issue, kind }: { step: WorkItemPageStep; issue: string; kind: string | null }) {
  const { happened } = step
  const nothing = !happened.skip && happened.verdicts.length === 0 && !happened.submitted && happened.reports.length === 0 && step.step_ins.length === 0
  return (
    <>
      {step.step_ins.map((stepIn) => (
        <StepInText key={stepIn.event_id} stepIn={stepIn} />
      ))}
      {happened.skip && (
        <>
          <Label>skipped</Label>
          <Para>{happened.skip.by === 'condition' && step.when ? `Only when ${step.when}. ${issue} is ${kind ? `a ${kind}` : 'not'}.` : happened.skip.why}</Para>
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
      {nothing && <Para quiet>{step.status === 'here' ? 'Nothing reported here yet.' : 'Not reached yet.'}</Para>}
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
          <Label>{keptName(output.name)}, as the tool printed them</Label>
          <Kept lines={output.lines} />
        </Fragment>
      ))}
    </>
  )
}

/** What Owner opened under a step, one level at a time. */
export function StepDetail({ step, item, depth, onDeeper }: { step: WorkItemPageStep; item: Pick<WorkItemPage, 'issue' | 'kind'>; depth: Depth; onDeeper: (depth: Depth) => void }) {
  const reached = step.status === 'passed' || step.status === 'here'
  const evidence = reached && hasEvidence(step)
  // Without evidence, the tool calls are the next level down.
  const callsDepth: Depth = evidence ? 3 : 2
  const deeperButton = () => {
    if (evidence && depth === 1) return <Deeper onOpen={() => onDeeper(2)}>the evidence ›</Deeper>
    if (reached && step.calls.length > 0 && depth === callsDepth - 1) return <Deeper onOpen={() => onDeeper(callsDepth)}>every tool call · {step.calls.length} ›</Deeper>
    return null
  }
  return (
    <UnderStep testId="step-detail">
      <Level>
        <WhatHappened step={step} issue={item.issue} kind={item.kind} />
        {depth === 1 && deeperButton()}
      </Level>
      {evidence && depth >= 2 && (
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

/** What Owner opened at the delivery: what was delivered, and what the post mortems keep and change. */
export function DeliveryDetail({ delivered }: { delivered: NonNullable<WorkItemPage['delivered']> }) {
  return (
    <UnderStep testId="delivery-detail">
      <Level>
        <Label>delivered · {timeOfDay(delivered.at)}</Label>
        {delivered.summary && <Para>{delivered.summary}</Para>}
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

/** What Owner opened at a step-in no step should have caught. */
export const StepInsDetail = ({ stepIns }: { stepIns: readonly StepIn[] }) => (
  <UnderStep testId="step-ins-detail">
    <Level>
      {stepIns.map((stepIn) => (
        <StepInText key={stepIn.event_id} stepIn={stepIn} />
      ))}
    </Level>
  </UnderStep>
)
