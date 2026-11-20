import { useEffect, useState } from 'react'

export type Route =
  | { page: 'home' }
  | { page: 'workflow'; id: string; at: string | null }
  | { page: 'workItems'; id: string; at: string | null }
  | { page: 'changes'; id: string; at: string | null }
  | { page: 'workItem'; id: string; workItemId: string; at: string | null }

/**
 * `#/p/<project>/workflow`, `#/p/<project>/items`, `#/p/<project>/items/<work item>` and
 * `#/p/<project>/changes`, each with
 * `?at=<ISO time>`; any other project link opens the Workflow page.
 */
export function parseRoute(hash: string): Route {
  const [routePath = '', query = ''] = hash.replace(/^#\/?/, '').split('?')
  const [section, id, page, workItemId] = routePath.split('/').filter(Boolean).map(decodeURIComponent)
  const at = new URLSearchParams(query).get('at')
  if (section !== 'p' || !id) return { page: 'home' }
  if (page === 'items' && workItemId) return { page: 'workItem', id, workItemId, at }
  if (page === 'items') return { page: 'workItems', id, at }
  if (page === 'changes') return { page: 'changes', id, at }
  return { page: 'workflow', id, at }
}

const moment = (at?: string | null) => (at ? `?at=${encodeURIComponent(at)}` : '')

export const href = {
  home: () => '#/',
  workflow: (id: string, at?: string | null) => `#/p/${encodeURIComponent(id)}/workflow${moment(at)}`,
  changes: (id: string, at?: string | null) => `#/p/${encodeURIComponent(id)}/changes${moment(at)}`,
  workItems: (id: string, at?: string | null) => `#/p/${encodeURIComponent(id)}/items${moment(at)}`,
  workItem: (id: string, workItemId: string, at?: string | null) => `#/p/${encodeURIComponent(id)}/items/${encodeURIComponent(workItemId)}${moment(at)}`,
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
