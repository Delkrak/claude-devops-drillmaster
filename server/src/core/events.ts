import type { VersionLevel, WorkflowDocument } from './workflow.js'

export interface EventEnvelope {
  id: string
  at: string
  /** The workflow version the event was made under: its work item's, or the project's. */
  workflow_version?: string
  drillmaster_version?: string
  /** The Drillmaster server that wrote the event; each writes its own files in the store. */
  writer?: string
}

export interface ProjectInitialized extends EventEnvelope {
  type: 'project_initialized'
  dir: string
  workflow: WorkflowDocument
}

export interface WorkflowChanged extends EventEnvelope {
  type: 'workflow_changed'
  workflow: WorkflowDocument
  reason: string
  level?: VersionLevel
  retro_id?: string
  proposal?: number
}

export interface Proposal {
  id: number
  change: string
  purpose: string
  measure: string
  hypothesis?: string
  null_hypothesis?: string
  target?: number | null
  judge_after?: number
  ops: unknown[]
  depends_on?: number[]
}

export interface RetrospectiveRan extends EventEnvelope {
  type: 'retrospective_ran'
  retro_id: string
  work_items: string[]
  findings: { opening?: string; should: string; did: string; why: string; keep: string; improve: string }
  proposals: Proposal[]
}

export type DecidedVia = 'prompt' | 'question'

export interface OwnerDecided extends EventEnvelope {
  type: 'owner_decided'
  retro_id: string
  approved: number[]
  declined: number[]
  prompt: string
  via?: DecidedVia
  comment?: string
}

export interface OwnerAsked extends EventEnvelope {
  type: 'owner_asked'
  session_id: string
  tool_use_id: string
  questions: string[]
}

export interface SessionRegistered extends EventEnvelope {
  type: 'session_registered'
  session_id: string
  source: string
}

export interface WorkItemStarted extends EventEnvelope {
  type: 'work_item_started'
  work_item_id: string
  issue: string
  description?: string
  workflow_version: string
  token_hash: string
  stage: number | null
  step: number | null
}

export interface WorkItemRestarted extends EventEnvelope {
  type: 'work_item_restarted'
  work_item_id: string
  from_version: string
  to_version: string
}

export interface LateStartRequested extends EventEnvelope {
  type: 'late_start_requested'
  work_item_id: string
  start_at: Position
  justification: string
  evidence: string
  skipped: string[]
  owner_gates: string[]
}

export interface LateStartJudged extends EventEnvelope {
  type: 'late_start_judged'
  work_item_id: string
  by: 'drillmaster' | 'owner'
  via?: DecidedVia
  accepted: boolean
  why: string
  rule: string | null
}

export interface SessionBound extends EventEnvelope {
  type: 'session_bound'
  session_id: string
  work_item_id: string
}

export interface WorkTrace extends EventEnvelope {
  type: 'work_trace'
  session_id: string
  work_item_id: string | null
  stage: number | null
  step: number | null
  hook: string
  tool?: string
  tool_use_id?: string
  input?: string
  error?: boolean
  exit_code?: number
  output?: string
  prompt?: string
  raw?: unknown
}

export const REPORT_KINDS = ['impediment', 'better_way', 'decision', 'question', 'assumption', 'required', 'added_step'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export interface WorkReported extends EventEnvelope {
  type: 'work_reported'
  work_item_id: string
  stage: number | null
  step: number | null
  kind: ReportKind
  text: string
  chosen?: string
  by?: string
  why?: string
  asked?: string
  answer?: string
}

export interface SelfCheck {
  rule: string
  accepted: boolean
  evidence: string
}

export interface GateSubmitted extends EventEnvelope {
  type: 'gate_submitted'
  work_item_id: string
  stage: number
  step: number
  gate: 'self' | 'drillmaster' | 'owner'
  self_check: SelfCheck[]
  text: string
}

export interface MetricAnswer {
  name: string
  value: string
  explanation?: string
}

export interface MetricRecorded extends EventEnvelope {
  type: 'metric_recorded'
  work_item_id: string
  stage: number
  step: number
  name: string
  value: string
  explanation?: string
  by: 'agent' | 'drillmaster' | 'owner'
}

export interface Position {
  stage: number | null
  step: number | null
}

export interface GateVerdict extends EventEnvelope {
  type: 'gate_verdict'
  work_item_id: string
  stage: number
  step: number
  accepted: boolean
  by: 'agent' | 'drillmaster' | 'owner'
  via?: DecidedVia
  why: string
  rule: string | null
  next: Position
  done: boolean
}

export interface ReviewFailed extends EventEnvelope {
  type: 'review_failed'
  work_item_id: string
  stage: number
  step: number
  error: string
}

export interface WorkItemDelivered extends EventEnvelope {
  type: 'work_item_delivered'
  work_item_id: string
  pr: string
  summary?: string
  artifacts?: Artifact[]
}

export interface Artifact {
  name: string
  path: string
  media_type: string
  bytes: number
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
  | WorkItemRestarted
  | LateStartRequested
  | LateStartJudged
  | SessionBound
  | WorkTrace
  | WorkReported
  | GateSubmitted
  | GateVerdict
  | ReviewFailed
  | MetricRecorded
  | WorkItemDelivered
  | PostMortemWritten
  | RetrospectiveRan
  | OwnerDecided
  | OwnerAsked

export type NewEvent = DrillmasterEvent extends infer E
  ? E extends DrillmasterEvent
    ? Omit<E, 'id' | 'at'>
    : never
  : never
