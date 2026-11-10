import { useState } from 'react'
import { api, usePolled } from '../api'
import { formatClockTime, formatDateTime, formatNumber, formatPosition, measureLabel } from '../format'
import { href } from '../router'
import type { TimelineEvent, WorkItemView } from '../types'
import { Badge } from '../ui/Badge'
import { Grid, Row, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
import { Empty } from '../ui/Empty'
import { Figure } from '../ui/Figure'
import { Layout } from '../ui/Layout'
import { Loading } from '../ui/Loading'
import { Chip, SearchField } from '../ui/Select'
import { Stat } from '../ui/Stat'
import { Heading, Link, Muted } from '../ui/Text'
import { Timeline, TimelineEntry } from '../ui/Timeline'
import { FeedbackList } from './FeedbackList'
import { describeTimelineEvent, GROUPS, type Group } from './describe'
import { StatusBadge } from './WorkItemsView'

export function WorkItemPage({ id, item }: { id: string; item: string }) {
  const loaded = usePolled(() => api.workItem(id, item), `item:${id}:${item}`)
  return (
    <Layout
      crumbs={
        <>
          <Link href={href.projects()}>Projects</Link>/<Link href={href.project(id, 'items')}>Work items</Link>/<span>{item}</span>
        </>
      }
    >
      <Loading loaded={loaded}>{(view) => <WorkItem view={view} projectId={id} />}</Loading>
    </Layout>
  )
}

function WorkItem({ view, projectId }: { view: WorkItemView; projectId: string }) {
  const { item } = view
  return (
    <>
      <Stack tight>
        <Heading level={1} testId="item-title">
          {item.work_item_id}: {item.issue}
        </Heading>
        <Row>
          <StatusBadge item={item} />
          <Badge>workflow v{item.workflow_version}</Badge>
          <Muted>
            started {formatDateTime(item.started_at)}
            {item.pr ? `, delivered as ${item.pr}` : ''}
            {item.stage !== null ? `, at work step ${formatPosition(item.stage, item.step)}` : ''}
          </Muted>
          {item.pending_gate?.review_failed && <Badge tone="warn">review failed: {item.pending_gate.review_failed}</Badge>}
          {item.restarted && (
            <Badge tone="warn" testId="restarted">
              restarted: workflow {item.restarted.from_version} became {item.restarted.to_version}
            </Badge>
          )}
          {item.skipped_steps.length > 0 && (
            <Badge tone="info" testId="skipped">
              skipped, justified: {item.skipped_steps.join(', ')}
            </Badge>
          )}
          {item.late_start && item.late_start.status !== 'approved' && <Badge tone="warn">late start {item.late_start.status.replace('_', ' ')}</Badge>}
        </Row>
      </Stack>
      <Story view={view} projectId={projectId} />
      <Grid narrow>
        <Stat label="Work reports" value={item.reports} />
        <Stat label="Work traces" value={item.traces} />
        <Stat label="Rejections" value={item.rejections} />
        {view.measures && <Stat label={measureLabel('owner_corrections_per_item')} value={formatNumber(view.measures.owner_corrections_per_item)} />}
        {view.measures && <Stat label="Minutes" value={formatNumber(view.measures.minutes_per_item)} />}
      </Grid>
      <PostMortems events={view.post_mortems} />
      <Card title="Timeline" subtitle="Everything recorded for this work item, oldest first">
        <FilteredTimeline events={view.timeline} />
      </Card>
    </>
  )
}

/** What the work item is about, what it delivered, the artifacts that show it, and its metrics. */
function Story({ view, projectId }: { view: WorkItemView; projectId: string }) {
  const { item } = view
  const metrics = Object.entries(item.metrics)
  const artifactUrl = (name: string) => `/api/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(item.work_item_id)}/artifacts/${encodeURIComponent(name)}`
  return (
    <Card title="The work item" testId="story">
      <Stack tight>
        <Muted>What it is about</Muted>
        <span data-testid="description">{item.description || 'No description.'}</span>
      </Stack>
      {item.summary && (
        <Stack tight>
          <Muted>What was delivered</Muted>
          <span data-testid="summary">{item.summary}</span>
        </Stack>
      )}
      {item.artifacts.length > 0 && (
        <Grid>
          {item.artifacts.map((artifact) =>
            artifact.media_type.startsWith('image/') ? (
              <Figure key={artifact.name} testId="artifact" src={artifactUrl(artifact.name)} alt={artifact.path} caption={artifact.path} />
            ) : (
              <Link key={artifact.name} href={artifactUrl(artifact.name)}>
                {artifact.path}
              </Link>
            ),
          )}
        </Grid>
      )}
      {metrics.length > 0 && (
        <Row testId="item-metrics">
          {metrics.map(([name, metric]) => (
            <Badge key={name} tone="info">
              {name}: {metric.value} (by {metric.by})
            </Badge>
          ))}
        </Row>
      )}
    </Card>
  )
}

function PostMortems({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return null
  return (
    <Grid>
      {events.map((postMortem) => (
        <Card key={postMortem.id} title={`${postMortem.author === 'agent' ? "Agent's" : "Drillmaster's"} workflow post mortem`} testId={`post-mortem-${String(postMortem.author)}`}>
          {(
            [
              ['What to keep', postMortem.keep],
              ['What to change', postMortem.change],
            ] as const
          ).map(([label, entries]) => (
            <Stack key={label} tight>
              <Muted>{label}</Muted>
              <FeedbackList entries={entries} />
            </Stack>
          ))}
          {Array.isArray(postMortem.experiment_reflections) && postMortem.experiment_reflections.length > 0 && (
            <Stack tight>
              <Muted>Workflow experiment reflections</Muted>
              {(postMortem.experiment_reflections as { experiment: number | null; text: string }[]).map((reflection, index) => (
                <span key={index}>
                  {reflection.experiment !== null ? `#${reflection.experiment}: ` : ''}
                  {reflection.text}
                </span>
              ))}
            </Stack>
          )}
        </Card>
      ))}
    </Grid>
  )
}

function FilteredTimeline({ events }: { events: TimelineEvent[] }) {
  const [hidden, setHidden] = useState<Set<Group>>(new Set())
  const [query, setQuery] = useState('')
  const described = events.map((event) => ({ event, description: describeTimelineEvent(event) }))
  const searchText = query.trim().toLowerCase()
  const shown = described.filter(({ description }) => !hidden.has(description.group) && (!searchText || description.text.toLowerCase().includes(searchText)))
  const toggleGroup = (group: Group) =>
    setHidden((current) => (current.has(group) ? new Set([...current].filter((hiddenGroup) => hiddenGroup !== group)) : new Set([...current, group])))
  return (
    <Stack>
      <Row>
        {GROUPS.map((group) => (
          <Chip key={group} on={!hidden.has(group)} onClick={() => toggleGroup(group)}>
            {group} ({described.filter(({ description }) => description.group === group).length})
          </Chip>
        ))}
        <SearchField label="Search the timeline" placeholder="Search, e.g. added_step" value={query} onChange={setQuery} />
      </Row>
      {shown.length === 0 ? (
        <Empty>Nothing matches.</Empty>
      ) : (
        <Timeline>
          {shown.map(({ event, description }) => (
            <TimelineEntry key={event.id} time={formatClockTime(event.at)} tone={description.tone} kind={event.type}>
              {description.body}
            </TimelineEntry>
          ))}
        </Timeline>
      )}
    </Stack>
  )
}
