import { useRoute } from './router'
import { HomePage } from './views/HomePage'
import { WorkflowPage } from './views/WorkflowPage'
import { WorkItemPage } from './views/WorkItemPage'
import { WorkItemsPage } from './views/WorkItemsPage'

export function App() {
  const route = useRoute()
  switch (route.page) {
    case 'home':
      return <HomePage />
    case 'workflow':
      return <WorkflowPage id={route.id} at={route.at} />
    case 'workItems':
      return <WorkItemsPage id={route.id} at={route.at} />
    case 'workItem':
      // A new key per work item: what was opened on one route does not carry over to the next.
      return <WorkItemPage key={route.workItemId} id={route.id} workItemId={route.workItemId} at={route.at} />
  }
}
