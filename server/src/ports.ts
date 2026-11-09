// The only things the core depends on. Production and tests plug in different adapters.

import type { DrillmasterEvent } from './core/events.js'

export interface EventStore {
  /** Appends one event to a project's stream. Nothing is ever rewritten. */
  append(project: string, event: DrillmasterEvent): Promise<void>
  /** Reads a project's whole stream, oldest first. */
  read(project: string): Promise<DrillmasterEvent[]>
  /** Every project with at least one event. */
  projects(): Promise<string[]>
}

export interface Clock {
  /** An ISO 8601 timestamp. */
  now(): string
}

export interface Ids {
  next(prefix: string): string
}

/** What Drillmaster is asked to judge: a work gate, a post mortem, a retrospective. */
export interface ReviewRequest {
  kind: string
  prompt: string
}

export interface ReviewResult {
  /** The reviewer's JSON answer; its shape depends on the request kind. */
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
