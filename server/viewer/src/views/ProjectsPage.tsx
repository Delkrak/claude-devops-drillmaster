import { api, usePolled } from '../api'
import { formatDateTime } from '../format'
import { href } from '../router'
import type { ProjectSummary } from '../types'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { Empty } from '../ui/Empty'
import { Layout } from '../ui/Layout'
import { Loading } from '../ui/Loading'
import { Table } from '../ui/Table'
import { Heading, Link } from '../ui/Text'

export function ProjectsPage() {
  const loaded = usePolled(api.projects, 'projects')
  return (
    <Layout>
      <Heading level={1}>Projects</Heading>
      <Loading loaded={loaded}>
        {(projects) =>
          projects.length === 0 ? (
            <Empty>No project uses Drillmaster yet. Run /devops-drillmaster:setup in a project.</Empty>
          ) : (
            <Card>
              <Table<ProjectSummary>
                testId="projects"
                rows={projects}
                rowKey={(project) => project.id}
                rowHref={(project) => href.project(project.id)}
                columns={[
                  { header: 'Project', cell: (project) => <Link href={href.project(project.id)}>{project.dir}</Link> },
                  { header: "Owner's objective", cell: (project) => project.objective },
                  { header: 'Workflow', cell: (project) => <Badge tone="accent">v{project.workflow_version}</Badge> },
                  { header: 'Work items', cell: (project) => (project.active ? `${project.work_items} (${project.active} active)` : project.work_items) },
                  { header: 'Last activity', cell: (project) => formatDateTime(project.last_activity) },
                ]}
              />
            </Card>
          )
        }
      </Loading>
    </Layout>
  )
}
