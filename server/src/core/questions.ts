import type { NewEvent } from './events.js'
import { resolveRef, stepGuidAt, stepPosition } from './refs.js'
import type { ProjectState, WorkItemState } from './state.js'
import { atStep, decideSkip, describeMove, describeUpdate, inputEventsWithMove, moveOn, nextPosition, stepAt, workflowOfWorkItem } from './work.js'
import { AT_START, type WorkItemInput } from './workflow.js'

/** AskUserQuestion takes at most this many questions per call. */
export const MAX_QUESTIONS_PER_ASK = 4
const MAX_HEADER_LENGTH = 12
const MAX_QUOTED_ANSWER_LENGTH = 300

export const APPROVE = 'Approve'
export const REJECT = 'Reject'
export const DECLINE = 'Decline'

export interface QuestionOption {
  label: string
  description: string
}

export type OwnerQuestion = {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: false
} & (
  | { kind: 'owner_gate'; work_item_id: string; stage: number; step: number }
  | { kind: 'proposal'; retro_id: string; proposal: number }
  | { kind: 'owner_input'; work_item_id: string; stage: number | null; step: number | null; input: string }
  | { kind: 'step_skip'; work_item_id: string; stage: number; step: number }
)

const header = (text: string) => text.slice(0, MAX_HEADER_LENGTH)

function ownerGateQuestion(state: ProjectState, item: WorkItemState): OwnerQuestion | undefined {
  const gate = item.pending_gate
  if (gate?.gate !== 'owner') return undefined
  const workflow = workflowOfWorkItem(state, item)
  const step = stepAt(workflow, gate.stage, gate.step)
  return {
    kind: 'owner_gate',
    work_item_id: item.work_item_id,
    stage: gate.stage,
    step: gate.step,
    question: `Owner gate of ${item.work_item_id} (${item.issue}), work step ${gate.stage}.${gate.step} "${step?.name ?? ''}": does the work meet ${step?.rules.length ? step.rules.join(', ') : 'what you expect'}?`,
    header: 'Owner gate',
    options: [
      { label: APPROVE, description: 'The work meets the rules: it moves on. A note makes it a rejection.' },
      { label: REJECT, description: 'It goes back. Say what to fix in a note, or type it.' },
    ],
    multiSelect: false,
  }
}

const MAX_QUOTED_JUSTIFICATION_LENGTH = 200

function stepSkipQuestion(state: ProjectState, item: WorkItemState): OwnerQuestion | undefined {
  const skip = item.pending_skip
  if (skip?.decided_by !== 'owner') return undefined
  const step = stepAt(workflowOfWorkItem(state, item), skip.stage, skip.step)
  return {
    kind: 'step_skip',
    work_item_id: item.work_item_id,
    stage: skip.stage,
    step: skip.step,
    question: `Skip step ${skip.stage}.${skip.step} "${step?.name ?? ''}" of ${item.work_item_id} (${item.issue})? Agent says: ${quote(skip.why, MAX_QUOTED_JUSTIFICATION_LENGTH)}`,
    header: 'Skip step',
    options: [
      { label: APPROVE, description: 'The step is not needed for this work item: it moves on. A note makes it a rejection.' },
      { label: REJECT, description: 'Agent does the step. Say why in a note, or type it.' },
    ],
    multiSelect: false,
  }
}

function proposalQuestions(state: ProjectState): OwnerQuestion[] {
  const retro = state.latestRetroId ? state.retros[state.latestRetroId] : undefined
  if (!retro) return []
  const decided = new Set([...retro.approved, ...retro.declined, ...retro.applied])
  return retro.proposals
    .filter((proposal) => !decided.has(proposal.id))
    .map((proposal) => ({
      kind: 'proposal' as const,
      retro_id: retro.retro_id,
      proposal: proposal.id,
      question: `Proposal ${proposal.id} of ${retro.retro_id}: ${proposal.change}. Approve it?`,
      header: header(`Proposal ${proposal.id}`),
      options: [
        { label: APPROVE, description: `${proposal.purpose}${proposal.hypothesis ? ` Hypothesis: ${proposal.hypothesis}` : ''}`.trim() || 'Apply it as a workflow experiment.' },
        { label: DECLINE, description: 'Leave the workflow as it is. A note on Approve declines it too.' },
      ],
      multiSelect: false as const,
    }))
}

/** Owner's inputs of a work item that are due, set at work_start or at a step it passed, and not set yet. */
function ownerInputQuestions(state: ProjectState, item: WorkItemState): OwnerQuestion[] {
  const workflow = workflowOfWorkItem(state, item)
  const done = new Set([...item.passed_step_guids, ...item.skipped_step_guids])
  const isDue = (input: WorkItemInput) => input.set_at === AT_START || done.has(resolveRef(workflow, input.set_at, { impliedKind: 'step' }).guid!)
  return workflow.inputs
    .filter((input) => input.by === 'owner' && !item.inputs[input.name] && isDue(input))
    .map((input) => ({
      kind: 'owner_input' as const,
      work_item_id: item.work_item_id,
      ...(input.set_at === AT_START ? { stage: null, step: null } : stepPosition(input.set_at)!),
      input: input.name,
      question: `Input "${input.name}" for ${item.work_item_id} (${item.issue}): ${input.instruction}`,
      header: header(input.name),
      options: input.options.map((option) => ({ label: option.value, description: option.description })),
      multiSelect: false as const,
    }))
}

export function pendingOwnerQuestions(state: ProjectState): OwnerQuestion[] {
  const items = Object.values(state.workItems)
  return [
    ...items.flatMap((item) => ownerGateQuestion(state, item) ?? []),
    ...items.flatMap((item) => stepSkipQuestion(state, item) ?? []),
    ...items.flatMap((item) => (item.status === 'active' ? ownerInputQuestions(state, item) : [])),
    ...proposalQuestions(state),
  ]
}

export const askUserQuestionInput = (questions: readonly OwnerQuestion[]) => ({
  questions: questions.slice(0, MAX_QUESTIONS_PER_ASK).map(({ question, header: questionHeader, options, multiSelect }) => ({ question, header: questionHeader, options, multiSelect })),
})

const quote = (text: string, maxLength = MAX_QUOTED_ANSWER_LENGTH) => (text.length > maxLength ? `${text.slice(0, maxLength)}...` : text)

export interface OwnerAnswer {
  answer: string
  notes?: string
}

export interface AnswerOutcome {
  events: NewEvent[]
  lines: string[]
}

/**
 * Owner approves only by picking Approve and nothing more. A note, or an answer Owner typed, is a
 * rejection (a decline for a proposal), with Owner's words as the reason.
 */
function readApproval(ownerAnswer: OwnerAnswer) {
  const approved = ownerAnswer.answer === APPROVE && !ownerAnswer.notes
  const reason = [ownerAnswer.answer === APPROVE || ownerAnswer.answer === REJECT || ownerAnswer.answer === DECLINE ? '' : ownerAnswer.answer, ownerAnswer.notes]
    .filter(Boolean)
    .join(' - ')
  return { approved, reason }
}

export function decideOwnerQuestion(state: ProjectState, question: OwnerQuestion, ownerAnswer: OwnerAnswer): AnswerOutcome {
  switch (question.kind) {
    case 'owner_gate': {
      const { approved: accepted, reason } = readApproval(ownerAnswer)
      const item = state.workItems[question.work_item_id]!
      const workflow = workflowOfWorkItem(state, item)
      const passed = accepted ? nextPosition(workflow, question.stage, question.step) : { next: { stage: question.stage, step: question.step }, done: false }
      const moved = accepted ? moveOn(state, item, workflow, passed, { doneNow: [stepGuidAt(workflow, question.stage, question.step)!] }) : undefined
      const rules = stepAt(workflow, question.stage, question.step)?.rules ?? []
      const stepLabel = `step ${question.stage}.${question.step}`
      return {
        events: [
          {
            type: 'gate_verdict',
            work_item_id: question.work_item_id,
            ...atStep(workflow, question.stage, question.step),
            accepted,
            by: 'owner',
            via: 'question',
            why: accepted ? 'Owner approved.' : `Owner rejected${reason ? `: "${quote(reason)}"` : '.'}`,
            rule: rules.length ? rules.join(', ') : null,
            ...passed,
          },
          ...(moved?.events ?? []),
        ],
        lines: [
          moved
            ? `Owner approved the Owner gate of ${stepLabel}. ${moved.update ? `${updateLine(describeUpdate(moved.update))} ` : ''}${nextLine(describeMove(moved))}`
            : `Owner rejected the Owner gate of ${stepLabel}${reason ? `: "${quote(reason)}"` : ''}. Do what Owner asks, report the impediment, and hand the gate in again.`,
        ],
      }
    }
    case 'proposal': {
      const { approved, reason } = readApproval(ownerAnswer)
      return {
        events: [
          {
            type: 'owner_decided',
            retro_id: question.retro_id,
            approved: approved ? [question.proposal] : [],
            declined: approved ? [] : [question.proposal],
            prompt: ownerAnswer.answer,
            via: 'question',
            ...(reason ? { comment: reason } : {}),
          },
        ],
        lines: [`Owner ${approved ? 'approved' : 'declined'} proposal ${question.proposal}${reason ? ` ("${quote(reason)}")` : ''}.`],
      }
    }
    case 'step_skip': {
      const { approved: accepted, reason } = readApproval(ownerAnswer)
      const item = state.workItems[question.work_item_id]!
      const decided = decideSkip(state, item, { accepted, by: 'owner', via: 'question', why: accepted ? 'Owner approved.' : `Owner rejected${reason ? `: "${quote(reason)}"` : '.'}` })
      const move = decided.answer as MoveAnswer
      return {
        events: decided.events,
        lines: [
          accepted
            ? `Owner approved skipping step ${question.stage}.${question.step}. ${move.update ? `${updateLine(move.update)} ` : ''}${nextLine(move)}`
            : `Owner rejected skipping step ${question.stage}.${question.step}${reason ? `: "${quote(reason)}"` : ''}. Do the step.`,
        ],
      }
    }
    case 'owner_input': {
      const option = question.options.find((candidate) => candidate.label === ownerAnswer.answer)
      if (!option) {
        return { events: [], lines: [`Owner typed "${quote(ownerAnswer.answer)}" for input "${question.input}", which is none of its options, so it stays open. Ask again with the same question.`] }
      }
      const at = question.stage === null || question.step === null ? null : { stage: question.stage, step: question.step }
      const events = inputEventsWithMove(state, state.workItems[question.work_item_id]!, at, [
        { name: question.input, value: option.label, ...(ownerAnswer.notes ? { explanation: ownerAnswer.notes } : {}), by: 'owner' },
      ])
      return { events, lines: [`Owner set input "${question.input}": ${option.label}.`] }
    }
  }
}

type MoveAnswer = ReturnType<typeof describeMove> & { update?: Parameters<typeof updateLine>[0] }

const nextLine = (move: Pick<MoveAnswer, 'next' | 'done' | 'session_done' | 'waiting_for_inputs'>) =>
  move.done
    ? 'Every work gate has passed: deliver the work item.'
    : move.session_done
      ? `This session's stages are done: the work item waits at step ${move.next.stage}.${move.next.step}. Stop, and tell Owner; a later session takes it up with work_resume.`
      : move.waiting_for_inputs
        ? `Next: step ${move.next.stage}.${move.next.step}, which waits for input ${move.waiting_for_inputs.join(', ')} (work_status shows who sets it).`
        : `Next: step ${move.next.stage}.${move.next.step} (work_status shows it).`

const updateLine = (update: { from_version: string; to_version: string; kept: string[] }) =>
  `The work item updated from workflow ${update.from_version} to ${update.to_version}, keeping ${update.kept.length ? `step ${update.kept.join(', ')}` : 'no step'} as done.`

export function decideOwnerAnswers(state: ProjectState, answers: Record<string, unknown>, annotations: Record<string, unknown>): AnswerOutcome {
  const pending = pendingOwnerQuestions(state)
  const outcome: AnswerOutcome = { events: [], lines: [] }
  for (const [questionText, answer] of Object.entries(answers)) {
    const question = pending.find((candidate) => candidate.question === questionText)
    if (!question || typeof answer !== 'string') continue
    const notes = (annotations[questionText] as { notes?: unknown } | undefined)?.notes
    const decided = decideOwnerQuestion(state, question, { answer, ...(typeof notes === 'string' && notes.trim() ? { notes: notes.trim() } : {}) })
    outcome.events.push(...decided.events)
    outcome.lines.push(...decided.lines)
  }
  return outcome
}
