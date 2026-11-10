import { useEffect, useState } from 'react'

export type Route =
  | { page: 'home' }
  | { page: 'project'; id: string; tab: ProjectTab }
  | { page: 'item'; id: string; item: string; event: string | null }
  | { page: 'history'; id: string; guid: string }

export const PROJECT_TABS = ['overview', 'workflow', 'items', 'retrospectives', 'measures'] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]

export function parseRoute(hash: string): Route {
  const [routePath = '', query = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = routePath.split('/').filter(Boolean).map(decodeURIComponent)
  const [section, projectId, subPage, subId] = parts
  if (section === 'p' && projectId) {
    if (subPage === 'items' && subId) return { page: 'item', id: projectId, item: subId, event: new URLSearchParams(query).get('event') }
    if (subPage === 'history' && subId) return { page: 'history', id: projectId, guid: subId }
    const tab = PROJECT_TABS.find((candidate) => candidate === subPage) ?? 'overview'
    return { page: 'project', id: projectId, tab }
  }
  return { page: 'home' }
}

export const href = {
  home: () => '#/',
  project: (id: string, tab: ProjectTab = 'overview') => `#/p/${encodeURIComponent(id)}/${tab}`,
  item: (id: string, item: string) => `#/p/${encodeURIComponent(id)}/items/${encodeURIComponent(item)}`,
  /** One event in a work item's timeline: a link to a single trace. */
  event: (id: string, item: string, eventId: string) => `#/p/${encodeURIComponent(id)}/items/${encodeURIComponent(item)}?event=${encodeURIComponent(eventId)}`,
  history: (id: string, guid: string) => `#/p/${encodeURIComponent(id)}/history/${encodeURIComponent(guid)}`,
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
