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

export const REPORT_KINDS = ['impediment', 'better_way', 'decision', 'question', 'assumption', 'required'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

/** One work report from Agent: what it offers on its own, in real time. */
export interface WorkReported extends EventEnvelope {
  type: 'work_reported'
  work_item_id: string
  stage: number | null
  step: number | null
  kind: ReportKind
  text: string
  /** decision */
  chosen?: string
  by?: string
  why?: string
  /** question */
  asked?: string
  answer?: string
}

export interface SelfCheck {
  /** "<policy> <rule id>" */
  rule: string
  accepted: boolean
  evidence: string
}

/** Agent's work report at a work gate: a self check per referenced rule, and the step's report. */
export interface GateSubmitted extends EventEnvelope {
  type: 'gate_submitted'
  work_item_id: string
  stage: number
  step: number
  gate: 'self' | 'drillmaster' | 'owner'
  self_check: SelfCheck[]
  text: string
}

export interface Position {
  stage: number | null
  step: number | null
}

/** A work gate's verdict. Accepted moves the work on; rejected sends it back. */
export interface GateVerdict extends EventEnvelope {
  type: 'gate_verdict'
  work_item_id: string
  stage: number
  step: number
  accepted: boolean
  by: 'agent' | 'drillmaster' | 'owner'
  why: string
  /** The rule the verdict cites, if any. */
  rule: string | null
  /** Where the work item is after the verdict. stage null after the last work stage. */
  next: Position
  /** True when the last work step of the last work stage passed. */
  done: boolean
}

export interface WorkItemDelivered extends EventEnvelope {
  type: 'work_item_delivered'
  work_item_id: string
  pr: string
}

export interface PostMortemWritten extends EventEnvelope {
  type: 'post_mortem_written'
  work_item_id: string
  author: 'agent' | 'drillmaster'
  keep: string
  change: string
  experiment_reflections: string
  free_text: string
}

export type DrillmasterEvent =
  | ProjectInitialized
  | WorkflowChanged
  | SessionRegistered
  | WorkItemStarted
  | SessionBound
  | WorkTrace
  | WorkReported
  | GateSubmitted
  | GateVerdict
  | WorkItemDelivered
  | PostMortemWritten

export type EventType = DrillmasterEvent['type']

/** An event before the server has given it an id and a time. */
export type NewEvent = DrillmasterEvent extends infer E
  ? E extends DrillmasterEvent
    ? Omit<E, 'id' | 'at'>
    : never
  : never
