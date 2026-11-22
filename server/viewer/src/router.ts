import { useEffect, useState } from 'react'

export type Route =
  | { page: 'home' }
  | { page: 'workflow'; projectId: string; at: string | null }
  | { page: 'workItems'; projectId: string; at: string | null }
  | { page: 'changes'; projectId: string; at: string | null }
  | { page: 'complaints'; projectId: string; at: string | null }
  | { page: 'workItem'; projectId: string; workItemId: string; at: string | null }

export function parseRoute(hash: string): Route {
  const [routePath = '', query = ''] = hash.replace(/^#\/?/, '').split('?')
  const [section, projectId, page, workItemId] = routePath.split('/').filter(Boolean).map(decodeURIComponent)
  const at = new URLSearchParams(query).get('at')
  if (section !== 'p' || !projectId) return { page: 'home' }
  if (page === 'items' && workItemId) return { page: 'workItem', projectId, workItemId, at }
  if (page === 'items') return { page: 'workItems', projectId, at }
  if (page === 'changes') return { page: 'changes', projectId, at }
  if (page === 'complaints') return { page: 'complaints', projectId, at }
  return { page: 'workflow', projectId, at }
}

const atQuery = (at?: string | null) => (at ? `?at=${encodeURIComponent(at)}` : '')

export const href = {
  home: () => '#/',
  workflow: (projectId: string, at?: string | null) => `#/p/${encodeURIComponent(projectId)}/workflow${atQuery(at)}`,
  changes: (projectId: string, at?: string | null) => `#/p/${encodeURIComponent(projectId)}/changes${atQuery(at)}`,
  complaints: (projectId: string, at?: string | null) => `#/p/${encodeURIComponent(projectId)}/complaints${atQuery(at)}`,
  workItems: (projectId: string, at?: string | null) => `#/p/${encodeURIComponent(projectId)}/items${atQuery(at)}`,
  workItem: (projectId: string, workItemId: string, at?: string | null) => `#/p/${encodeURIComponent(projectId)}/items/${encodeURIComponent(workItemId)}${atQuery(at)}`,
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
