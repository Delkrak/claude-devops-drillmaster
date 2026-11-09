import { useEffect, useState } from 'react'
import type { ProjectSummary, ProjectView, WorkItemView } from './types'

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  return body
}

export const api = {
  projects: () => getJson<ProjectSummary[]>('/api/projects'),
  project: (id: string) => getJson<ProjectView>(`/api/projects/${encodeURIComponent(id)}`),
  workItem: (id: string, item: string) => getJson<WorkItemView>(`/api/projects/${encodeURIComponent(id)}/items/${encodeURIComponent(item)}`),
}

export const REFRESH_MS = 4000

export type Loaded<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T }

export function usePolled<T>(load: () => Promise<T>, reloadKey: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  useEffect(() => {
    let mounted = true
    setState({ status: 'loading' })
    const refresh = () =>
      load()
        .then((data) => mounted && setState({ status: 'ready', data }))
        .catch((error: unknown) => mounted && setState({ status: 'error', error: error instanceof Error ? error.message : String(error) }))
    void refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      mounted = false
      clearInterval(timer)
    }
    // `load` changes identity on every render; `reloadKey` says when it really changed.
  }, [reloadKey])
  return state
}
