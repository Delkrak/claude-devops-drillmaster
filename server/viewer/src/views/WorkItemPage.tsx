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
import { StepBar, Timeline, TimelineEntry } from '../ui/Timeline'
import { FeedbackList } from './FeedbackList'
import { describeTimelineEvent, GROUPS, type Group } from './describe'
import { StatusBadge } from './WorkItemsView'

export function WorkItemPage({ id, item, highlightedEvent = null }: { id: string; item: string; highlightedEvent?: string | null }) {
  const loaded = usePolled(() => api.workItem(id, item), `item:${id}:${item}`)
  return (
    <Layout
      crumbs={
        <>
          <Link href={href.project(id, 'items')}>Work items</Link>/<span>{item}</span>
        </>
      }
    >
      <Loading loaded={loaded}>{(view) => <WorkItem view={view} projectId={id} highlightedEvent={highlightedEvent} />}</Loading>
    </Layout>
  )
}

function WorkItem({ view, projectId, highlightedEvent }: { view: WorkItemView; projectId: string; highlightedEvent: string | null }) {
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
          {item.last_update && (
            <Badge tone="info" testId="updated">
              updated: workflow {item.last_update.from_version} to {item.last_update.to_version}
            </Badge>
          )}
          {item.skipped_steps.length > 0 && (
            <Badge tone="info" testId="skipped">
              skipped: step {item.skipped_steps.join(', ')}
            </Badge>
          )}
          {item.pending_skip && (
            <Badge tone="warn">
              skip of step {item.pending_skip.stage}.{item.pending_skip.step} waits for {item.pending_skip.decided_by}
            </Badge>
          )}
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
      <PostMortems events={view.post_mortems} projectId={projectId} />
      <Card title="Timeline" subtitle="Everything recorded for this work item, oldest first">
        <FilteredTimeline view={view} projectId={projectId} highlightedEvent={highlightedEvent} />
      </Card>
    </>
  )
}

/** What the work item is about, what it delivered, the artifacts that show it, and its inputs. */
function Story({ view, projectId }: { view: WorkItemView; projectId: string }) {
  const { item } = view
  const inputs = Object.entries(item.inputs)
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
      {inputs.length > 0 && (
        <Row testId="item-inputs">
          {inputs.map(([name, input]) => (
            <Badge key={name} tone="info">
              {name}: {input.value} (by {input.by})
            </Badge>
          ))}
        </Row>
      )}
    </Card>
  )
}

function PostMortems({ events, projectId }: { events: TimelineEvent[]; projectId: string }) {
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
              <FeedbackList entries={entries} projectId={projectId} />
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

/** The work step an event was at, as "1.2 name", named as the work item's workflow names that step now. */
function stepOf(event: TimelineEvent, view: WorkItemView) {
  if (typeof event.stage !== 'number' || typeof event.step !== 'number') return null
  const steps = view.workflow?.stages.flatMap((stage) => stage.steps.map((step) => ({ stage: stage.n, step }))) ?? []
  const named = steps.find(({ step }) => step.guid === event.step_guid) ?? steps.find(({ stage, step }) => stage === event.stage && step.n === event.step)
  return `${event.stage}.${event.step}${named ? ` ${named.step.name}` : ''}`
}

function FilteredTimeline({ view, projectId, highlightedEvent }: { view: WorkItemView; projectId: string; highlightedEvent: string | null }) {
  const events = view.timeline
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
          {shown.flatMap(({ event, description }, index) => {
            const step = stepOf(event, view)
            const earlierStep = shown
              .slice(0, index)
              .map((earlier) => stepOf(earlier.event, view))
              .findLast((label) => label !== null)
            const entry = (
              <TimelineEntry key={event.id} time={formatClockTime(event.at)} tone={description.tone} kind={event.type} link={href.event(projectId, view.item.work_item_id, event.id)} highlighted={event.id === highlightedEvent}>
                {description.body}
              </TimelineEntry>
            )
            return step && step !== earlierStep ? [<StepBar key={`bar-${event.id}`}>Step {step}</StepBar>, entry] : [entry]
          })}
        </Timeline>
      )}
    </Stack>
  )
}
