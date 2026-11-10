import { api, usePolled } from '../api'
import { formatDateTime } from '../format'
import { href } from '../router'
import type { ComponentHistory, HistoryEntry } from '../types'
import { Badge, type Tone } from '../ui/Badge'
import { Row, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
import { Empty } from '../ui/Empty'
import { Layout } from '../ui/Layout'
import { Loading } from '../ui/Loading'
import { Heading, Link, Muted, Pre } from '../ui/Text'

const changeTone: Record<ComponentHistory['versions'][number]['change'], Tone> = { added: 'ok', changed: 'info', same: 'neutral', removed: 'bad' }

/** One component of the workflow across every version, with the feedback that named it and what happened at it. */
export function HistoryPage({ id, guid }: { id: string; guid: string }) {
  const loaded = usePolled(() => api.history(id, guid), `history:${id}:${guid}`)
  return (
    <Layout crumbs={<Link href={href.project(id, 'workflow')}>Workflow</Link>}>
      <Loading loaded={loaded}>{(history) => <History history={history} projectId={id} />}</Loading>
    </Layout>
  )
}

function History({ history, projectId }: { history: ComponentHistory; projectId: string }) {
  const latestName = history.versions.findLast((version) => version.name !== null)?.name
  return (
    <>
      <Stack tight>
        <Heading level={1} testId="history-title">
          {history.current?.ref ?? `${history.kind} ${latestName ?? ''} (removed)`}
        </Heading>
        {history.current && <Muted>{history.current.title}</Muted>}
      </Stack>
      <Card title="Across the workflow versions" testId="history-versions">
        {history.versions.map((version) => (
          <Stack key={version.version} tight testId="history-version">
            <Row>
              <Badge>v{version.version}</Badge>
              <Badge tone={changeTone[version.change]}>{version.change}</Badge>
              {version.name && <Muted>as {history.kind} {version.name}</Muted>}
              <Muted>
                {formatDateTime(version.at)}: {version.reason}
              </Muted>
            </Row>
            {version.change === 'added' || version.change === 'changed' ? <Pre>{JSON.stringify(version.definition, null, 2)}</Pre> : null}
          </Stack>
        ))}
      </Card>
      <Card title="Feedback that names it" testId="history-feedback">
        <Entries entries={history.feedback} projectId={projectId} empty="No post mortem or retrospective has named it yet." />
      </Card>
      <Card title="What happened at it" testId="history-activity">
        <Entries entries={history.activity} projectId={projectId} empty="Nothing recorded at it yet." />
      </Card>
    </>
  )
}

function Entries({ entries, projectId, empty }: { entries: HistoryEntry[]; projectId: string; empty: string }) {
  if (entries.length === 0) return <Empty>{empty}</Empty>
  return (
    <Stack tight>
      {entries.map((entry, index) => (
        <Row key={`${entry.id}-${index}`}>
          <Muted>{formatDateTime(entry.at)}</Muted>
          {entry.work_item_id && <Link href={href.event(projectId, entry.work_item_id, entry.id)}>{entry.work_item_id}</Link>}
          <span>{entry.text}</span>
        </Row>
      ))}
    </Stack>
  )
}
