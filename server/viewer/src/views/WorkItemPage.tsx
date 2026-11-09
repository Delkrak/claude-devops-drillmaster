import { useState } from 'react'
import { api, usePolled } from '../api'
import { clock, measureLabel, number, position, time } from '../format'
import { href } from '../router'
import type { TimelineEvent, WorkItemView } from '../types'
import { Badge } from '../ui/Badge'
import { Grid, Row, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
import { Empty } from '../ui/Empty'
import { Layout } from '../ui/Layout'
import { Loading } from '../ui/Loading'
import { Chip, SearchField } from '../ui/Select'
import { Stat } from '../ui/Stat'
import { Heading, Link, Muted } from '../ui/Text'
import { Timeline, TimelineEntry } from '../ui/Timeline'
import { describe, GROUPS, type Group } from './describe'
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
      <Loading loaded={loaded}>{(view) => <WorkItem view={view} />}</Loading>
    </Layout>
  )
}

function WorkItem({ view }: { view: WorkItemView }) {
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
            started {time(item.started_at)}
            {item.pr ? `, delivered as ${item.pr}` : ''}
            {item.stage !== null ? `, at work step ${position(item.stage, item.step)}` : ''}
          </Muted>
          {item.pending_gate?.review_failed && <Badge tone="warn">review failed: {item.pending_gate.review_failed}</Badge>}
        </Row>
      </Stack>
      <Grid narrow>
        <Stat label="Work reports" value={item.reports} />
        <Stat label="Work traces" value={item.traces} />
        <Stat label="Rejections" value={item.rejections} />
        {view.measures && <Stat label={measureLabel('owner_corrections_per_item')} value={number(view.measures.owner_corrections_per_item)} />}
        {view.measures && <Stat label="Minutes" value={number(view.measures.minutes_per_item)} />}
      </Grid>
      <PostMortems events={view.post_mortems} />
      <Card title="Timeline" subtitle="Everything recorded for this work item, oldest first">
        <FilteredTimeline events={view.timeline} />
      </Card>
    </>
  )
}

function PostMortems({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return null
  return (
    <Grid>
      {events.map((pm) => (
        <Card key={pm.id} title={`${pm.author === 'agent' ? "Agent's" : "Drillmaster's"} workflow post mortem`} testId={`post-mortem-${String(pm.author)}`}>
          {(
            [
              ['What to keep', pm.keep],
              ['What to change', pm.change],
              ['Workflow experiment reflections', pm.experiment_reflections],
              ['Free text', pm.free_text],
            ] as const
          ).map(([label, text]) =>
            text ? (
              <Stack key={label} tight>
                <Muted>{label}</Muted>
                <span>{String(text)}</span>
              </Stack>
            ) : null,
          )}
        </Card>
      ))}
    </Grid>
  )
}

function FilteredTimeline({ events }: { events: TimelineEvent[] }) {
  const [hidden, setHidden] = useState<Set<Group>>(new Set())
  const [query, setQuery] = useState('')
  const described = events.map((e) => ({ e, d: describe(e) }))
  const needle = query.trim().toLowerCase()
  const shown = described.filter(({ d }) => !hidden.has(d.group) && (!needle || d.text.toLowerCase().includes(needle)))
  const toggle = (g: Group) => setHidden((current) => (current.has(g) ? new Set([...current].filter((x) => x !== g)) : new Set([...current, g])))
  return (
    <Stack>
      <Row>
        {GROUPS.map((g) => (
          <Chip key={g} on={!hidden.has(g)} onClick={() => toggle(g)}>
            {g} ({described.filter(({ d }) => d.group === g).length})
          </Chip>
        ))}
        <SearchField label="Search the timeline" placeholder="Search, e.g. added_step" value={query} onChange={setQuery} />
      </Row>
      {shown.length === 0 ? (
        <Empty>Nothing matches.</Empty>
      ) : (
        <Timeline>
          {shown.map(({ e, d }) => (
            <TimelineEntry key={e.id} time={clock(e.at)} tone={d.tone} kind={e.type}>
              {d.body}
            </TimelineEntry>
          ))}
        </Timeline>
      )}
    </Stack>
  )
}
