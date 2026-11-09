import { useEffect, useState } from 'react'
import type { ProjectSummary, ProjectView, WorkItemView } from './types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } })
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  return body
}

export const api = {
  projects: () => get<ProjectSummary[]>('/api/projects'),
  project: (id: string) => get<ProjectView>(`/api/projects/${encodeURIComponent(id)}`),
  workItem: (id: string, item: string) => get<WorkItemView>(`/api/projects/${encodeURIComponent(id)}/items/${encodeURIComponent(item)}`),
}

export const REFRESH_MS = 4000

export type Loaded<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T }

/** Loads, then refreshes every few seconds, so the page follows a live session. */
export function usePolled<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    const tick = () =>
      load()
        .then((data) => alive && setState({ status: 'ready', data }))
        .catch((error: unknown) => alive && setState({ status: 'error', error: error instanceof Error ? error.message : String(error) }))
    void tick()
    const timer = setInterval(tick, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
    // `load` changes identity on every render; `key` says when it really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}
