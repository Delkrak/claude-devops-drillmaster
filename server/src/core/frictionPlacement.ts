// The friction judge never sees the workflow, so it cannot say where a step-in belongs. Drillmaster,
// which knows the workflow, places each input judged friction afterwards, in a call of its own.

import type { DrillmasterEvent, FrictionPlaced } from './events.js'
import type { FrictionJudgement, OwnerInput } from './ownerInputs.js'
import { stepGuidAt } from './refs.js'
import { extractFirstJsonObject } from './review.js'
import type { WorkItemState } from './state.js'
import type { WorkflowDocument } from './workflow.js'

export const FRICTION_PLACEMENT_REVIEW_KIND = 'friction_placement'

export type FrictionPlacement = FrictionPlaced['inputs'][number]

export function buildFrictionPlacementPrompt(workflow: WorkflowDocument, item: WorkItemState, frictions: readonly { input: OwnerInput; judgement: FrictionJudgement }[]) {
  const passed = new Set(item.passed_step_guids)
  const skipped = new Set(item.skipped_step_guids)
  const steps = workflow.stages.flatMap((stage) =>
    stage.steps.map((step) => `- ${stage.n}.${step.n} ${step.name}${step.if ? ` (only when ${step.if})` : ''}: ${passed.has(step.guid) ? 'passed' : skipped.has(step.guid) ? 'skipped' : 'not reached'}`),
  )
  return [
    'You are Drillmaster. Owner had to step in on a work item; an independent judge found each input below to be friction.',
    'For each, name the one work step that should have caught what Owner had to point out, so the step-in shows where the workflow let it through.',
    'Name a step only when its purpose covers what Owner asked for; answer null when no step of this workflow covers it.',
    '',
    `Work item ${item.issue}: ${item.description || 'no description'}`,
    '',
    `Its workflow (${workflow.version}), and how the work item went through it:`,
    ...steps,
    '',
    'The inputs judged friction:',
    ...frictions.map(({ input, judgement }) => `- ${input.event_id}${input.after_delivery ? ' (after delivery)' : ''}: "${input.prompt}" (why friction: ${judgement.why})`),
    '',
    'Answer with JSON only:',
    '{"inputs": [{"event": "<the input\'s id>", "step": "<stage.step, e.g. 3.1>" | null, "why": "<one sentence>"}]}',
  ].join('\n')
}

/** Keeps the placements of the inputs that were asked about; a step the workflow does not have places nowhere. */
export function readFrictionPlacementAnswer(workflow: WorkflowDocument, asked: readonly string[], answer: unknown): FrictionPlacement[] {
  const parsed = (typeof answer === 'string' ? extractFirstJsonObject(answer) : answer) as { inputs?: unknown } | undefined
  if (!parsed || !Array.isArray(parsed.inputs)) return []
  const askedIds = new Set(asked)
  return parsed.inputs.flatMap((candidate: { event?: unknown; step?: unknown; why?: unknown }) => {
    if (typeof candidate.event !== 'string' || !askedIds.has(candidate.event)) return []
    const position = typeof candidate.step === 'string' ? /^(\d+)\.(\d+)$/.exec(candidate.step.trim()) : null
    const stepGuid = position ? (stepGuidAt(workflow, Number(position[1]), Number(position[2])) ?? null) : null
    return [{ event: candidate.event, step_guid: stepGuid, why: typeof candidate.why === 'string' ? candidate.why : '' }]
  })
}

export function frictionPlacementsOf(events: readonly DrillmasterEvent[]) {
  const placements = new Map<string, FrictionPlacement>()
  for (const event of events) if (event.type === 'friction_placed') for (const placement of event.inputs) placements.set(placement.event, placement)
  return placements
}
