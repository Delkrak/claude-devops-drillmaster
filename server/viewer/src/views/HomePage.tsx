import { useEffect } from 'react'
import { api, usePolled } from '../api'
import { href } from '../router'
import { Empty } from '../ui/Empty'
import { Loading } from '../ui/Loading'
import { Shell } from '../ui/Shell'

export function HomePage() {
  const loaded = usePolled(api.served, 'served')
  const servedProject = loaded.status === 'ready' ? loaded.data.project : null
  useEffect(() => {
    if (servedProject) window.location.replace(href.workflow(servedProject))
  }, [servedProject])
  return (
    <Shell title="Drillmaster">
      <Loading loaded={loaded}>{({ project }) => (project ? null : <Empty>This Drillmaster server serves no project.</Empty>)}</Loading>
    </Shell>
  )
}
