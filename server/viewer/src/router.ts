import { useEffect, useState } from 'react'

export type Route = { page: 'home' } | { page: 'workflow'; id: string; at: string | null }

/** `#/p/<project>/workflow?at=<ISO time>`; any other project link opens the Workflow page too. */
export function parseRoute(hash: string): Route {
  const [routePath = '', query = ''] = hash.replace(/^#\/?/, '').split('?')
  const [section, projectId] = routePath.split('/').filter(Boolean).map(decodeURIComponent)
  if (section === 'p' && projectId) return { page: 'workflow', id: projectId, at: new URLSearchParams(query).get('at') }
  return { page: 'home' }
}

export const href = {
  home: () => '#/',
  workflow: (id: string, at?: string) => `#/p/${encodeURIComponent(id)}/workflow${at ? `?at=${encodeURIComponent(at)}` : ''}`,
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return route
}
