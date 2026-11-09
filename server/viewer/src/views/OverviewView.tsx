import { measureLabel, number, time } from '../format'
import { href } from '../router'
import type { ProjectView } from '../types'
import { Badge } from '../ui/Badge'
import { Grid, Row, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
import { Stat } from '../ui/Stat'
import { Link, Muted } from '../ui/Text'
import { proposalTone } from './RetrospectivesView'
import { StatusBadge } from './WorkItemsView'

/** The project at a glance: objective, measures, what is happening now, and what changed last. */
export function OverviewView({ project }: { project: ProjectView }) {
  const active = project.work_items.filter((i) => i.status === 'active')
  const waiting = active.filter((i) => i.pending_gate).length
  const lastRetro = project.retrospectives[0]
  return (
    <Stack testId="overview">
      <Grid>
        <Card>
          <Stat label="Workflow version" value={`v${project.workflow.version}`} hint={`${project.workflow.stages.length} work stages, ${project.workflow.experiments.length} experiments`} />
        </Card>
        <Card>
          <Stat label="Work items" value={project.work_items.length} hint={`${active.length} active, ${waiting} waiting at a gate`} testId="stat-work-items" />
        </Card>
        {project.measures.map((m) => (
          <Card key={m.name}>
            <Stat label={measureLabel(m.name)} value={number(m.last_5)} hint={`last 5; all ${number(m.all)}`} />
          </Card>
        ))}
      </Grid>
      <Card title="Now" testId="now">
        {active.length === 0 ? (
          <Muted>No work item is active.</Muted>
        ) : (
          active.map((i) => (
            <Row key={i.work_item_id}>
              <Link href={href.item(project.summary.id, i.work_item_id)}>{i.work_item_id}</Link>
              <span>{i.issue}</span>
              <StatusBadge item={i} />
              {i.stage !== null && (
                <Badge>
                  work step {i.stage}.{i.step}
                </Badge>
              )}
            </Row>
          ))
        )}
      </Card>
      <Card title="Last workflow retrospective">
        {lastRetro ? (
          <Stack tight>
            <Muted>{time(lastRetro.at)}</Muted>
            <span>{lastRetro.findings.improve}</span>
            <Row>
              {lastRetro.proposals.map((p) => (
                <Badge key={p.id} tone={proposalTone[p.status]}>
                  {p.id}: {p.status}
                </Badge>
              ))}
            </Row>
            <Link href={href.project(project.summary.id, 'retrospectives')}>All retrospectives</Link>
          </Stack>
        ) : (
          <Muted>None yet.</Muted>
        )}
      </Card>
    </Stack>
  )
}
