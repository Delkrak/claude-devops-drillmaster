import { useEffect } from 'react'
import { api, usePolled } from '../api'
import { href } from '../router'
import { Empty } from '../ui/Empty'
import { Layout } from '../ui/Layout'
import { Loading } from '../ui/Loading'

/** Each Drillmaster server serves one project, and its viewer opens on it. */
export function HomePage() {
  const loaded = usePolled(api.served, 'served')
  const served = loaded.status === 'ready' ? loaded.data.project : null
  useEffect(() => {
    if (served) window.location.replace(href.project(served))
  }, [served])
  return (
    <Layout>
      <Loading loaded={loaded}>{({ project }) => (project ? null : <Empty>This Drillmaster server serves no project.</Empty>)}</Loading>
    </Layout>
  )
}
