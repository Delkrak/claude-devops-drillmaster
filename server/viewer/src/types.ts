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
  n: number
  name: string
  instruction?: string
  gate: GateKind
  rules: string[]
  report: string[]
}

export interface WorkStage {
  n: number
  name: string
  purpose?: string
  steps: WorkStep[]
}

export interface Metric {
  name: string
  categories: { value: string; description: string }[]
  at: { stage: number; step: number }
  by: 'agent' | 'drillmaster' | 'owner'
  instruction: string
}

export interface PolicyRule {
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
  policies: { name: string; rules: PolicyRule[] }[]
  metrics?: Metric[]
  experiments: Experiment[]
}

export interface Measure {
  name: string
  last_5: number | null
  all: number | null
  per_item: { work_item_id: string; issue: string; value: number }[]
  by_metric?: { metric: string; categories: { category: string; items: number; mean: number | null }[] }[]
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
  depends_on?: number[]
  status: 'applied' | 'approved' | 'declined' | 'open'
}

export interface Retrospective {
  retro_id: string
  at: string
  work_items: string[]
  findings: { opening?: string; should: string; did: string; why: string; keep: string; improve: string }
  proposals: Proposal[]
  decisions: { at: string; prompt: string }[]
}

export interface ProjectView {
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
    metrics: Record<string, { value: string; by: string; explanation?: string }>
    skipped_steps: string[]
    restarted: { from_version: string; to_version: string } | null
    late_start: { status: string; skipped: string[]; start_at: { stage: number; step: number }; why: string | null } | null
  }
  workflow: Workflow | undefined
  measures: Record<string, number> | null
  timeline: TimelineEvent[]
  post_mortems: TimelineEvent[]
}
