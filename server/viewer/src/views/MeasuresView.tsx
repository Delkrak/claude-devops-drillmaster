import { formatNumber, measureLabel } from '../format'
import type { Measure, ProjectView } from '../types'
import { Bars } from '../ui/Bars'
import { Grid, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
import { Empty } from '../ui/Empty'
import { Stat } from '../ui/Stat'
import { Table } from '../ui/Table'

export function MeasuresView({ project }: { project: ProjectView }) {
  const delivered = project.measures[0]?.per_item.length ?? 0
  if (delivered === 0) return <Empty>No work item is delivered yet, so there is nothing to measure.</Empty>
  return (
    <Stack testId="measures">
      {project.measures.map((projectMeasure) => (
        <MeasureCard key={projectMeasure.name} measure={projectMeasure} project={project} />
      ))}
    </Stack>
  )
}

function MeasureCard({ measure, project }: { measure: Measure; project: ProjectView }) {
  const experiments = project.workflow.experiments.filter((experiment) => experiment.measure === measure.name)
  return (
    <Card title={measureLabel(measure.name)} subtitle={measure.name}>
      <Grid narrow>
        <Stat label="Last 5 work items" value={formatNumber(measure.last_5)} />
        <Stat label="All work items" value={formatNumber(measure.all)} hint={`${measure.per_item.length} delivered`} />
        {experiments.map((experiment) => (
          <Stat key={experiment.id} label={`Experiment ${experiment.id} baseline`} value={formatNumber(experiment.baseline)} hint={experiment.change} />
        ))}
      </Grid>
      <Bars label={`${measure.name} per work item`} values={measure.per_item.map((itemValue) => ({ key: itemValue.work_item_id, value: itemValue.value, title: `${itemValue.work_item_id} (${itemValue.issue}): ${itemValue.value}` }))} />
      <Table
        rows={measure.per_item}
        rowKey={(itemValue) => itemValue.work_item_id}
        columns={[
          { header: 'Work item', cell: (itemValue) => itemValue.work_item_id },
          { header: 'Issue', cell: (itemValue) => itemValue.issue },
          { header: 'Value', cell: (itemValue) => formatNumber(itemValue.value) },
        ]}
      />
    </Card>
  )
}
