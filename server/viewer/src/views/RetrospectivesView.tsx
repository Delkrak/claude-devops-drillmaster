import { measureLabel, time } from '../format'
import type { Proposal, ProjectView, Retrospective } from '../types'
import { Badge, type Tone } from '../ui/Badge'
import { Row, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
import { Empty } from '../ui/Empty'
import { Heading, Muted, Pre, Strong } from '../ui/Text'

export const proposalTone: Record<Proposal['status'], Tone> = { applied: 'ok', approved: 'info', declined: 'bad', open: 'neutral' }

const FINDINGS = [
  ['should', 'What should have happened'],
  ['did', 'What happened'],
  ['why', 'Why'],
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
    <Card title={`Retrospective ${retro.retro_id}`} subtitle={`${time(retro.at)}, on ${retro.work_items.join(', ') || 'no delivered work items'}`}>
      {FINDINGS.map(([key, label]) => (
        <Stack key={key} tight>
          <Muted>{label}</Muted>
          <span>{retro.findings[key]}</span>
        </Stack>
      ))}
      <Heading level={3}>Proposals</Heading>
      {retro.proposals.length === 0 ? (
        <Empty>No workflow changes proposed.</Empty>
      ) : (
        retro.proposals.map((p) => (
          <Stack key={p.id} tight testId="proposal">
            <Row>
              <Strong>{p.id}.</Strong> {p.change}
              <Badge tone={proposalTone[p.status]}>{p.status}</Badge>
              {p.depends_on && <Badge>builds on {p.depends_on.join(', ')}</Badge>}
            </Row>
            <Muted>
              Purpose: {p.purpose}. Measure: {measureLabel(p.measure)}.
            </Muted>
            <details>
              <summary>
                <Muted>Operations</Muted>
              </summary>
              <Pre>{JSON.stringify(p.ops, null, 2)}</Pre>
            </details>
          </Stack>
        ))
      )}
      {retro.decisions.length > 0 && (
        <Stack tight>
          <Heading level={3}>Owner's words</Heading>
          {retro.decisions.map((d) => (
            <Muted key={d.at}>
              {time(d.at)}: "{d.prompt}"
            </Muted>
          ))}
        </Stack>
      )}
    </Card>
  )
}
