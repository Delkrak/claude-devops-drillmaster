import { number, position, time } from '../format'
import { href } from '../router'
import type { ProjectView, WorkItemRow } from '../types'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { Empty } from '../ui/Empty'
import { Table } from '../ui/Table'
import { Link } from '../ui/Text'

export function StatusBadge({ item }: { item: Pick<WorkItemRow, 'status' | 'pending_gate'> }) {
  if (item.status === 'delivered') return <Badge tone="ok">delivered</Badge>
  if (item.pending_gate) return <Badge tone="warn">{item.pending_gate.gate} gate pending</Badge>
  return <Badge tone="info">active</Badge>
}

export function WorkItemsView({ project }: { project: ProjectView }) {
  if (project.work_items.length === 0) return <Empty>No work items yet.</Empty>
  const item = (i: WorkItemRow) => href.item(project.summary.id, i.work_item_id)
  return (
    <Card testId="work-items">
      <Table<WorkItemRow>
        testId="work-items-table"
        rows={project.work_items}
        rowKey={(i) => i.work_item_id}
        rowHref={item}
        columns={[
          { header: 'Work item', cell: (i) => <Link href={item(i)}>{i.work_item_id}</Link> },
          { header: 'Issue', cell: (i) => i.issue },
          { header: 'Status', cell: (i) => <StatusBadge item={i} /> },
          { header: 'At', cell: (i) => position(i.stage, i.step) },
          { header: 'Workflow', cell: (i) => `v${i.workflow_version}` },
          { header: 'Reports', cell: (i) => i.reports },
          { header: 'Traces', cell: (i) => i.traces },
          { header: 'Rejections', cell: (i) => (i.rejections ? <Badge tone="bad">{i.rejections}</Badge> : 0) },
          { header: 'Added steps', cell: (i) => (i.added_steps ? <Badge tone="warn">{i.added_steps}</Badge> : 0) },
          { header: 'Corrections', cell: (i) => number(i.measures?.owner_corrections_per_item) },
          { header: 'Post mortems', cell: (i) => i.post_mortems.join(' + ') || '-' },
          { header: 'Started', cell: (i) => time(i.started_at) },
        ]}
      />
    </Card>
  )
}
