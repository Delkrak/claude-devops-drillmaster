// Every fact Drillmaster knows is an event in an append-only stream, one stream per project.
// All state is a pure fold over these events, so any run can be replayed from its JSONL.

import type { WorkflowDocument } from './workflow.js'

/** What every event carries: who appended it is the server, so `id` and `at` come from its ports. */
export interface EventEnvelope {
  id: string
  at: string
}

export interface ProjectInitialized extends EventEnvelope {
  type: 'project_initialized'
  /** The project directory, as the client saw it. */
  dir: string
  /** workflow_0: Owner's objective, and nothing else yet. */
  workflow: WorkflowDocument
}

export interface WorkflowChanged extends EventEnvelope {
  type: 'workflow_changed'
  /** The whole next version, so every version can be read back without replaying changes. */
  workflow: WorkflowDocument
  reason: string
}

export type DrillmasterEvent = ProjectInitialized | WorkflowChanged

export type EventType = DrillmasterEvent['type']

/** An event before the server has given it an id and a time. */
export type NewEvent = DrillmasterEvent extends infer E
  ? E extends DrillmasterEvent
    ? Omit<E, 'id' | 'at'>
    : never
  : never
