export type GateKind = 'self' | 'drillmaster' | 'owner'

export interface ProjectSummary {
  id: string
  dir: string
  objective: string
  workflow_version: number
  work_items: number
  active: number
  last_activity: string | null
}

export interface WorkStep {
  n: number
  name: string
  gate: GateKind
  rules: string[]
  report: string[]
}

export interface WorkStage {
  n: number
  name: string
  steps: WorkStep[]
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
  measure: string
  baseline: number
  started: string
}

export interface Workflow {
  version: number
  objective: { text: string; measures: string[] }
  stages: WorkStage[]
  policies: { name: string; rules: PolicyRule[] }[]
  experiments: Experiment[]
}

export interface Measure {
  name: string
  last_5: number | null
  all: number | null
  per_item: { work_item_id: string; issue: string; value: number }[]
}

export interface WorkItemRow {
  work_item_id: string
  issue: string
  status: 'active' | 'delivered'
  stage: number | null
  step: number | null
  pending_gate: { stage: number; step: number; gate: 'drillmaster' | 'owner'; review_failed?: string } | null
  workflow_version: number
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
  findings: { should: string; did: string; why: string; keep: string; improve: string }
  proposals: Proposal[]
  decisions: { at: string; prompt: string }[]
}

export interface ProjectView {
  summary: ProjectSummary
  workflow: Workflow
  versions: { version: number; at: string; reason: string; workflow: Workflow }[]
  measures: Measure[]
  work_items: WorkItemRow[]
  retrospectives: Retrospective[]
  sessions: { session_id: string; work_item_id: string | null }[]
}

export interface TimelineEvent {
  id: string
  at: string
  type: string
  [field: string]: unknown
}

export interface WorkItemView {
  item: Omit<WorkItemRow, 'added_steps' | 'measures'> & { sessions: string[]; gates_done: boolean }
  workflow: Workflow | undefined
  measures: Record<string, number> | null
  timeline: TimelineEvent[]
  post_mortems: TimelineEvent[]
}
