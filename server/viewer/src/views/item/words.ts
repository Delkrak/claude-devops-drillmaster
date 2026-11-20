// What the work item page says, in Owner's words.

import type { StepIn, WorkItemPageStep } from '../../types'

const WHO: Record<string, string> = { drillmaster: 'Drillmaster', owner: 'you', agent: "Agent's own check" }
export const whoDecided = (by: string) => WHO[by] ?? by

/** The note under a step's name: why it was skipped, or what it waits for. */
export function noteOf(step: WorkItemPageStep) {
  if (step.status === 'skipped') return step.happened.skip?.by === 'condition' && step.when ? `skipped: only when ${step.when}` : 'skipped'
  if (step.status !== 'here') return null
  if (step.happened.waiting_for === 'drillmaster') return "waiting for Drillmaster's review"
  if (step.happened.waiting_for === 'owner') return 'waiting for you'
  return 'Agent is working here'
}

export const stepInLabel = (stepIn: StepIn) => `you stepped in${stepIn.after_delivery ? ' after delivery' : ''}`

/** What kept output is called: "test totals" for a tool capture named tests. */
export const keptName = (name: string) => (name === 'tests' ? 'test totals' : name === 'failures' ? 'failing tests' : name)

export const hasEvidence = (step: WorkItemPageStep) => step.evidence.self_check.length > 0 || step.evidence.kept_output.length > 0
