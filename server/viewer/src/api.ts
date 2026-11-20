import { useEffect, useState } from 'react'
import type { WorkflowPage, WorkItemPage, WorkItemsEntry } from './types'

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  return body
}

const moment = (at: string | null) => (at ? `?at=${encodeURIComponent(at)}` : '')

export const api = {
  served: () => getJson<{ project: string | null }>('/api/served'),
  workflow: (id: string, at: string | null) => getJson<WorkflowPage>(`/api/projects/${encodeURIComponent(id)}/workflow${moment(at)}`),
  workItems: (id: string, at: string | null) => getJson<WorkItemsEntry[]>(`/api/projects/${encodeURIComponent(id)}/work-items${moment(at)}`),
  workItem: (id: string, workItemId: string, at: string | null) => getJson<WorkItemPage>(`/api/projects/${encodeURIComponent(id)}/work-items/${encodeURIComponent(workItemId)}${moment(at)}`),
}

export const REFRESH_MS = 4000

export type Loaded<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T }

/** Loads, then loads again every `refreshMs` while the page is open; once only when it is null. */
export function usePolled<T>(load: () => Promise<T>, reloadKey: string, refreshMs: number | null = REFRESH_MS): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  useEffect(() => {
    let mounted = true
    setState({ status: 'loading' })
    const refresh = () =>
      load()
        .then((data) => mounted && setState({ status: 'ready', data }))
        // A failed refresh keeps what the page showed; only a first load that fails shows the error.
        .catch((error: unknown) => mounted && setState((shown) => (shown.status === 'ready' ? shown : { status: 'error', error: error instanceof Error ? error.message : String(error) })))
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
