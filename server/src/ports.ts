import type { Artifact, DrillmasterEvent } from './core/events.js'

export interface EventStore {
  append(projectId: string, event: DrillmasterEvent): Promise<void>
  read(projectId: string): Promise<DrillmasterEvent[]>
  projectIds(): Promise<string[]>
}

export interface ArtifactStore {
  save(projectId: string, workItemId: string, artifact: { relativePath: string; mediaType: string; bytes: Buffer }): Promise<Artifact>
  read(projectId: string, workItemId: string, name: string): Promise<Buffer | undefined>
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
  artifacts: ArtifactStore
  clock: Clock
  ids: Ids
  reviewer: Reviewer
}
