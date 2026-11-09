import { formatDateTime, formatNumber, measureLabel } from '../format'
import { href } from '../router'
import type { ProjectView } from '../types'
import { Badge } from '../ui/Badge'
import { Grid, Row, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
import { Stat } from '../ui/Stat'
import { Link, Muted } from '../ui/Text'
import { proposalTone } from './RetrospectivesView'
import { StatusBadge } from './WorkItemsView'

export function OverviewView({ project }: { project: ProjectView }) {
  const active = project.work_items.filter((workItem) => workItem.status === 'active')
  const waiting = active.filter((workItem) => workItem.pending_gate).length
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
        {project.measures.map((measure) => (
          <Card key={measure.name}>
            <Stat label={measureLabel(measure.name)} value={formatNumber(measure.last_5)} hint={`last 5; all ${formatNumber(measure.all)}`} />
          </Card>
        ))}
      </Grid>
      <Card title="Now" testId="now">
        {active.length === 0 ? (
          <Muted>No work item is active.</Muted>
        ) : (
          active.map((workItem) => (
            <Row key={workItem.work_item_id}>
              <Link href={href.item(project.summary.id, workItem.work_item_id)}>{workItem.work_item_id}</Link>
              <span>{workItem.issue}</span>
              <StatusBadge item={workItem} />
              {workItem.stage !== null && (
                <Badge>
                  work step {workItem.stage}.{workItem.step}
                </Badge>
              )}
            </Row>
          ))
        )}
      </Card>
      <Card title="Last workflow retrospective">
        {lastRetro ? (
          <Stack tight>
            <Muted>{formatDateTime(lastRetro.at)}</Muted>
            <span>{lastRetro.findings.improve}</span>
            <Row>
              {lastRetro.proposals.map((proposal) => (
                <Badge key={proposal.id} tone={proposalTone[proposal.status]}>
                  {proposal.id}: {proposal.status}
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
