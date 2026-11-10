import { useEffect, useState } from 'react'

export type Route =
  | { page: 'home' }
  | { page: 'project'; id: string; tab: ProjectTab }
  | { page: 'item'; id: string; item: string }

export const PROJECT_TABS = ['overview', 'workflow', 'items', 'retrospectives', 'measures'] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [section, projectId, subPage, workItemId] = parts
  if (section === 'p' && projectId) {
    if (subPage === 'items' && workItemId) return { page: 'item', id: projectId, item: workItemId }
    const tab = PROJECT_TABS.find((candidate) => candidate === subPage) ?? 'overview'
    return { page: 'project', id: projectId, tab }
  }
  return { page: 'home' }
}

export const href = {
  home: () => '#/',
  project: (id: string, tab: ProjectTab = 'overview') => `#/p/${encodeURIComponent(id)}/${tab}`,
  item: (id: string, item: string) => `#/p/${encodeURIComponent(id)}/items/${encodeURIComponent(item)}`,
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
