import { useRoute } from './router'
import { HomePage } from './views/HomePage'
import { WorkflowPage } from './views/WorkflowPage'

export function App() {
  const route = useRoute()
  switch (route.page) {
    case 'home':
      return <HomePage />
    case 'workflow':
      return <WorkflowPage id={route.id} at={route.at} />
  }
}
