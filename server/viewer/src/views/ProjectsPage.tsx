import { api, usePolled } from '../api'
import { time } from '../format'
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
                rowKey={(p) => p.id}
                rowHref={(p) => href.project(p.id)}
                columns={[
                  { header: 'Project', cell: (p) => <Link href={href.project(p.id)}>{p.dir}</Link> },
                  { header: "Owner's objective", cell: (p) => p.objective },
                  { header: 'Workflow', cell: (p) => <Badge tone="accent">v{p.workflow_version}</Badge> },
                  { header: 'Work items', cell: (p) => (p.active ? `${p.work_items} (${p.active} active)` : p.work_items) },
                  { header: 'Last activity', cell: (p) => time(p.last_activity) },
                ]}
              />
            </Card>
          )
        }
      </Loading>
    </Layout>
  )
}
