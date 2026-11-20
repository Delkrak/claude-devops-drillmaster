import { useEffect } from 'react'
import { api, usePolled } from '../api'
import { href } from '../router'
import { Empty } from '../ui/Empty'
import { Loading } from '../ui/Loading'
import { Shell } from '../ui/Shell'

/** Each Drillmaster server serves one project, and its viewer opens on its Workflow page. */
export function HomePage() {
  const loaded = usePolled(api.served, 'served')
  const served = loaded.status === 'ready' ? loaded.data.project : null
  useEffect(() => {
    if (served) window.location.replace(href.workflow(served))
  }, [served])
  return (
    <Shell title="Drillmaster">
      <Loading loaded={loaded}>{({ project }) => (project ? null : <Empty>This Drillmaster server serves no project.</Empty>)}</Loading>
    </Shell>
  )
}
