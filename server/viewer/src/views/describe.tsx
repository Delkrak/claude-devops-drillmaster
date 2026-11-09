// How each kind of event reads on a work item's timeline: a filter group, a tone, and its content.

import type { ReactNode } from 'react'
import { position } from '../format'
import type { TimelineEvent } from '../types'
import { Badge, type Tone } from '../ui/Badge'
import { Row } from '../ui/Box'
import { Code, Muted, Pre, Strong } from '../ui/Text'

export const GROUPS = ['reports', 'gates', 'owner', 'actions', 'post mortems'] as const
export type Group = (typeof GROUPS)[number]

export interface Described {
  group: Group
  tone: Tone
  /** Searchable text, including tags such as added_step. */
  text: string
  body: ReactNode
}

const s = (value: unknown) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value))

export function describe(e: TimelineEvent): Described {
  switch (e.type) {
    case 'work_item_started':
      return { group: 'reports', tone: 'info', text: `started ${s(e.issue)}`, body: <Strong>Started {s(e.issue)} on workflow v{s(e.workflow_version)}</Strong> }
    case 'session_bound':
      return { group: 'actions', tone: 'neutral', text: `session ${s(e.session_id)}`, body: <Muted>Session {s(e.session_id)} bound</Muted> }
    case 'work_reported': {
      const kind = s(e.kind)
      return {
        group: 'reports',
        tone: kind === 'impediment' ? 'bad' : kind === 'added_step' ? 'warn' : kind === 'better_way' ? 'ok' : 'neutral',
        text: `${kind} ${s(e.text)} ${s(e.why)} ${s(e.chosen)} ${s(e.asked)} ${s(e.answer)}`,
        body: (
          <>
            <Row>
              <Badge tone={kind === 'added_step' ? 'warn' : kind === 'impediment' ? 'bad' : 'neutral'} testId={`report-${kind}`}>
                {kind}
              </Badge>
              {e.stage !== null && e.stage !== undefined && <Muted>at {position(e.stage as number, e.step as number)}</Muted>}
            </Row>
            <span>{s(e.text)}</span>
            {kind === 'decision' && <Muted>Chosen: {s(e.chosen)}, by {s(e.by)}, because {s(e.why)}</Muted>}
            {kind === 'question' && <Muted>Asked: {s(e.asked)}. Answer: {s(e.answer)}</Muted>}
            {kind === 'added_step' && <Muted>Owner's correction: {s(e.why)}</Muted>}
          </>
        ),
      }
    }
    case 'gate_submitted':
      return {
        group: 'gates',
        tone: 'info',
        text: `gate ${s(e.gate)} ${s(e.text)}`,
        body: (
          <>
            <Row>
              <Badge tone="info">{s(e.gate)} gate handed in</Badge>
              <Muted>work step {position(e.stage as number, e.step as number)}</Muted>
            </Row>
            <span>{s(e.text)}</span>
            {(e.self_check as { rule: string; accepted: boolean; evidence: string }[]).map((c) => (
              <Muted key={c.rule}>
                {c.accepted ? 'pass' : 'fail'} <Code>{c.rule}</Code>: {c.evidence}
              </Muted>
            ))}
          </>
        ),
      }
    case 'gate_verdict':
      return {
        group: 'gates',
        tone: e.accepted ? 'ok' : 'bad',
        text: `verdict ${e.accepted ? 'accepted' : 'rejected'} ${s(e.by)} ${s(e.why)} ${s(e.rule)}`,
        body: (
          <>
            <Row>
              <Badge tone={e.accepted ? 'ok' : 'bad'} testId="verdict">
                {e.accepted ? 'accepted' : 'rejected'} by {s(e.by)}
              </Badge>
              {e.rule ? <Code>{s(e.rule)}</Code> : null}
              <Muted>work step {position(e.stage as number, e.step as number)}</Muted>
            </Row>
            <span>{s(e.why)}</span>
          </>
        ),
      }
    case 'review_failed':
      return { group: 'gates', tone: 'warn', text: `review failed ${s(e.error)}`, body: <Muted>Drillmaster could not judge: {s(e.error)}</Muted> }
    case 'work_item_delivered':
      return { group: 'reports', tone: 'ok', text: `delivered ${s(e.pr)}`, body: <Strong>Delivered as {s(e.pr)}</Strong> }
    case 'post_mortem_written':
      return { group: 'post mortems', tone: 'accent', text: `post mortem ${s(e.author)} ${s(e.keep)} ${s(e.change)}`, body: <Muted>{s(e.author)} wrote a workflow post mortem</Muted> }
    case 'work_trace': {
      const owner = e.hook === 'UserPromptSubmit'
      return {
        group: owner ? 'owner' : 'actions',
        tone: owner ? 'accent' : 'neutral',
        text: `${s(e.hook)} ${s(e.tool)} ${s(e.input)} ${s(e.prompt)}`,
        body: owner ? (
          <Row>
            <Badge tone="accent">Owner</Badge>
            <span>"{s(e.prompt)}"</span>
          </Row>
        ) : (
          <>
            <Row>
              <Muted>{s(e.hook)}</Muted>
              {e.tool ? <Code>{s(e.tool)}</Code> : null}
              {e.error ? <Badge tone="bad">error</Badge> : null}
            </Row>
            {e.input ? <Pre>{s(e.input)}</Pre> : null}
          </>
        ),
      }
    }
    default:
      return { group: 'actions', tone: 'neutral', text: e.type, body: <Muted>{e.type}</Muted> }
  }
}
