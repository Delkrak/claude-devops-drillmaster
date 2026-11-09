import type { ReactNode } from 'react'
import { formatPosition } from '../format'
import type { TimelineEvent } from '../types'
import { Badge, type Tone } from '../ui/Badge'
import { Row } from '../ui/Box'
import { Code, Muted, Pre, Strong } from '../ui/Text'

export const GROUPS = ['reports', 'gates', 'owner', 'actions', 'post mortems'] as const
export type Group = (typeof GROUPS)[number]

export interface Described {
  group: Group
  tone: Tone
  text: string
  body: ReactNode
}

const asText = (value: unknown) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value))

export function describeTimelineEvent(event: TimelineEvent): Described {
  switch (event.type) {
    case 'work_item_started':
      return { group: 'reports', tone: 'info', text: `started ${asText(event.issue)}`, body: <Strong>Started {asText(event.issue)} on workflow v{asText(event.workflow_version)}</Strong> }
    case 'session_bound':
      return { group: 'actions', tone: 'neutral', text: `session ${asText(event.session_id)}`, body: <Muted>Session {asText(event.session_id)} bound</Muted> }
    case 'work_reported': {
      const kind = asText(event.kind)
      return {
        group: 'reports',
        tone: kind === 'impediment' ? 'bad' : kind === 'added_step' ? 'warn' : kind === 'better_way' ? 'ok' : 'neutral',
        text: `${kind} ${asText(event.text)} ${asText(event.why)} ${asText(event.chosen)} ${asText(event.asked)} ${asText(event.answer)}`,
        body: (
          <>
            <Row>
              <Badge tone={kind === 'added_step' ? 'warn' : kind === 'impediment' ? 'bad' : 'neutral'} testId={`report-${kind}`}>
                {kind}
              </Badge>
              {event.stage !== null && event.stage !== undefined && <Muted>at {formatPosition(event.stage as number, event.step as number)}</Muted>}
            </Row>
            <span>{asText(event.text)}</span>
            {kind === 'decision' && <Muted>Chosen: {asText(event.chosen)}, by {asText(event.by)}, because {asText(event.why)}</Muted>}
            {kind === 'question' && <Muted>Asked: {asText(event.asked)}. Answer: {asText(event.answer)}</Muted>}
            {kind === 'added_step' && <Muted>Owner's correction: {asText(event.why)}</Muted>}
          </>
        ),
      }
    }
    case 'gate_submitted':
      return {
        group: 'gates',
        tone: 'info',
        text: `gate ${asText(event.gate)} ${asText(event.text)}`,
        body: (
          <>
            <Row>
              <Badge tone="info">{asText(event.gate)} gate handed in</Badge>
              <Muted>work step {formatPosition(event.stage as number, event.step as number)}</Muted>
            </Row>
            <span>{asText(event.text)}</span>
            {(event.self_check as { rule: string; accepted: boolean; evidence: string }[]).map((check) => (
              <Muted key={check.rule}>
                {check.accepted ? 'pass' : 'fail'} <Code>{check.rule}</Code>: {check.evidence}
              </Muted>
            ))}
          </>
        ),
      }
    case 'gate_verdict':
      return {
        group: 'gates',
        tone: event.accepted ? 'ok' : 'bad',
        text: `verdict ${event.accepted ? 'accepted' : 'rejected'} ${asText(event.by)} ${asText(event.why)} ${asText(event.rule)}`,
        body: (
          <>
            <Row>
              <Badge tone={event.accepted ? 'ok' : 'bad'} testId="verdict">
                {event.accepted ? 'accepted' : 'rejected'} by {asText(event.by)}
              </Badge>
              {event.rule ? <Code>{asText(event.rule)}</Code> : null}
              <Muted>work step {formatPosition(event.stage as number, event.step as number)}</Muted>
            </Row>
            <span>{asText(event.why)}</span>
          </>
        ),
      }
    case 'review_failed':
      return { group: 'gates', tone: 'warn', text: `review failed ${asText(event.error)}`, body: <Muted>Drillmaster could not judge: {asText(event.error)}</Muted> }
    case 'work_item_delivered':
      return { group: 'reports', tone: 'ok', text: `delivered ${asText(event.pr)}`, body: <Strong>Delivered as {asText(event.pr)}</Strong> }
    case 'post_mortem_written':
      return { group: 'post mortems', tone: 'accent', text: `post mortem ${asText(event.author)} ${asText(event.keep)} ${asText(event.change)}`, body: <Muted>{asText(event.author)} wrote a workflow post mortem</Muted> }
    case 'work_trace': {
      const owner = event.hook === 'UserPromptSubmit'
      return {
        group: owner ? 'owner' : 'actions',
        tone: owner ? 'accent' : 'neutral',
        text: `${asText(event.hook)} ${asText(event.tool)} ${asText(event.input)} ${asText(event.output)} ${asText(event.prompt)}`,
        body: owner ? (
          <Row>
            <Badge tone="accent">Owner</Badge>
            <span>"{asText(event.prompt)}"</span>
          </Row>
        ) : (
          <>
            <Row>
              <Muted>{asText(event.hook)}</Muted>
              {event.tool ? <Code>{asText(event.tool)}</Code> : null}
              {event.error ? <Badge tone="bad">error</Badge> : null}
              {typeof event.exit_code === 'number' ? <Muted>exit {event.exit_code}</Muted> : null}
            </Row>
            {event.input ? <Pre>{asText(event.input)}</Pre> : null}
            {event.output ? <Pre>{asText(event.output)}</Pre> : null}
          </>
        ),
      }
    }
    default:
      return { group: 'actions', tone: 'neutral', text: event.type, body: <Muted>{event.type}</Muted> }
  }
}
