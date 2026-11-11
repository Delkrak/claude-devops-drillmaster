export type GateKind = 'self' | 'drillmaster' | 'owner'

export interface ProjectSummary {
  id: string
  dir: string
  objective: string
  workflow_version: string
  work_items: number
  active: number
  last_activity: string | null
}

export interface WorkStep {
  guid: string
  n: number
  name: string
  instruction?: string
  gate: GateKind
  rules: string[]
  report: string[]
  skippable?: 'self' | 'drillmaster' | 'owner'
  update?: 'patch' | 'minor' | 'major' | 'none'
}

export interface WorkStage {
  guid: string
  n: number
  name: string
  purpose?: string
  steps: WorkStep[]
}

export interface WorkItemInput {
  guid: string
  name: string
  options: { value: string; description: string }[]
  set_at: string
  by: 'agent' | 'drillmaster' | 'owner'
  instruction: string
}

export interface PolicyRule {
  guid: string
  id: string
  rule: string
  verified_by: string
}

export interface Experiment {
  id: number
  change: string
  purpose: string
  hypothesis?: string
  null_hypothesis?: string
  measure: string
  baseline: number
  baseline_sd?: number
  target?: number | null
  judge_after?: number
  started: string
}

export interface ExperimentVerdict {
  id: number
  status: 'running' | 'keep' | 'rethink'
  counted: number
  judge_after: number
  mean: number | null
}

export interface Workflow {
  version: string
  objective: { text: string; measures: string[] }
  stages: WorkStage[]
  policies: { guid: string; name: string; rules: PolicyRule[] }[]
  inputs?: WorkItemInput[]
  experiments: Experiment[]
}

export interface Measure {
  name: string
  last_5: number | null
  all: number | null
  per_item: { work_item_id: string; issue: string; value: number }[]
  by_input?: { input: string; options: { option: string; items: number; mean: number | null }[] }[]
}

export interface WorkItemRow {
  work_item_id: string
  issue: string
  status: 'active' | 'delivered'
  stage: number | null
  step: number | null
  pending_gate: { stage: number; step: number; gate: 'drillmaster' | 'owner'; review_failed?: string } | null
  workflow_version: string
  started_at: string
  pr: string | null
  reports: number
  traces: number
  rejections: number
  post_mortems: string[]
  added_steps: number
  measures: Record<string, number> | null
}

export interface Proposal {
  id: number
  change: string
  purpose: string
  measure: string
  ops: unknown[]
  relies_on?: string[]
  depends_on?: number[]
  status: 'applied' | 'approved' | 'declined' | 'open'
}

export interface Feedback {
  refs: { ref: string; guid: string | null }[]
  text: string
}

export interface DrillmasterFeedback {
  at: string
  tool: string
  text: string
  from: string
  work_item_id: string | null
}

export interface HistoryEntry {
  id: string
  at: string
  type: string
  work_item_id: string | null
  text: string
}

export interface ComponentHistory {
  guid: string
  kind: 'step' | 'stage' | 'rule' | 'policy' | 'input'
  current: { ref: string; title: string } | null
  versions: { version: string; at: string; reason: string; name: string | null; definition: Record<string, unknown> | null; change: 'added' | 'changed' | 'same' | 'removed' }[]
  feedback: HistoryEntry[]
  activity: HistoryEntry[]
}

export interface Retrospective {
  retro_id: string
  at: string
  work_items: string[]
  findings: { opening?: string; should: string; did: string; why: string; keep: Feedback[]; improve: Feedback[] }
  proposals: Proposal[]
  decisions: { at: string; prompt: string }[]
}

export interface ProjectView {
  drillmaster_feedback?: DrillmasterFeedback[]
  summary: ProjectSummary
  workflow: Workflow
  versions: { version: string; at: string; reason: string; workflow: Workflow }[]
  measures: Measure[]
  work_items: WorkItemRow[]
  retrospectives: Retrospective[]
  sessions: { session_id: string; work_item_id: string | null }[]
  experiment_verdicts: ExperimentVerdict[]
}

export interface Artifact {
  name: string
  path: string
  media_type: string
  bytes: number
}

export interface TimelineEvent {
  id: string
  at: string
  type: string
  [field: string]: unknown
}

export interface WorkItemView {
  item: Omit<WorkItemRow, 'added_steps' | 'measures'> & {
    sessions: string[]
    gates_done: boolean
    description: string
    summary: string | null
    artifacts: Artifact[]
    inputs: Record<string, { value: string; by: string; explanation?: string }>
    passed_steps: string[]
    skipped_steps: string[]
    pending_skip: { stage: number; step: number; decided_by: string; why: string } | null
    last_update: { from_version: string; to_version: string } | null
  }
  workflow: Workflow | undefined
  measures: Record<string, number> | null
  timeline: TimelineEvent[]
  post_mortems: TimelineEvent[]
}
