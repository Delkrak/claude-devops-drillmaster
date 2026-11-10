import { useRoute } from './router'
import { ProjectPage } from './views/ProjectPage'
import { HistoryPage } from './views/HistoryPage'
import { HomePage } from './views/HomePage'
import { WorkItemPage } from './views/WorkItemPage'

export function App() {
  const route = useRoute()
  switch (route.page) {
    case 'home':
      return <HomePage />
    case 'project':
      return <ProjectPage id={route.id} tab={route.tab} />
    case 'item':
      return <WorkItemPage id={route.id} item={route.item} highlightedEvent={route.event} />
    case 'history':
      return <HistoryPage id={route.id} guid={route.guid} />
  }
}
