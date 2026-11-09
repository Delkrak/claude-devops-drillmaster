import { formatDateTime, formatNumber, formatPosition } from '../format'
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
  const itemHref = (workItem: WorkItemRow) => href.item(project.summary.id, workItem.work_item_id)
  return (
    <Card testId="work-items">
      <Table<WorkItemRow>
        testId="work-items-table"
        rows={project.work_items}
        rowKey={(workItem) => workItem.work_item_id}
        rowHref={itemHref}
        columns={[
          { header: 'Work item', cell: (workItem) => <Link href={itemHref(workItem)}>{workItem.work_item_id}</Link> },
          { header: 'Issue', cell: (workItem) => workItem.issue },
          { header: 'Status', cell: (workItem) => <StatusBadge item={workItem} /> },
          { header: 'At', cell: (workItem) => formatPosition(workItem.stage, workItem.step) },
          { header: 'Workflow', cell: (workItem) => `v${workItem.workflow_version}` },
          { header: 'Reports', cell: (workItem) => workItem.reports },
          { header: 'Traces', cell: (workItem) => workItem.traces },
          { header: 'Rejections', cell: (workItem) => (workItem.rejections ? <Badge tone="bad">{workItem.rejections}</Badge> : 0) },
          { header: 'Added steps', cell: (workItem) => (workItem.added_steps ? <Badge tone="warn">{workItem.added_steps}</Badge> : 0) },
          { header: 'Corrections', cell: (workItem) => formatNumber(workItem.measures?.owner_corrections_per_item) },
          { header: 'Post mortems', cell: (workItem) => workItem.post_mortems.join(' + ') || '-' },
          { header: 'Started', cell: (workItem) => formatDateTime(workItem.started_at) },
        ]}
      />
    </Card>
  )
}
