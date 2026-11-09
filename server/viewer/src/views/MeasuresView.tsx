import { measureLabel, number } from '../format'
import type { Measure, ProjectView } from '../types'
import { Bars } from '../ui/Bars'
import { Grid, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
import { Empty } from '../ui/Empty'
import { Stat } from '../ui/Stat'
import { Table } from '../ui/Table'

/** The objective's measures per delivered work item, with every experiment's baseline beside them. */
export function MeasuresView({ project }: { project: ProjectView }) {
  const delivered = project.measures[0]?.per_item.length ?? 0
  if (delivered === 0) return <Empty>No work item is delivered yet, so there is nothing to measure.</Empty>
  return (
    <Stack testId="measures">
      {project.measures.map((m) => (
        <MeasureCard key={m.name} measure={m} project={project} />
      ))}
    </Stack>
  )
}

function MeasureCard({ measure, project }: { measure: Measure; project: ProjectView }) {
  const experiments = project.workflow.experiments.filter((x) => x.measure === measure.name)
  return (
    <Card title={measureLabel(measure.name)} subtitle={measure.name}>
      <Grid narrow>
        <Stat label="Last 5 work items" value={number(measure.last_5)} />
        <Stat label="All work items" value={number(measure.all)} hint={`${measure.per_item.length} delivered`} />
        {experiments.map((x) => (
          <Stat key={x.id} label={`Experiment ${x.id} baseline`} value={number(x.baseline)} hint={x.change} />
        ))}
      </Grid>
      <Bars label={`${measure.name} per work item`} values={measure.per_item.map((i) => ({ key: i.work_item_id, value: i.value, title: `${i.work_item_id} (${i.issue}): ${i.value}` }))} />
      <Table
        rows={measure.per_item}
        rowKey={(i) => i.work_item_id}
        columns={[
          { header: 'Work item', cell: (i) => i.work_item_id },
          { header: 'Issue', cell: (i) => i.issue },
          { header: 'Value', cell: (i) => number(i.value) },
        ]}
      />
    </Card>
  )
}
