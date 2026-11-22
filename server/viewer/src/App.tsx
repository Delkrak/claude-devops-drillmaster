import { useRoute } from './router'
import { HomePage } from './views/HomePage'
import { ChangesPage } from './views/ChangesPage'
import { ComplaintsPage } from './views/ComplaintsPage'
import { WorkflowPage } from './views/WorkflowPage'
import { WorkItemPage } from './views/WorkItemPage'
import { WorkItemsPage } from './views/WorkItemsPage'

export function App() {
  const route = useRoute()
  switch (route.page) {
    case 'home':
      return <HomePage />
    case 'workflow':
      return <WorkflowPage projectId={route.projectId} at={route.at} />
    case 'changes':
      return <ChangesPage projectId={route.projectId} at={route.at} />
    case 'complaints':
      return <ComplaintsPage projectId={route.projectId} at={route.at} />
    case 'workItems':
      return <WorkItemsPage projectId={route.projectId} at={route.at} />
    case 'workItem':
      // A new key per work item: what was opened on one route does not carry over to the next.
      return <WorkItemPage key={route.workItemId} projectId={route.projectId} workItemId={route.workItemId} at={route.at} />
  }
}
