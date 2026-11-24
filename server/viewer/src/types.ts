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
  marks: MarkCount[]
  steps: WorkflowPageStep[]
}

/** A measure the pages show; old is the friction Drillmaster judged before workflows defined measures. */
export interface ShownMeasure {
  name: string
  short: string
  color: string
  definition: string
  old: boolean
}

/** How often a shown measure happened in one place, and on which work items. */
export interface MarkCount {
  measure: string
  count: number
  items: WorkItemRef[]
}

export interface WorkflowPage {
  at: string
  workflow_version: string
  stages: WorkflowPageStage[]
  delivered: number
  waiting_to_deliver: WorkItemRef[]
  measures: ShownMeasure[]
  no_step: MarkCount[]
}

/** One occurrence of a shown measure on a work item. */
export interface ItemMark {
  measure: string
  at: string
  after_delivery: boolean
  why: string
  placed_why: string | null
  prompts: string[]
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
  marks: ItemMark[]
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
  delivered: { at: string; summary: string | null; added_steps: { at: string; text: string; why: string }[]; post_mortems: { author: string; keep: string[]; change: string[] }[] } | null
  measures: ShownMeasure[]
  marks_no_step: ItemMark[]
}

export interface WorkItemsList {
  measures: ShownMeasure[]
  items: WorkItemsEntry[]
}

export interface WorkItemsEntry {
  work_item_id: string
  issue: string
  kind: string | null
  summary: string
  status: 'active' | 'delivered'
  started_at: string
  at_step: string | null
  marks: { measure: string; count: number }[]
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
  before_items: number | null
  after: number | null
  counted: number
  judge_after: number | null
  outcome: 'significant' | 'below target' | 'not significant' | 'insufficient data' | null
  edits: WorkflowEdit[]
}

export interface Complaint {
  id: string
  at: string
  source: 'agent post mortem' | 'drillmaster post mortem' | 'agent impediment' | 'your step-in' | 'a measure'
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
