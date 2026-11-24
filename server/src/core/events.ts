import type { ExperimentReflection, Feedback } from './feedback.js'
import type { VersionLevel, WorkflowDocument } from './workflow.js'

export interface EventEnvelope {
  id: string
  at: string
  /** The workflow version the event was made under: its work item's, or the project's. */
  workflow_version?: string
  drillmaster_version?: string
  /** The Drillmaster server that wrote the event; each writes its own files in the Drillmaster repository. */
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
  /** References to what the proposal builds on; one that an earlier proposal adds makes it depend on that one. */
  relies_on?: string[]
  depends_on?: number[]
}

export interface RetroFindings {
  opening?: string
  should: string
  did: string
  why: string
  keep: Feedback[]
  improve: Feedback[]
}

export interface RetrospectiveRan extends EventEnvelope {
  type: 'retrospective_ran'
  retro_id: string
  work_items: string[]
  findings: RetroFindings
  proposals: Proposal[]
}

/** 'prompt' is from Drillmaster before 0.3, when Owner's chat words could decide. */
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
  /** GUIDs of the stages this session works on; absent for every stage. */
  stage_guids?: string[]
}

/** A later session takes the work item up, with a new token that voids the old one. */
export interface WorkItemResumed extends EventEnvelope {
  type: 'work_item_resumed'
  work_item_id: string
  token_hash: string
  stage_guids?: string[]
}

/** A work item moved to a newer workflow version at an update step, keeping the steps it had done that are unchanged. */
export interface WorkItemUpdated extends EventEnvelope {
  type: 'work_item_updated'
  work_item_id: string
  from_version: string
  to_version: string
  /** GUIDs of the steps kept as done. */
  kept: string[]
  resumes_at: Position & { step_guid?: string }
  done: boolean
}

export type SkipDecider = 'self' | 'drillmaster' | 'owner'

export interface StepSkipRequested extends EventEnvelope {
  type: 'step_skip_requested'
  work_item_id: string
  stage: number
  step: number
  step_guid?: string
  decided_by: SkipDecider
  why: string
}

export interface StepSkipDecided extends EventEnvelope {
  type: 'step_skip_decided'
  work_item_id: string
  stage: number
  step: number
  step_guid?: string
  accepted: boolean
  /** 'condition' when the step's or its stage's `if` isn't met, with no request. */
  by: 'agent' | 'drillmaster' | 'owner' | 'condition'
  via?: DecidedVia
  why: string
  next: Position
  done: boolean
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
  step_guid?: string
  hook: string
  tool?: string
  tool_use_id?: string
  input?: string
  error?: boolean
  exit_code?: number
  /** The last lines of what the tool printed, unless a tool capture kept what it printed instead. */
  output?: string
  /** What the workflow's tool captures kept of a shell command's output. */
  captures?: { name: string; lines: string[]; fields: Record<string, string>[] }[]
  /** Tool captures whose command matched, but whose pipeline kept nothing. */
  capture_found_nothing?: string[]
  output_may_be_shortened?: boolean
  prompt?: string
  /** What Owner answered in AskUserQuestion, each question in full, with Owner's note. */
  answers?: { question: string; answer: string; notes?: string }[]
  raw?: unknown
}

export const REPORT_KINDS = ['impediment', 'better_way', 'decision', 'question', 'assumption', 'required', 'added_step'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export interface WorkReported extends EventEnvelope {
  type: 'work_reported'
  work_item_id: string
  stage: number | null
  step: number | null
  step_guid?: string
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
  step_guid?: string
  gate: 'self' | 'drillmaster' | 'owner'
  self_check: SelfCheck[]
  text: string
  /** The traces at this step whose tool captures kept output, as evidence for the gate. */
  capture_traces?: string[]
}

export interface InputAnswer {
  name: string
  value: string
  explanation?: string
}

/** A work item input set, at work_start (no step) or at a step; a later one changes it. */
export interface InputSet extends EventEnvelope {
  type: 'input_set'
  work_item_id: string
  stage: number | null
  step: number | null
  step_guid?: string
  name: string
  value: string
  explanation?: string
  by: 'agent' | 'drillmaster' | 'owner'
  /**
   * When the change makes a step that was skipped by its condition apply: the step the work item
   * goes back to, and the GUIDs of the done steps before it, which it keeps.
   */
  goes_back?: { to: Position & { step_guid?: string }; kept: string[] }
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
  step_guid?: string
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
  step_guid?: string
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

/** The friction judge's verdict on each of Owner's inputs on a work item. Drillmaster 0.3 wrote it. */
export interface OwnerInputsJudged extends EventEnvelope {
  type: 'owner_inputs_judged'
  work_item_id: string
  inputs: { event: string; friction: boolean; why: string }[]
}

export interface ComplaintsGrouped extends EventEnvelope {
  type: 'complaints_grouped'
  /** Each problem names the complaints it groups by their ids (see drillmasterPage.ts). */
  groups: { tool: string; summary: string; complaints: string[] }[]
}

/** Drillmaster 0.3 wrote it. */
export interface FrictionPlaced extends EventEnvelope {
  type: 'friction_placed'
  work_item_id: string
  inputs: { event: string; step_guid: string | null; why: string }[]
}

/** Where a judged measure happened on a work item: at a step, or where no step should have caught it. */
export interface MeasureOccurrence {
  step_guid: string | null
  /** The ids of the events it is about. */
  events: string[]
  why: string
}

export interface MeasureJudgement {
  measure: string
  occurrences: MeasureOccurrence[]
}

/** Drillmaster's judgement of the measures on what happened to a work item after its post mortem, such as Owner's corrections after delivery. */
export interface LateMeasuresJudged extends EventEnvelope {
  type: 'late_measures_judged'
  work_item_id: string
  /** The last event of the work item it judged. */
  through: string
  measured: MeasureJudgement[]
}

/** Owner answered one of Drillmaster's questions with words of their own instead of deciding it. */
export interface OwnerCommented extends EventEnvelope {
  type: 'owner_commented'
  /** Which question: its key (questionKeyOf in state.ts). */
  question: string
  work_item_id?: string
  comment: string
}

export interface PostMortemWritten extends EventEnvelope {
  type: 'post_mortem_written'
  work_item_id: string
  author: 'agent' | 'drillmaster'
  keep: Feedback[]
  change: Feedback[]
  experiment_reflections: ExperimentReflection[]
  /** Drillmaster's judgement of each measure the workflow defines; missing when it could not judge them. */
  measured?: MeasureJudgement[]
  /** The last event of the work item the judgement read; what came after is judged later. */
  judged_through?: string
}

export type DrillmasterEvent =
  | ProjectInitialized
  | WorkflowChanged
  | SessionRegistered
  | WorkItemStarted
  | WorkItemResumed
  | WorkItemUpdated
  | StepSkipRequested
  | StepSkipDecided
  | SessionBound
  | WorkTrace
  | WorkReported
  | GateSubmitted
  | GateVerdict
  | ReviewFailed
  | InputSet
  | WorkItemDelivered
  | PostMortemWritten
  | LateMeasuresJudged
  | OwnerInputsJudged
  | FrictionPlaced
  | ComplaintsGrouped
  | RetrospectiveRan
  | OwnerDecided
  | OwnerAsked
  | OwnerCommented

export type NewEvent = DrillmasterEvent extends infer E
  ? E extends DrillmasterEvent
    ? Omit<E, 'id' | 'at'>
    : never
  : never
