import { useEffect, useState } from 'react'

/** The viewer's pages. Routes live in the URL hash, so the server only ever serves one page. */
export type Route =
  | { page: 'projects' }
  | { page: 'project'; id: string; tab: ProjectTab }
  | { page: 'item'; id: string; item: string }

export const PROJECT_TABS = ['overview', 'workflow', 'items', 'retrospectives', 'measures'] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [section, id, sub, item] = parts
  if (section === 'p' && id) {
    if (sub === 'items' && item) return { page: 'item', id, item }
    const tab = PROJECT_TABS.find((t) => t === sub) ?? 'overview'
    return { page: 'project', id, tab }
  }
  return { page: 'projects' }
}

export const href = {
  projects: () => '#/',
  project: (id: string, tab: ProjectTab = 'overview') => `#/p/${encodeURIComponent(id)}/${tab}`,
  item: (id: string, item: string) => `#/p/${encodeURIComponent(id)}/items/${encodeURIComponent(item)}`,
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
