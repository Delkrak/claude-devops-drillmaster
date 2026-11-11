import type { DrillmasterEvent, WorkTrace } from './events.js'
import type { FrictionJudgement, OwnerInput, OwnerInputRole } from './ownerInputs.js'
import { extractFirstJsonObject } from './review.js'

export const FRICTION_REVIEW_KIND = 'friction'
const TRACES_AROUND_AN_INPUT = 8

const ROLE_WORDS: Record<OwnerInputRole, string> = {
  start: 'it started the work item',
  resume: 'it took the work item up again in a later session',
  retrospective: 'it called a retrospective',
  input: 'it came while Agent worked on the work item',
}

const traceLine = (trace: WorkTrace) => `    - ${trace.tool ?? trace.hook}${trace.input ? ` ${trace.input.slice(0, 160)}` : ''}${trace.error ? ' (failed)' : ''}`

/**
 * The friction judge sees only the work item: its issue, Owner's inputs on it, and what Agent did
 * around each. It never sees the workflow or the retrospectives, so it has no stake in either.
 */
export function buildFrictionPrompt(item: { work_item_id: string; issue: string; description: string }, inputs: readonly OwnerInput[], events: readonly DrillmasterEvent[]) {
  const sessionTraces = (sessionId: string) => events.filter((event): event is WorkTrace => event.type === 'work_trace' && event.session_id === sessionId && event.hook !== 'UserPromptSubmit')
  const inputBlocks = inputs.map((input) => {
    const traces = sessionTraces(input.session_id)
    const before = traces.filter((trace) => trace.at < input.at).slice(-TRACES_AROUND_AN_INPUT)
    const after = traces.filter((trace) => trace.at > input.at).slice(0, TRACES_AROUND_AN_INPUT)
    return [
      `- ${input.event_id} (${ROLE_WORDS[input.role]}${input.after_delivery ? ', after delivery' : ''}): "${input.prompt}"`,
      '  What Agent did just before:',
      ...(before.length ? before.map(traceLine) : ['    - nothing']),
      '  What Agent did just after:',
      ...(after.length ? after.map(traceLine) : ['    - nothing']),
    ].join('\n')
  })
  return [
    'You judge friction between Owner and Agent on one work item, independently: you know nothing of how the work is organised, and need not.',
    'For each of Owner\'s inputs below, decide whether it was friction: Owner had to step in, because the work was wrong, incomplete, missed something Owner expects, or went somewhere Owner did not want.',
    'It is not friction when Owner hands Agent the work, takes it up again, answers a question Agent asked, or asks for something new that the work could not have known.',
    '',
    `Work item ${item.work_item_id} (${item.issue}): ${item.description || 'no description'}`,
    '',
    "Owner's inputs:",
    ...inputBlocks,
    '',
    'Answer with JSON only:',
    '{"inputs": [{"event": "<the input\'s id>", "friction": true|false, "why": "<one sentence>"}]}',
  ].join('\n')
}

/** Keeps the judgements of the inputs that were asked about. */
export function readFrictionAnswer(inputs: readonly OwnerInput[], answer: unknown): FrictionJudgement[] {
  const parsed = (typeof answer === 'string' ? extractFirstJsonObject(answer) : answer) as { inputs?: unknown } | undefined
  if (!parsed || !Array.isArray(parsed.inputs)) return []
  const asked = new Set(inputs.map((input) => input.event_id))
  return parsed.inputs.flatMap((candidate: Partial<FrictionJudgement>) =>
    typeof candidate.event === 'string' && asked.has(candidate.event) && typeof candidate.friction === 'boolean'
      ? [{ event: candidate.event, friction: candidate.friction, why: typeof candidate.why === 'string' ? candidate.why : '' }]
      : [],
  )
}
