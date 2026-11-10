import { formatDateTime, measureLabel } from '../format'
import type { Proposal, ProjectView, Retrospective } from '../types'
import { Badge, type Tone } from '../ui/Badge'
import { Row, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
import { Empty } from '../ui/Empty'
import { Heading, Muted, Pre, Strong } from '../ui/Text'
import { FeedbackList } from './FeedbackList'

export const proposalTone: Record<Proposal['status'], Tone> = { applied: 'ok', approved: 'info', declined: 'bad', open: 'neutral' }

const FINDINGS = [
  ['opening', "How the last retrospective's actions did"],
  ['should', 'What should have happened'],
  ['did', 'What happened'],
  ['why', 'Why'],
] as const

const FEEDBACK_FINDINGS = [
  ['keep', 'What to keep'],
  ['improve', 'What to improve'],
] as const

export function RetrospectivesView({ project }: { project: ProjectView }) {
  if (project.retrospectives.length === 0) return <Empty>No workflow retrospective yet. Owner calls for one with /devops-drillmaster:retrospective.</Empty>
  return (
    <Stack testId="retrospectives">
      {project.retrospectives.map((retro) => (
        <RetrospectiveCard key={retro.retro_id} retro={retro} />
      ))}
    </Stack>
  )
}

function RetrospectiveCard({ retro }: { retro: Retrospective }) {
  return (
    <Card title={`Retrospective ${retro.retro_id}`} subtitle={`${formatDateTime(retro.at)}, on ${retro.work_items.join(', ') || 'no delivered work items'}`}>
      {FINDINGS.filter(([key]) => retro.findings[key]).map(([key, label]) => (
        <Stack key={key} tight>
          <Muted>{label}</Muted>
          <span>{retro.findings[key]}</span>
        </Stack>
      ))}
      {FEEDBACK_FINDINGS.map(([key, label]) => (
        <Stack key={key} tight>
          <Muted>{label}</Muted>
          <FeedbackList entries={retro.findings[key]} testId={`findings-${key}`} />
        </Stack>
      ))}
      <Heading level={3}>Proposals</Heading>
      {retro.proposals.length === 0 ? (
        <Empty>No workflow changes proposed.</Empty>
      ) : (
        retro.proposals.map((proposal) => (
          <Stack key={proposal.id} tight testId="proposal">
            <Row>
              <Strong>{proposal.id}.</Strong> {proposal.change}
              <Badge tone={proposalTone[proposal.status]}>{proposal.status}</Badge>
              {proposal.depends_on && <Badge>builds on {proposal.depends_on.join(', ')}</Badge>}
              {proposal.relies_on?.map((ref) => (
                <Badge key={ref} tone="info">
                  relies on {ref}
                </Badge>
              ))}
            </Row>
            <Muted>
              Purpose: {proposal.purpose}. Measure: {measureLabel(proposal.measure)}.
            </Muted>
            <details>
              <summary>
                <Muted>Operations</Muted>
              </summary>
              <Pre>{JSON.stringify(proposal.ops, null, 2)}</Pre>
            </details>
          </Stack>
        ))
      )}
      {retro.decisions.length > 0 && (
        <Stack tight>
          <Heading level={3}>Owner's words</Heading>
          {retro.decisions.map((decision) => (
            <Muted key={decision.at}>
              {formatDateTime(decision.at)}: "{decision.prompt}"
            </Muted>
          ))}
        </Stack>
      )}
    </Card>
  )
}
