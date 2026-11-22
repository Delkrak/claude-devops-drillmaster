// What the server's viewer API returns (server/src/core/workflowPage.ts, workItemPage.ts, changesPage.ts and drillmasterPage.ts).

export interface WorkItemRef {
  work_item_id: string
  issue: string
}

export interface WorkflowPageStep {
  n: number
  guid: string
  name: string
  gate: 'self' | 'drillmaster' | 'owner'
  if: string | null
  when: string | null
  alternative: { input: string; value: string } | null
  here_now: WorkItemRef[]
  reviews: { passed: number; sent_back: number }
}

export interface WorkflowPageStage {
  n: number
  guid: string
  name: string
  if: string | null
  when: string | null
  here_now: WorkItemRef[]
  friction: number
  stepped_in: WorkItemRef[]
  steps: WorkflowPageStep[]
}

export interface WorkflowPage {
  at: string
  workflow_version: string
  stages: WorkflowPageStage[]
  delivered: number
  waiting_to_deliver: WorkItemRef[]
  friction: { after_delivery: number; unplaced: number; after_delivery_items: WorkItemRef[]; unplaced_items: WorkItemRef[] }
}

export interface StepIn {
  event_id: string
  at: string
  prompt: string
  after_delivery: boolean
  why: string
  placed_why: string | null
}

export interface WorkItemPageStep {
  n: number
  guid: string
  name: string
  gate: 'self' | 'drillmaster' | 'owner'
  if: string | null
  when: string | null
  alternative: { input: string; value: string } | null
  status: 'passed' | 'skipped' | 'here' | 'ahead'
  happened: {
    skip: { by: string; why: string } | null
    verdicts: { at: string; by: string; accepted: boolean; why: string }[]
    reports: { kind: string; text: string }[]
    submitted: string | null
    waiting_for: 'drillmaster' | 'owner' | null
  }
  evidence: {
    self_check: { rule: string; accepted: boolean; evidence: string }[]
    kept_output: { tool: string; name: string; lines: string[] }[]
  }
  calls: { at: string; tool: string; did: string; failed: boolean }[]
  step_ins: StepIn[]
}

export interface WorkItemPage {
  at: string
  work_item_id: string
  issue: string
  kind: string | null
  description: string
  status: 'active' | 'delivered'
  workflow_version: string
  stages: { n: number; guid: string; name: string; steps: WorkItemPageStep[] }[]
  delivered: { at: string; summary: string | null; post_mortems: { author: string; keep: string[]; change: string[] }[] } | null
  step_ins_unplaced: StepIn[]
}

export interface WorkItemsEntry {
  work_item_id: string
  issue: string
  kind: string | null
  summary: string
  status: 'active' | 'delivered'
  started_at: string
  at_step: string | null
  friction: number
}

export interface WorkflowEdit {
  what: 'new' | 'changed' | 'moved' | 'removed'
  kind: 'step' | 'rule'
  ref: string
  name: string
  was: string | null
}

export interface ChangeRow {
  at: string
  from_version: string | null
  version: string
  change: string
  purpose: string | null
  hypothesis: string | null
  measure: string | null
  before: number | null
  before_sd: number | null
  after: number | null
  counted: number
  judge_after: number | null
  outcome: 'significant' | 'below target' | 'not significant' | 'insufficient data' | null
  edits: WorkflowEdit[]
}

export interface Complaint {
  id: string
  at: string
  source: 'agent post mortem' | 'drillmaster post mortem' | 'agent impediment' | 'your step-in'
  work_item_id: string
  issue: string
  text: string
}

export interface Problem {
  summary: string
  complaints: Complaint[]
}

export interface DrillmasterPage {
  tools: { tool: string; heard: number; problems: Problem[]; ungrouped: Complaint[] }[]
  uncovered: Complaint[]
}
