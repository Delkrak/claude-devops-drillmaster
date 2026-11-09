import { api, usePolled } from '../api'
import { href, type ProjectTab } from '../router'
import { Badge } from '../ui/Badge'
import { Row, Stack } from '../ui/Box'
import { Layout } from '../ui/Layout'
import { Loading } from '../ui/Loading'
import { Tabs } from '../ui/Tabs'
import { Heading, Link, Muted } from '../ui/Text'
import { MeasuresView } from './MeasuresView'
import { OverviewView } from './OverviewView'
import { RetrospectivesView } from './RetrospectivesView'
import { WorkflowView } from './WorkflowView'
import { WorkItemsView } from './WorkItemsView'

const TABS: readonly { id: ProjectTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'items', label: 'Work items' },
  { id: 'retrospectives', label: 'Retrospectives' },
  { id: 'measures', label: 'Measures' },
]

export function ProjectPage({ id, tab }: { id: string; tab: ProjectTab }) {
  const loaded = usePolled(() => api.project(id), `project:${id}`)
  return (
    <Layout crumbs={<Link href={href.projects()}>Projects</Link>}>
      <Loading loaded={loaded}>
        {(project) => (
          <>
            <Stack tight>
              <Heading level={1} testId="project-title">
                {project.summary.dir}
              </Heading>
              <Row>
                <Muted>Owner's objective:</Muted> {project.workflow.objective.text}
                <Badge tone="accent">workflow v{project.workflow.version}</Badge>
              </Row>
            </Stack>
            <Tabs tabs={TABS} current={tab} label="Project sections" onSelect={(selectedTab) => (window.location.hash = href.project(id, selectedTab))} />
            {tab === 'overview' && <OverviewView project={project} />}
            {tab === 'workflow' && <WorkflowView project={project} />}
            {tab === 'items' && <WorkItemsView project={project} />}
            {tab === 'retrospectives' && <RetrospectivesView project={project} />}
            {tab === 'measures' && <MeasuresView project={project} />}
          </>
        )}
      </Loading>
    </Layout>
  )
}
