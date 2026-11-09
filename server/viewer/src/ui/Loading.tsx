import type { ReactNode } from 'react'
import type { Loaded } from '../api'
import { Empty } from './Empty'

/** Renders loading and error states, and the page once its data is ready. */
export function Loading<T>({ loaded, children }: { loaded: Loaded<T>; children: (data: T) => ReactNode }) {
  if (loaded.status === 'loading') return <Empty>Loading...</Empty>
  if (loaded.status === 'error') return <Empty>Could not load: {loaded.error}</Empty>
  return <>{children(loaded.data)}</>
}
