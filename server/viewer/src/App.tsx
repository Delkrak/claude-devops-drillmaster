import { useRoute } from './router'
import { ProjectPage } from './views/ProjectPage'
import { ProjectsPage } from './views/ProjectsPage'
import { WorkItemPage } from './views/WorkItemPage'

export function App() {
  const route = useRoute()
  switch (route.page) {
    case 'projects':
      return <ProjectsPage />
    case 'project':
      return <ProjectPage id={route.id} tab={route.tab} />
    case 'item':
      return <WorkItemPage id={route.id} item={route.item} />
  }
}
