// Every fact Drillmaster knows is an event in an append-only stream, one stream per project.
// All state is a pure fold over these events, so any run can be replayed from its JSONL.

import type { WorkflowDocument } from './workflow.js'

/** What every event carries. The server sets `id` and `at` from its ports. */
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

/** A Claude Code session the hooks have seen. */
export interface SessionRegistered extends EventEnvelope {
  type: 'session_registered'
  session_id: string
  /** startup | resume | clear | compact, or `implicit` when a later hook saw it first. */
  source: string
}

export interface WorkItemStarted extends EventEnvelope {
  type: 'work_item_started'
  work_item_id: string
  issue: string
  /** The workflow version the work item runs through. */
  workflow_version: number
  /** sha256 of Agent's token. The token itself is never stored. */
  token_hash: string
  stage: number | null
  step: number | null
}

/** A session is tied to a work item when it starts it. */
export interface SessionBound extends EventEnvelope {
  type: 'session_bound'
  session_id: string
  work_item_id: string
}

/** One work trace: something recorded automatically by a hook, independent of Agent. */
export interface WorkTrace extends EventEnvelope {
  type: 'work_trace'
  session_id: string
  /** The work item the session was bound to when this happened, if any. */
  work_item_id: string | null
  /** The work item's position when this happened. */
  stage: number | null
  step: number | null
  hook: string
  /** For tool hooks. */
  tool?: string
  input?: string
  /** PostToolUse: whether the tool reported an error. */
  error?: boolean
  /** UserPromptSubmit: Owner's words. */
  prompt?: string
  /** The raw hook payload, only when the server runs with DRILLMASTER_RECORD=1. */
  raw?: unknown
}

export type DrillmasterEvent =
  | ProjectInitialized
  | WorkflowChanged
  | SessionRegistered
  | WorkItemStarted
  | SessionBound
  | WorkTrace

export type EventType = DrillmasterEvent['type']

/** An event before the server has given it an id and a time. */
export type NewEvent = DrillmasterEvent extends infer E
  ? E extends DrillmasterEvent
    ? Omit<E, 'id' | 'at'>
    : never
  : never
