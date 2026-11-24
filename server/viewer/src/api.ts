import { useEffect, useState } from 'react'
import type { ChangeRow, DrillmasterPage, WorkflowPage, WorkItemPage, WorkItemsList } from './types'

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  return body
}

const atQuery = (at: string | null) => (at ? `?at=${encodeURIComponent(at)}` : '')

export const api = {
  served: () => getJson<{ project: string | null }>('/api/served'),
  workflowPage: (projectId: string, at: string | null) => getJson<WorkflowPage>(`/api/projects/${encodeURIComponent(projectId)}/workflow${atQuery(at)}`),
  drillmasterPage: (projectId: string, at: string | null) => getJson<DrillmasterPage>(`/api/projects/${encodeURIComponent(projectId)}/drillmaster${atQuery(at)}`),
  changes: (projectId: string, at: string | null) => getJson<ChangeRow[]>(`/api/projects/${encodeURIComponent(projectId)}/changes${atQuery(at)}`),
  workItems: (projectId: string, at: string | null) => getJson<WorkItemsList>(`/api/projects/${encodeURIComponent(projectId)}/work-items${atQuery(at)}`),
  workItemPage: (projectId: string, workItemId: string, at: string | null) => getJson<WorkItemPage>(`/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(workItemId)}${atQuery(at)}`),
}

export const REFRESH_MS = 4000

export type Loaded<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T }

export function usePolled<T>(load: () => Promise<T>, reloadKey: string, refreshMs: number | null = REFRESH_MS): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  useEffect(() => {
    let mounted = true
    setState({ status: 'loading' })
    const refresh = () =>
      load()
        .then((data) => mounted && setState({ status: 'ready', data }))
        // A failed refresh keeps what the page showed; only a first load that fails shows the error.
        .catch((error: unknown) => mounted && setState((shownState) => (shownState.status === 'ready' ? shownState : { status: 'error', error: error instanceof Error ? error.message : String(error) })))
    void refresh()
    const timer = refreshMs === null ? undefined : setInterval(refresh, refreshMs)
    return () => {
      mounted = false
      clearInterval(timer)
    }
    // `load` changes identity on every render; `reloadKey` says when it really changed.
  }, [reloadKey, refreshMs])
  return state
}
