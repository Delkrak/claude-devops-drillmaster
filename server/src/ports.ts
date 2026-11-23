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
  projects: ProjectResolver
}

/** Where a project's history is kept: a folder in a Drillmaster repository, a private git repository. */
export interface DrillmasterRepositoryPlace {
  url: string
  folder: string
}

export interface ProjectRef {
  key: string
  /** Null for a project kept only on this machine, as in tests. */
  repository: DrillmasterRepositoryPlace | null
}

/** Which project a work folder belongs to. */
export interface ProjectResolver {
  /** Undefined when the folder isn't a Drillmaster project yet. */
  resolve(projectDir: string): ProjectRef | undefined
  /** Makes the folder part of the project kept at `repository`. */
  link(projectDir: string, repository: DrillmasterRepositoryPlace): Promise<ProjectRef>
  /** Why the folder can't be linked, checked before setup pushes anything; undefined when it can. */
  linkProblem(projectDir: string): string | undefined
}
