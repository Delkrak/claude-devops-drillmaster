import type { StepIn, WorkItemPageStep } from '../../types'

const DECIDER_IN_WORDS: Record<string, string> = { drillmaster: 'Drillmaster', owner: 'you', agent: "Agent's own check" }
export const whoDecided = (by: string) => DECIDER_IN_WORDS[by] ?? by

export function stepNoteOf(step: WorkItemPageStep) {
  if (step.status === 'skipped') return step.happened.skip?.by === 'condition' && step.when ? `skipped: only when ${step.when}` : 'skipped'
  if (step.status !== 'here') return null
  if (step.happened.waiting_for === 'drillmaster') return "waiting for Drillmaster's review"
  if (step.happened.waiting_for === 'owner') return 'waiting for you'
  return 'Agent is working here'
}

export const stepInLabel = (stepIn: StepIn) => `you stepped in${stepIn.after_delivery ? ' after delivery' : ''}`

export const keptOutputName = (captureName: string) => (captureName === 'tests' ? 'test totals' : captureName === 'failures' ? 'failing tests' : captureName)

export const hasEvidence = (step: WorkItemPageStep) => step.evidence.self_check.length > 0 || step.evidence.kept_output.length > 0

export const asSentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`
