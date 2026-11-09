import type { DrillmasterEvent } from './core/events.js'

export interface EventStore {
  append(projectId: string, event: DrillmasterEvent): Promise<void>
  read(projectId: string): Promise<DrillmasterEvent[]>
  projectIds(): Promise<string[]>
}

export interface Clock {
  now(): string
}

export interface Ids {
  next(prefix: string): string
  secret(): string
}

export interface ReviewRequest {
  kind: string
  prompt: string
  minTimeoutMs?: number
}

export interface ReviewResult {
  answer: unknown
}

export interface Reviewer {
  review(request: ReviewRequest): Promise<ReviewResult>
}

export interface Ports {
  store: EventStore
  clock: Clock
  ids: Ids
  reviewer: Reviewer
}
